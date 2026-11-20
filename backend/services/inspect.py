from __future__ import annotations

import re
from typing import Any

from yt_dlp import YoutubeDL

from backend.config import AppConfig, DEFAULT_CONFIG
from backend.services.format_builder import build_formats
from backend.services.ytdlp_opts import base_opts

YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "music.youtube.com",
}


def _is_valid_url(url: str) -> bool:
    if not url:
        return False
    host = url.split("//", 1)[-1].split("/", 1)[0].lower()
    return host in YOUTUBE_HOSTS or host.endswith(".youtube.com") or host == "youtube.com" or host == "youtu.be"


def inspect_url(url: str, cfg: AppConfig | None = None) -> dict[str, Any]:
    if not _is_valid_url(url):
        raise ValueError("INVALID_URL")

    opts = base_opts(cfg or DEFAULT_CONFIG, skip_download=True)
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if info.get("_type") == "playlist":
        entries = []
        for idx, entry in enumerate(info.get("entries", []) or [], start=1):
            if not entry:
                continue
            entries.append(
                {
                    "index": idx,
                    "id": entry.get("id"),
                    "title": entry.get("title") or "Untitled",
                    "duration": int(entry.get("duration") or 0),
                    "url": entry.get("webpage_url") or entry.get("url") or "",
                    "thumbnail": (entry.get("thumbnails") or [{}])[-1].get("url") if entry.get("thumbnails") else None,
                }
            )
        return {
            "type": "playlist",
            "title": info.get("title", "Playlist"),
            "playlist_id": info.get("id"),
            "entries": entries,
        }

    return build_formats(info)
