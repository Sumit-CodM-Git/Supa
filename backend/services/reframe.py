"""Local person detection and smooth 9:16 crop planning; no downloaded models."""
from __future__ import annotations

import hashlib
import json
import math
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from yt_dlp.utils import DownloadCancelled

from backend.config import BASE_DIR, DATA_DIR
from backend.services.files import safe_path

_compile_lock = threading.Lock()


def tracking_available():
    return sys.platform == "darwin" and bool(shutil.which("swiftc"))


def run_cancelable(command, job, **kwargs):
    if job.cancel_requested:
        raise DownloadCancelled("canceled")
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    try:
        while True:
            if job.cancel_requested:
                raise DownloadCancelled("canceled")
            try:
                output, error = process.communicate(timeout=0.2)
                break
            except subprocess.TimeoutExpired:
                continue
        if process.returncode:
            raise ValueError("Automatic portrait processing failed: " + error.decode(errors="replace")[-1200:])
        return output
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()


def tracker_binary(job):
    if not tracking_available():
        raise ValueError("Automatic portrait tracking requires macOS and Apple's Swift command line tools (xcode-select --install).")
    source = safe_path(BASE_DIR / "backend/native/track_people.swift", BASE_DIR)
    signature = hashlib.sha256(source.read_bytes()).hexdigest()[:16]
    root = safe_path(DATA_DIR / "native", BASE_DIR)
    root.mkdir(parents=True, exist_ok=True)
    binary = safe_path(root / ("track-people-" + signature), root)
    with _compile_lock:
        if not binary.is_file():
            cache = safe_path(root / "module-cache", root)
            cache.mkdir(exist_ok=True)
            temporary = safe_path(root / (binary.name + ".building"), root)
            try:
                run_cancelable([shutil.which("swiftc"), "-O", "-module-cache-path", str(cache), str(source), "-o", str(temporary)], job)
                temporary.replace(binary)
            finally:
                temporary.unlink(missing_ok=True)
    return binary


def plan_tracking(samples):
    """Prefer the prominent person, retain continuity, and hold through gaps."""
    result = []
    previous = None
    detections = 0
    for sample in samples:
        time = float(sample["time"])
        if not math.isfinite(time) or time < 0 or (result and time <= result[-1]["time"]):
            raise ValueError("Invalid person tracking timestamps.")
        candidates = [p for p in sample["people"] if all(math.isfinite(p[k]) for k in ("x", "y", "area")) and 0 <= p["x"] <= 1 and 0 <= p["y"] <= 1 and p["area"] > 0]
        if candidates:
            detections += 1
            largest = max(p["area"] for p in candidates)
            candidates = [p for p in candidates if p["area"] >= largest * 0.25]
            chosen = max(candidates, key=lambda p: p["area"]) if previous is None else min(candidates, key=lambda p: abs(p["x"] - previous[0]) + 0.25 * abs(p["y"] - previous[1]) - 0.08 * p["area"] / largest)
            target = (chosen["x"], chosen["y"])
            if previous is None or abs(target[0] - previous[0]) > 0.35:
                previous = target
            else:
                previous = tuple(old if abs(new - old) < 0.015 else old + 0.55 * (new - old) for old, new in zip(previous, target))
        result.append({"time": time, "x": previous[0] if previous else None, "y": previous[1] if previous else None})
    first = next((point for point in result if point["x"] is not None), {"x": 0.5, "y": 0.5})
    for point in result:
        if point["x"] is None:
            point.update(x=first["x"], y=first["y"])
    return result, detections


def track_people(source: Path, job):
    binary = tracker_binary(job)
    source = safe_path(source, source.parent)
    raw = run_cancelable(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height,sample_aspect_ratio:stream_side_data=rotation", "-of", "json", str(source)], job)
    stream = json.loads(raw)["streams"][0]
    width, height = int(stream["width"]), int(stream["height"])
    sar = stream.get("sample_aspect_ratio", "1:1").split(":")
    if len(sar) == 2 and all(part.isdigit() for part in sar) and int(sar[1]) > 0:
        width = max(2, round(width * int(sar[0]) / int(sar[1])))
    rotation = next((float(item["rotation"]) for item in stream.get("side_data_list", []) if "rotation" in item), 0)
    if round(rotation) % 180:
        width, height = height, width
    if min(width, height) < 32:
        raise ValueError("Video dimensions are too small for portrait tracking.")
    # A small H.264 analysis copy also supports sources macOS cannot decode,
    # including WebM/VP9 and MKV. The original stays untouched for final export.
    with tempfile.TemporaryDirectory(prefix="tracking-", dir=source.parent) as temporary:
        work = safe_path(temporary, source.parent)
        analysis = safe_path(work / "analysis.mp4", work)
        run_cancelable(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source),
                        "-map", "0:v:0", "-an", "-sn", "-dn", "-vf",
                        "fps=2.5,scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
                        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p",
                        "-map_metadata", "-1", "-write_tmcd", "0", str(analysis)], job)
        output = run_cancelable([str(binary), str(analysis)], job)
    data = json.loads(output)
    if not data.get("samples"):
        raise ValueError("No video frames could be analyzed for person tracking.")
    points, detections = plan_tracking(data["samples"])
    return {"width": width, "height": height, "points": points, "detections": detections}


def portrait_filter(plan, work: Path):
    width, height = plan["width"], plan["height"]
    units = min(width // 18, height // 32)
    crop_width, crop_height = units * 18, units * 32
    points = plan["points"]
    def position(point):
        return (max(0, min(width - crop_width, width * point["x"] - crop_width / 2)),
                max(0, min(height - crop_height, height * point["y"] - crop_height / 2)))
    commands = []
    for start, end in zip(points, points[1:]):
        left, top = position(start)
        right, bottom = position(end)
        commands.append(f"{start['time']:.6f}-{end['time']:.6f} [expr] crop@portrait x '{left:.4f}+({right - left:.4f})*TI', [expr] crop@portrait y '{top:.4f}+({bottom - top:.4f})*TI';")
    last = points[-1]
    x, y = position(last)
    commands.append(f"{last['time']:.6f} crop@portrait x {x:.4f}, crop@portrait y {y:.4f};")
    safe_path(work / "tracking.cmd", work).write_text("\n".join(commands), encoding="utf-8")
    x, y = position(points[0])
    return f"scale={width}:{height},setsar=1,sendcmd=f=tracking.cmd,crop@portrait={crop_width}:{crop_height}:{x:.4f}:{y:.4f},scale=1080:1920,setsar=1"
