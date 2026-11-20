from __future__ import annotations

import hashlib
import threading
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qs, urlsplit

import html
import json
import math
import re
import subprocess
import tempfile
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadCancelled

from backend.config import DATA_DIR
from backend.models import CaptionStyle
from backend.services.files import safe_path
from backend.services.inspect import _is_valid_url
from backend.services.ytdlp_opts import base_opts
from backend.services.reframe import track_people, portrait_filter


def parse_json3(data: dict) -> list[dict]:
    cues = []
    for event in data.get("events", []):
        text = html.unescape("".join(segment.get("utf8", "") for segment in event.get("segs", []))).strip()
        start = float(event.get("tStartMs", 0)) / 1000
        end = start + float(event.get("dDurationMs", 0)) / 1000
        if text and math.isfinite(start) and math.isfinite(end) and 0 <= start < end:
            cues.append({"start": start, "end": end, "text": text})
    cues.sort(key=lambda cue: cue["start"])
    # Automatic transcripts often keep a rolling window alive after the next cue.
    for current, following in zip(cues, cues[1:]):
        current["end"] = min(current["end"], following["start"])
    return [cue for cue in cues if cue["end"] > cue["start"]]


class TranscriptRateLimited(ValueError):
    def __init__(self, retry_after=60):
        self.retry_after = max(1, math.ceil(retry_after))
        super().__init__(f"YouTube is temporarily limiting transcript requests. Wait {self.retry_after} seconds before trying again. Your caption edits are preserved; clips can still download with captions off.")


