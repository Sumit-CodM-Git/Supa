from __future__ import annotations

from typing import Any


def map_error_message(exception: Exception) -> str:
    text = str(exception).lower()
    if "sign in to confirm you" in text or "bot" in text:
        return "YouTube is blocking anonymous requests. Set a cookies file in Settings (export from your browser with a cookies.txt extension)."
    if "private video" in text or "unavailable" in text:
        return "Video is private or unavailable."
    if "age-restricted" in text or "confirm your age" in text:
        return "Age-restricted — requires cookies from a signed-in session."
    if "not available in your country" in text or "geo" in text:
        return "Geo-restricted. Set a proxy in Settings."
    if "ffmpeg" in text or "ffprobe" in text:
        return "ffmpeg not found on PATH. Install it, then restart the app."
    if "requested format is not available" in text:
        return "That format disappeared. Re-fetch the format list."
    if "403" in text or "forbidden" in text:
        return "YouTube rejected the request (token expired). Update yt-dlp and retry."
    return str(exception)[:500]


def error_response(code: str, message: str) -> dict[str, Any]:
    return {"error": {"code": code, "message": message}}
