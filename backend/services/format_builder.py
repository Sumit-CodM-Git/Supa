from __future__ import annotations

from typing import Any


def _codec_family(vcodec: str | None) -> str:
    if not vcodec:
        return "unknown"
    code = vcodec.strip().lower()
    if code.startswith("avc1"):
        return "avc1"
    if code.startswith("vp9"):
        return "vp9"
    if code.startswith("av01"):
        return "av01"
    if code.startswith("hvc1") or code.startswith("hev1"):
        return "hevc"
    return code.split()[0]


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def build_formats(info: dict[str, Any]) -> dict[str, Any]:
    formats = info.get("formats") or []
    valid = []
    for fmt in formats:
        if not fmt:
            continue
        format_id = str(fmt.get("format_id", ""))
        if format_id.startswith("storyboard"):
            continue
        ext = str(fmt.get("ext", "")).lower()
        if ext == "mhtml":
            continue
        protocol = str(fmt.get("protocol", "")).lower()
        if protocol.startswith("mhtml"):
            continue
        if not format_id or fmt.get("has_drm"):
            continue
        fmt = dict(fmt)
        # Some extractors omit codec names but still identify the media streams.
        if fmt.get("vcodec") is None:
            if fmt.get("height") or fmt.get("width") or fmt.get("video_ext") not in (None, "none"):
                fmt["vcodec"] = "unknown"
            elif fmt.get("resolution") == "audio only" or fmt.get("audio_ext") not in (None, "none"):
                fmt["vcodec"] = "none"
        if fmt.get("acodec") is None:
            if fmt.get("audio_ext") not in (None, "none") or fmt.get("abr"):
                fmt["acodec"] = "unknown"
        valid.append(fmt)

    audio_only = []
    video_only = []
    combined = []

    for fmt in valid:
        vcodec = fmt.get("vcodec")
        acodec = fmt.get("acodec")
        if vcodec not in (None, "none") and acodec in (None, "none"):
            video_only.append(fmt)
        elif vcodec not in (None, "none") and acodec not in (None, "none"):
            combined.append(fmt)
        elif vcodec in (None, "none") and acodec not in (None, "none"):
            audio_only.append(fmt)

    def estimated_size(fmt: dict[str, Any]) -> int:
        size = _safe_float(fmt.get("filesize") or fmt.get("filesize_approx"))
        if not size:
            bitrate = _safe_float(fmt.get("tbr") or fmt.get("abr") or fmt.get("vbr"))
            size = bitrate * 1000 * _safe_float(info.get("duration")) / 8
        return max(0, int(size))

    best_audio_format = max(audio_only, key=lambda f: (_safe_float(f.get("abr") or f.get("tbr")), estimated_size(f)), default={})
    best_audio = estimated_size(best_audio_format)
    rows: list[dict[str, Any]] = []

    for fmt in video_only:
        height = fmt.get("height")
        fps = fmt.get("fps") or 0
        vcodec = fmt.get("vcodec") or "unknown"
        drange = fmt.get("dynamic_range") or "SDR"
        ext = fmt.get("ext") or "mp4"
        size = estimated_size(fmt)
        rows.append(
            {
                "kind": "video",
                "format_id": str(fmt.get("format_id", "")),
                "protocol": fmt.get("protocol"),
                "height": height,
                "fps": fps,
                "vcodec": vcodec,
                "drange": drange,
                "ext": ext,
                "expected_size": int(size + best_audio),
                "selector": f"{fmt.get('format_id')}+bestaudio/best",
            }
        )

    for fmt in audio_only:
        rows.append(
            {
                "kind": "audio",
                "format_id": str(fmt.get("format_id", "")),
                "protocol": fmt.get("protocol"),
                "abr": fmt.get("abr") or 0,
                "acodec": fmt.get("acodec") or "unknown",
                "ext": fmt.get("ext") or "m4a",
                "expected_size": estimated_size(fmt),
                "selector": str(fmt.get("format_id", "")),
            }
        )

    for fmt in combined:
        height = fmt.get("height")
        rows.append(
            {
                "kind": "combined",
                "format_id": str(fmt.get("format_id", "")),
                "protocol": fmt.get("protocol"),
                "height": height,
                "fps": fmt.get("fps") or 0,
                "vcodec": fmt.get("vcodec") or "unknown",
                "drange": fmt.get("dynamic_range") or "SDR",
                "ext": fmt.get("ext") or "mp4",
                "expected_size": estimated_size(fmt),
                "selector": str(fmt.get("format_id", "")),
            }
        )

    # Keep distinct source formats, including protocol and codec variants.
    video_rows = [row for row in rows if row["kind"] == "video"]

    audio_rows = sorted(
        [row for row in rows if row["kind"] == "audio"],
        key=lambda item: (item.get("abr") or 0, item.get("expected_size") or 0),
        reverse=True,
    )
    combined_rows = sorted(
        [row for row in rows if row["kind"] == "combined"],
        key=lambda item: (item.get("height") or 0, item.get("fps") or 0, item.get("expected_size") or 0),
        reverse=True,
    )

    def _label(row: dict[str, Any]) -> str:
        kind = row["kind"]
        if kind == "video":
            height = row.get("height")
            res = f"{height}p" if height else "video"
            fps = row.get("fps")
            fps_part = f"{int(fps)}" if fps else ""
            if fps and fps_part:
                res = f"{res} · {fps_part} fps"
            codec = _codec_family(row.get("vcodec"))
            return f"{res} · {row.get('ext', 'mp4')} · {codec}"
        if kind == "audio":
            abr = row.get("abr")
            return f"Audio · {row.get('ext', 'm4a')} · {abr} kbps" if abr else f"Audio · {row.get('ext', 'm4a')}"
        height = row.get("height")
        res = f"{height}p" if height else "combined"
        return f"{res} · {row.get('ext', 'mp4')} · {_codec_family(row.get('vcodec'))}"

    output = {
        "type": "video",
        "title": info.get("title", "Unknown title"),
        "video_id": info.get("id") or info.get("video_id"),
        "channel": info.get("uploader") or info.get("channel") or "Unknown channel",
        "duration": int(info.get("duration") or 0),
        "thumbnail": info.get("thumbnail") or (info.get("thumbnails") or [{}])[-1].get("url"),
        "upload_date": info.get("upload_date"),
        "is_live": bool(info.get("is_live")),
        "formats": [],
        "subtitles": list(info.get("subtitles", {}).keys()) if isinstance(info.get("subtitles"), dict) else [],
        "audio_languages": list(info.get("audio_languages", {}).keys()) if isinstance(info.get("audio_languages"), dict) else [],
    }

    for row in sorted(video_rows, key=lambda item: (item.get("height") or 0, item.get("fps") or 0, item.get("expected_size") or 0), reverse=True):
        output["formats"].append({
            "kind": "video",
            "format_id": row["format_id"],
            "protocol": row.get("protocol"),
            "label": _label(row),
            "height": row.get("height"),
            "fps": row.get("fps"),
            "ext": row.get("ext"),
            "vcodec": row.get("vcodec"),
            "drange": row.get("drange"),
            "expected_size": row.get("expected_size"),
        })

    for row in audio_rows:
        output["formats"].append({
            "kind": "audio",
            "format_id": row["format_id"],
            "protocol": row.get("protocol"),
            "label": _label(row),
            "abr": row.get("abr"),
            "ext": row.get("ext"),
            "acodec": row.get("acodec"),
            "expected_size": row.get("expected_size"),
        })

    for row in combined_rows:
        output["formats"].append({
            "kind": "combined",
            "format_id": row["format_id"],
            "protocol": row.get("protocol"),
            "label": _label(row),
            "height": row.get("height"),
            "fps": row.get("fps"),
            "ext": row.get("ext"),
            "vcodec": row.get("vcodec"),
            "drange": row.get("drange"),
            "expected_size": row.get("expected_size"),
        })

    return output