def retry_delay(exc):
    current = exc
    seen = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if getattr(current, "status", None) == 429 or getattr(current, "code", None) == 429 or "429" in str(current):
            headers = getattr(current, "headers", {}) or {}
            value = headers.get("Retry-After")
            try:
                delay = float(value)
                return max(60, delay) if math.isfinite(delay) else 60
            except (TypeError, ValueError):
                try:
                    return max(60, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
                except (TypeError, ValueError, OverflowError):
                    return 60
        current = getattr(current, "cause", None) or getattr(current, "__cause__", None) or getattr(current, "__context__", None)
    return None


class TranscriptStore:
    def __init__(self, directory=DATA_DIR / "transcripts", clock=time.time):
        self.directory = directory
        self.clock = clock
        self.lock = threading.Lock()
        self.blocked_until = 0

    def get(self, url, cfg, language=None):
        if not _is_valid_url(url):
            raise ValueError("Enter a valid YouTube video URL.")
        if language is None and cfg.default_caption_language != "original":
            language = cfg.default_caption_language
        parts = urlsplit(url if "://" in url else "https://" + url)
        video = parts.path.strip("/") if parts.hostname == "youtu.be" else parse_qs(parts.query).get("v", [None])[0]
        if not video and parts.path.startswith(("/shorts/", "/embed/", "/live/")):
            video = parts.path.split("/")[2]
        canonical = f"https://www.youtube.com/watch?v={video}" if video and re.fullmatch(r"[A-Za-z0-9_-]+", video) else url
        context = {key: getattr(cfg, key) for key in ("default_caption_language", "subtitle_langs", "cookiefile", "cookies_from_browser", "proxy", "player_clients")}
        def cache_key(selected):
            return hashlib.sha256(json.dumps([2, canonical, selected, context], sort_keys=True).encode()).hexdigest()
        key = cache_key(language)
        # Serializing loads also coalesces simultaneous clicks from different tabs.
        with self.lock:
            root = safe_path(self.directory, self.directory.parent)
            root.mkdir(parents=True, exist_ok=True)
            path = safe_path(root / (key + ".json"), root)
            try:
                cached = json.loads(path.read_text(encoding="utf-8"))
                if 0 <= self.clock() - cached["saved_at"] < 86400:
                    return cached["transcript"]
            except (OSError, ValueError, KeyError, TypeError):
                pass
            if self.blocked_until > self.clock():
                raise TranscriptRateLimited(self.blocked_until - self.clock())
            try:
                result = _fetch_transcript(canonical, cfg, language)
            except Exception as exc:
                delay = retry_delay(exc)
                if delay is not None:
                    self.blocked_until = self.clock() + delay
                    raise TranscriptRateLimited(delay) from exc
                raise
            for selected in {language, result["language"]}:
                selected_key = cache_key(selected)
                destination = safe_path(root / (selected_key + ".json"), root)
                temporary = safe_path(root / (selected_key + ".tmp"), root)
                temporary.write_text(json.dumps({"saved_at": self.clock(), "transcript": result}), encoding="utf-8")
                temporary.replace(destination)
            return result


transcript_store = TranscriptStore()


def load_transcript(url, cfg, language=None):
    return transcript_store.get(url, cfg, language)


def select_language(manual, available, preferred, requested):
    def original(lang):
        return lang + "-orig" if lang + "-orig" in available and lang not in manual else lang
    if requested:
        if requested in available or requested + "-orig" in available:
            return original(requested)
        return next((lang for lang in available if lang.startswith(requested + "-") and lang in manual), requested)
    for lang in preferred:
        if lang in manual and lang in available:
            return lang
    for lang in manual:
        if lang in available:
            return lang
    for lang in preferred:
        if lang + "-orig" in available:
            return lang + "-orig"
    # Original speech is preferable to automatically translated captions.
    return next((lang for lang in available if lang.endswith("-orig")), None) or next((lang for lang in preferred if lang in available), available[0])


def _fetch_transcript(url, cfg, language=None):
    if not _is_valid_url(url):
        raise ValueError("Enter a valid YouTube video URL.")
    with YoutubeDL({**base_opts(cfg, skip_download=True), "noplaylist": True}) as ydl:
        info = ydl.extract_info(url, download=False)
        manual = info.get("subtitles") or {}
        automatic = info.get("automatic_captions") or {}
        tracks = {**automatic, **manual}
        available = sorted(key for key, formats in tracks.items() if any(f.get("ext") == "json3" for f in formats))
        if not available:
            raise ValueError("This video has no available transcript. Clips can still be downloaded without captions.")
        selected = select_language(manual, available, cfg.subtitle_langs or ["en"], language)
        if selected not in available:
            raise ValueError(f"Captions in {language or cfg.default_caption_language} are unavailable for this video. Choose another language in Settings & Editing or select Original language. The app will not substitute a different language.")
        track = next(f for f in tracks[selected] if f.get("ext") == "json3")
        with ydl.urlopen(track["url"]) as response:
            raw = response.read(5_000_001)
        if len(raw) > 5_000_000:
            raise ValueError("The transcript is too large to edit.")
        cues = parse_json3(json.loads(raw))
        if duration := info.get("duration"):
            cues = [dict(cue, end=min(cue["end"], duration)) for cue in cues if cue["start"] < duration]
        if not cues or len(cues) > 10000:
            raise ValueError("The transcript is empty or too large to edit.")
        return {"language": selected, "automatic": selected not in manual, "languages": available, "cues": cues}


def clip_cues(cues, clip):
    return [{"start": max(cue["start"], clip["start"]) - clip["start"],
             "end": min(cue["end"], clip["end"]) - clip["start"], "text": cue["text"]}
            for cue in cues if cue["end"] > clip["start"] and cue["start"] < clip["end"] and cue["text"].strip()]


def srt_text(cues):
    def stamp(seconds):
        ms = round(seconds * 1000)
        return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"
    blocks = []
    for cue in cues:
        # Treat edits as plain text, never subtitle styling or markup.
        text = re.sub(r"<[^>]*>|\{[^}]*\}", "", cue["text"]).replace("\\", "／")
        text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
        if text:
            blocks.append(f"{len(blocks) + 1}\n{stamp(cue['start'])} --> {stamp(cue['end'])}\n{text}\n")
    return "\n".join(blocks)


def caption_force_style(style):
    settings = CaptionStyle(**(style or {}))
    def color(hex_color):
        value = hex_color.lstrip("#")
        return "&H00" + value[4:6] + value[2:4] + value[0:2]
    # libass force_style uses its internal SSA alignment, not ASS numpad values.
    alignment = {"bottom": 1, "middle": 9, "top": 5}[settings.position] + {"left": 0, "center": 1, "right": 2}[settings.align]
    values = {
        "FontName": settings.font, "FontSize": settings.size,
        "PrimaryColour": color(settings.color), "OutlineColour": color(settings.background_color if settings.background else settings.outline_color),
        "BackColour": color(settings.background_color), "Bold": -1 if settings.bold else 0,
        "Italic": -1 if settings.italic else 0, "Alignment": alignment,
        "MarginV": settings.margin, "MarginL": 18, "MarginR": 18,
        "Outline": settings.outline, "Shadow": settings.shadow, "BorderStyle": 3 if settings.background else 1,
    }
    return ",".join(f"{key}={value}" for key, value in values.items())


def burn_captions(source: Path, cues, job, auto_portrait=False):
    root = safe_path(source.parent, source.parent)
    plan = track_people(source, job) if auto_portrait else None
    if plan is not None and not plan["detections"]:
        job.payload["tracking_note"] = "No people detected; used centered portrait crop."
    with tempfile.TemporaryDirectory(prefix="captions-", dir=root) as temporary:
        work = safe_path(temporary, root)
        subtitle = safe_path(work / "captions.srt", root)
        output = safe_path(work / "captioned.mp4", root)
        filters = [portrait_filter(plan, work)] if plan is not None else []
        if cues:
            subtitle.write_text(srt_text(cues), encoding="utf-8")
            style = caption_force_style(getattr(job, "payload", {}).get("caption_style"))
            filters.append(f"subtitles=captions.srt:force_style='{style}'")
        command = ["ffmpeg", "-nostdin", "-y", "-i", str(safe_path(source, root)),
                   "-vf", ",".join(filters),
                   "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-crf", "18",
                   "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", str(output)]
        process = subprocess.Popen(command, cwd=work, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            while True:
                if job.cancel_requested:
                    raise DownloadCancelled("canceled")
                try:
                    _, error = process.communicate(timeout=0.2)
                    break
                except subprocess.TimeoutExpired:
                    continue
            if process.returncode:
                raise ValueError("Clip rendering failed. Check ffmpeg and its subtitles filter (libass). " + error.decode(errors="replace")[-500:])
            if job.cancel_requested:
                raise DownloadCancelled("canceled")
            destination = safe_path(source.with_name(source.stem + ("-portrait" if auto_portrait else "") + ("-captioned" if cues else "") + ".mp4"), root)
            output.replace(destination)
            source.unlink()
            return destination
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()
