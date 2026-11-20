from __future__ import annotations

import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.config import AppConfig, BASE_DIR, load_config, resolve_download_dir, save_config
from backend.db import delete_download, get_download, init_db, list_downloads, mark_interrupted, update_download
from backend.errors import error_response, map_error_message
from backend.models import ClipRange, ClipsRequest, DownloadRequest, HealthResponse, InspectRequest, SettingsConfig, TranscriptRequest, CaptionStyle
from backend.services.download_manager import DownloadManager, build_format_selector
from backend.services.files import safe_path
from backend.services.inspect import inspect_url
from backend.services.reframe import tracking_available
from backend.services.captions import load_transcript, clip_cues, TranscriptRateLimited

app = FastAPI(title="YouTube Downloader")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Retry-After"],
)

app.state.config = load_config()
app.state.manager = DownloadManager(app.state.config)


@app.on_event("startup")
def startup() -> None:
    init_db()
    mark_interrupted()
    app.state.config = load_config()
    app.state.manager = DownloadManager(app.state.config)


@app.get("/api/health")
def health() -> dict[str, Any]:
    ffmpeg_present = os.system("ffmpeg -version >/dev/null 2>&1") == 0
    yt_dlp_version = "unknown"
    try:
        import yt_dlp
        yt_dlp_version = yt_dlp.version.__version__
    except Exception:
        yt_dlp_version = "unknown"
    download_dir = resolve_download_dir(app.state.config.download_dir)
    download_dir.mkdir(parents=True, exist_ok=True)
    try:
        test_path = download_dir / ".write_test"
        test_path.write_text("ok")
        test_path.unlink(missing_ok=True)
        writable = True
    except Exception:
        writable = False
    return {"ok": True, "ffmpeg": ffmpeg_present, "yt_dlp_version": yt_dlp_version, "download_dir_writable": writable, "auto_portrait": tracking_available()}


@app.get("/api/preview/player")
def preview_player() -> FileResponse:
    return FileResponse(safe_path(BASE_DIR / "backend/preview/player.html", BASE_DIR), headers={"Referrer-Policy": "strict-origin-when-cross-origin"})


@app.get("/api/preview/player.js")
def preview_player_script() -> FileResponse:
    return FileResponse(safe_path(BASE_DIR / "backend/preview/player.js", BASE_DIR), media_type="text/javascript")


@app.post("/api/inspect")
def inspect_endpoint(payload: InspectRequest) -> dict[str, Any]:
    try:
        result = inspect_url(payload.url, app.state.config)
        if isinstance(result, dict) and result.get("type") != "playlist":
            result["type"] = "video"
        return result
    except Exception as exc:
        code = "INVALID_URL" if str(exc) == "INVALID_URL" else "INSPECT_FAILED"
        message = "Enter a valid YouTube video, Shorts, or playlist URL." if code == "INVALID_URL" else map_error_message(exc)
        raise HTTPException(status_code=400, detail=error_response(code, message))


@app.post("/api/transcript")
def transcript_endpoint(payload: TranscriptRequest) -> dict[str, Any]:
    try:
        return load_transcript(payload.url, app.state.config, payload.language)
    except TranscriptRateLimited as exc:
        raise HTTPException(status_code=429, detail=error_response("TRANSCRIPT_RATE_LIMITED", str(exc)), headers={"Retry-After": str(exc.retry_after)})
    except Exception as exc:
        raise HTTPException(status_code=400, detail=error_response("TRANSCRIPT_UNAVAILABLE", str(exc)))


@app.post("/api/downloads", status_code=201)
def create_download(payload: DownloadRequest) -> dict[str, Any]:
    return queue_selected_download(payload)


def queue_selected_download(payload: DownloadRequest, inspected: dict[str, Any] | None = None, clip: ClipRange | None = None, captions: list[dict] | None = None, auto_portrait: bool = False) -> dict[str, Any]:
    try:
        init_db()
        cfg = app.state.config
        inspected = inspected if inspected is not None else inspect_url(payload.url, cfg)
        if inspected.get("type") == "playlist":
            raise HTTPException(
                status_code=400,
                detail=error_response("PLAYLIST_NOT_SUPPORTED", "Select a video URL to download one format."),
            )
        selected_format = next(
            (
                item
                for item in inspected.get("formats", [])
                if item.get("format_id") == payload.format_id and item.get("kind") == payload.kind
            ),
            None,
        )
        if selected_format is None:
            raise HTTPException(
                status_code=400,
                detail=error_response("FORMAT_NOT_FOUND", "That format is no longer available. Inspect the URL again."),
            )

        now = datetime.now(timezone.utc).isoformat()
        record = {
            "id": str(uuid.uuid4()),
            "url": payload.url,
            "video_id": inspected.get("video_id"),
            "title": inspected.get("title") or "download",
            "channel": inspected.get("channel"),
            "thumbnail": inspected.get("thumbnail"),
            "kind": payload.kind,
            "format_id": selected_format["format_id"],
            "format_selector": build_format_selector(payload.kind, selected_format["format_id"], payload.audio_format),
            "label": selected_format.get("label") or selected_format["format_id"],
            "container": payload.container or cfg.default_container,
            "expected_size": selected_format.get("expected_size") or 0,
            "status": "queued",
            "progress": 0,
            "speed": None,
            "eta": None,
            "filepath": None,
            "error": None,
            "audio_format": payload.audio_format if payload.kind == "audio" else None,
            "audio_bitrate": payload.audio_bitrate,
            "write_subtitles": payload.write_subtitles,
            "subtitle_langs": payload.subtitle_langs or cfg.subtitle_langs,
            "embed_thumbnail": payload.embed_thumbnail,
            "embed_metadata": payload.embed_metadata,
            "created_at": now,
            "updated_at": now,
        }
        if clip is not None:
            record["clip"] = clip.model_dump()
            record["captions"] = captions or []
            record["caption_style"] = CaptionStyle(**cfg.caption_style).model_dump()
            record["auto_portrait"] = auto_portrait
            if auto_portrait:
                record["label"] += " · Auto portrait 9:16"
            if captions:
                record["label"] += " · Captions"
            record["label"] += f" · Clip {clip.start:g}–{clip.end:g}s"
            record["expected_size"] = 0
        job_id = app.state.manager.queue_download(record)
        return {"id": job_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=error_response("DOWNLOAD_FAILED", map_error_message(exc)))


