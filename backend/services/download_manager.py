from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from queue import Queue
from typing import Any

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadCancelled, download_range_func

from backend.config import AppConfig, load_config, resolve_download_dir
from backend.db import init_db, insert_download, update_download
from backend.errors import map_error_message
from backend.services.files import safe_path
from backend.services.captions import burn_captions
from backend.services.ytdlp_opts import base_opts


class DownloadJob:
    def __init__(self, payload: dict[str, Any], cfg: AppConfig):
        self.payload = payload
        self.cfg = cfg
        self.cancel_requested = False


class DownloadManager:
    def __init__(self, cfg: AppConfig | None = None):
        init_db()
        self.cfg = cfg or load_config()
        self.jobs: dict[str, DownloadJob] = {}
        self.lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=max(1, self.cfg.max_concurrent))
        self.queue: Queue[str] = Queue()
        self.dispatcher = threading.Thread(target=self._dispatch_loop, daemon=True)
        self.dispatcher.start()

    def update_config(self, cfg: AppConfig) -> None:
        self.cfg = cfg

    def _dispatch_loop(self) -> None:
        while True:
            job_id = self.queue.get()
            if job_id is None:
                return
            with self.lock:
                job = self.jobs.get(job_id)
            if job is not None:
                self.executor.submit(self._run_job, job)
            self.queue.task_done()

    def _run_job(self, job: DownloadJob) -> None:
        payload = job.payload
        job_id = payload["id"]
        cfg = job.cfg
        final_paths: list[str] = []
        try:
            if job.cancel_requested:
                raise DownloadCancelled("canceled")

            update_download(job_id, status="downloading", updated_at=datetime.now(timezone.utc).isoformat())
            target_dir = resolve_download_dir(cfg.download_dir)
            target_dir.mkdir(parents=True, exist_ok=True)

            def progress_hook(data: dict[str, Any]) -> None:
                self._progress_hook(job_id, data, job, final_paths)

            def postprocessor_hook(data: dict[str, Any]) -> None:
                self._postprocessor_hook(job_id, data, final_paths)

            opts = {
                **base_opts(cfg),
                "outtmpl": str(target_dir / cfg.filename_template),
                "merge_output_format": payload.get("container") or cfg.default_container,
                "noplaylist": True,
                "format": payload["format_selector"],
                "progress_hooks": [progress_hook],
                "postprocessor_hooks": [postprocessor_hook],
                "overwrites": False,
                "continuedl": True,
            }
            if clip := payload.get("clip"):
                # Each job has its own output, even for repeated or overlapping cuts.
                template = Path(cfg.filename_template)
                clip_name = f"{template.stem} [clip-{job_id}]{template.suffix}"
                opts["outtmpl"] = str(safe_path(target_dir / template.parent / clip_name, target_dir))
                opts["download_ranges"] = download_range_func([], [(clip["start"], clip["end"])])
                opts["force_keyframes_at_cuts"] = True
            if payload.get("write_subtitles"):
                opts["writesubtitles"] = True
                opts["subtitleslangs"] = payload.get("subtitle_langs", ["en"])
                opts["embedsubtitles"] = True
            if payload.get("embed_thumbnail"):
                opts["writethumbnail"] = True
                opts["postprocessors"] = [{"key": "EmbedThumbnail"}]
            if payload.get("embed_metadata"):
                opts.setdefault("postprocessors", []).append({"key": "FFmpegMetadata"})
            if payload.get("kind") == "audio" and payload.get("audio_format"):
                opts.setdefault("postprocessors", []).insert(
                    0,
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": payload["audio_format"],
                        "preferredquality": str(payload.get("audio_bitrate", 192)),
                    },
                )

            with YoutubeDL(opts) as ydl:
                info = ydl.extract_info(payload["url"], download=True)

            possible_paths = [
                *reversed(final_paths),
                info.get("filepath"),
                *(download.get("filepath") for download in (info.get("requested_downloads") or [])),
                info.get("_filename"),
            ]
            if not any(possible_paths):
                possible_paths.append(ydl.prepare_filename(info))
            resolved_path = None
            for path in possible_paths:
                if not path:
                    continue
                candidate = safe_path(path, target_dir)
                if candidate.is_file():
                    resolved_path = candidate
                    break
            if resolved_path is None:
                raise FileNotFoundError("yt-dlp completed without producing a file path")
            if payload.get("captions") or payload.get("auto_portrait"):
                update_download(job_id, status="processing", updated_at=datetime.now(timezone.utc).isoformat())
                if payload.get("auto_portrait"):
                    resolved_path = burn_captions(resolved_path, payload.get("captions", []), job, auto_portrait=True)
                    if payload.get("tracking_note"):
                        update_download(job_id, label=payload["label"] + " · " + payload["tracking_note"])
                else:
                    resolved_path = burn_captions(resolved_path, payload["captions"], job)
            update_download(
                job_id,
                status="completed",
                progress=100.0,
                filepath=str(resolved_path),
                updated_at=datetime.now(timezone.utc).isoformat(),
            )
        except Exception as exc:  # pragma: no cover - runtime-only
            status = "failed"
            if "canceled" in str(exc).lower() or job.cancel_requested:
                status = "canceled"
                if not cfg.keep_original:
                    self._remove_partial_files(final_paths, cfg.download_dir)
            error_message = map_error_message(exc)
            update_download(job_id, status=status, error=error_message, updated_at=datetime.now(timezone.utc).isoformat())

    def _progress_hook(
        self,
        job_id: str,
        d: dict[str, Any],
        job: DownloadJob,
        final_paths: list[str],
    ) -> None:
        if job.cancel_requested:
            raise DownloadCancelled("canceled")
        filename = d.get("filename")
        if filename:
            final_paths.append(filename)
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            progress = (downloaded / total * 100) if total else 0
            update_download(
                job_id,
                status="downloading",
                progress=progress,
                speed=d.get("speed") or 0,
                eta=d.get("eta") or 0,
                updated_at=datetime.now(timezone.utc).isoformat(),
            )

    def _postprocessor_hook(
        self,
        job_id: str,
        d: dict[str, Any],
        final_paths: list[str],
    ) -> None:
        info = d.get("info_dict") or {}
        filepath = info.get("filepath") or info.get("_filename")
        if filepath:
            final_paths.append(filepath)
        if d.get("status") in {"processing", "finished"}:
            update_download(job_id, status="processing", updated_at=datetime.now(timezone.utc).isoformat())

    @staticmethod
    def _remove_partial_files(paths: list[str], download_dir: str) -> None:
        for path in set(paths):
            try:
                resolved = safe_path(path, resolve_download_dir(download_dir))
            except ValueError:
                continue
            for candidate in (resolved, Path(f"{resolved}.part")):
                if candidate.is_file():
                    candidate.unlink()

    def queue_download(self, payload: dict[str, Any]) -> str:
        job_id = payload["id"]
        payload["status"] = "queued"
        payload["created_at"] = datetime.now(timezone.utc).isoformat()
        payload["updated_at"] = payload["created_at"]
        insert_download(payload)
        with self.lock:
            self.jobs[job_id] = DownloadJob(payload, replace(self.cfg))
        self.queue.put(job_id)
        return job_id

    def cancel(self, job_id: str) -> bool:
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None:
                return False
            job.cancel_requested = True
        update_download(job_id, status="canceled", updated_at=datetime.now(timezone.utc).isoformat())
        return True


def build_format_selector(kind: str, format_id: str, audio_format: str | None = None) -> str:
    if kind == "video":
        return f"{format_id}+bestaudio/best"
    if kind == "audio":
        return format_id
    return format_id