@app.post("/api/clips", status_code=201)
def create_clips(payload: ClipsRequest) -> dict[str, Any]:
    if payload.auto_portrait and not tracking_available():
        raise HTTPException(status_code=400, detail=error_response("TRACKING_UNAVAILABLE", "Automatic portrait tracking requires macOS and Apple command line tools (xcode-select --install)."))
    if not shutil.which("ffmpeg"):
        raise HTTPException(status_code=400, detail=error_response("FFMPEG_REQUIRED", "Install ffmpeg and restart the backend to download clips."))
    try:
        inspected = inspect_url(payload.url, app.state.config)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=error_response("INSPECT_FAILED", map_error_message(exc)))
    duration = inspected.get("duration")
    if inspected.get("type") == "playlist" or inspected.get("is_live") or not duration:
        raise HTTPException(status_code=400, detail=error_response("CLIPS_UNAVAILABLE", "Choose a finished video with a known duration to cut clips."))
    if any(clip.end > duration for clip in payload.ranges):
        raise HTTPException(status_code=400, detail=error_response("INVALID_RANGE", "Every clip must end within the video duration."))
    if payload.kind == "audio":
        raise HTTPException(status_code=400, detail=error_response("VIDEO_REQUIRED", "Choose a video format for clips."))
    cues = [cue.model_dump() for cue in payload.captions] if payload.show_captions else []
    if payload.show_captions and (not cues or any(cue["end"] > duration for cue in cues)):
        raise HTTPException(status_code=400, detail=error_response("INVALID_CAPTIONS", "Load a transcript with valid timings before enabling captions."))
    per_clip = [clip_cues(cues, clip.model_dump()) for clip in payload.ranges]
    if payload.show_captions and any(not items for items in per_clip):
        raise HTTPException(status_code=400, detail=error_response("EMPTY_CAPTIONS", "Each selected clip must contain at least one nonempty caption. Edit the transcript or turn captions off."))
    request = DownloadRequest(**payload.model_dump(exclude={"ranges", "show_captions", "captions", "auto_portrait"}))
    ids = [queue_selected_download(request, inspected, clip, items, payload.auto_portrait)["id"] for clip, items in zip(payload.ranges, per_clip)]
    return {"ids": ids}


@app.get("/api/downloads")
def list_downloads_endpoint(status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    return list_downloads(status=status, limit=limit)


@app.get("/api/downloads/{record_id}")
def get_download_endpoint(record_id: str) -> dict[str, Any]:
    record = get_download(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "Download not found"}})
    return record


@app.delete("/api/downloads/{record_id}")
def delete_download_endpoint(record_id: str) -> dict[str, bool]:
    app.state.manager.cancel(record_id)
    delete_download(record_id)
    return {"ok": True}


@app.get("/api/downloads/{record_id}/file")
def download_file(record_id: str) -> FileResponse:
    record = get_download(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "File not found"}})
    file_path = record.get("filepath")
    if not file_path:
        raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "File not found"}})
    try:
        resolved = safe_path(file_path, resolve_download_dir(app.state.config.download_dir))
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": {"code": "INVALID_PATH", "message": "Invalid file path"}})
    if not resolved.exists():
        raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "File not found"}})
    return FileResponse(resolved)


@app.get("/api/settings")
def get_settings() -> dict[str, Any]:
    return {
        **app.state.config.__dict__,
        "caption_style": CaptionStyle(**app.state.config.caption_style).model_dump(),
        "download_dir": str(resolve_download_dir(app.state.config.download_dir)),
    }


@app.put("/api/settings")
def put_settings(payload: SettingsConfig) -> dict[str, Any]:
    cfg = AppConfig(**payload.model_dump())
    target_dir = resolve_download_dir(cfg.download_dir)
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise HTTPException(
            status_code=400,
            detail=error_response("INVALID_DOWNLOAD_DIR", f"Could not create download folder: {exc}"),
        )
    if not os.access(target_dir, os.W_OK):
        raise HTTPException(
            status_code=400,
            detail=error_response("INVALID_DOWNLOAD_DIR", "The selected download folder is not writable."),
        )
    cfg.download_dir = str(target_dir)
    app.state.config = cfg
    app.state.manager.update_config(cfg)
    save_config(cfg)
    return cfg.__dict__


@app.post("/api/settings/validate-cookies")
def validate_cookies() -> dict[str, Any]:
    return {"ok": True, "message": "Cookie validation not run in offline mode."}


frontend_dist = BASE_DIR / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")


@app.get("/{path:path}")
def catch_all(path: str) -> Any:
    index_file = BASE_DIR / "frontend" / "dist" / "index.html"
    if not index_file.exists():
        return {"ok": True, "message": "Frontend not built yet."}
    return FileResponse(index_file)


@app.get("/")
def root() -> FileResponse:
    index_path = BASE_DIR / "frontend" / "dist" / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "Frontend not built yet."}})
    return FileResponse(index_path)
