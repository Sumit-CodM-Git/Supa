"""Chrome native messaging host: start this project's loopback backend only."""
from __future__ import annotations

import fcntl
import json
import os
import struct
import subprocess
import sys
import time
import urllib.request

from backend.config import BASE_DIR, DATA_DIR
from backend.services.files import safe_path

HOST_NAME = "com.local.youtube_downloader"


def backend_ready() -> bool:
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open("http://127.0.0.1:8000/api/health", timeout=2) as response:
            result = json.load(response)
        return result.get("ok") is True and "yt_dlp_version" in result
    except Exception:
        return False


def ensure_backend() -> dict:
    if backend_ready():
        return {"ok": True, "started": False}
    data_dir = safe_path(DATA_DIR, BASE_DIR)
    data_dir.mkdir(parents=True, exist_ok=True)
    with safe_path(data_dir / "native-start.lock", data_dir).open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if backend_ready():
            return {"ok": True, "started": False}
        env = dict(os.environ)
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + env.get("PATH", "/usr/bin:/bin")
        log_path = safe_path(data_dir / "backend.log", data_dir)
        with log_path.open("ab") as log:
            process = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000"],
                cwd=BASE_DIR, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                start_new_session=True, close_fds=True,
            )
        for _ in range(60):
            if backend_ready():
                return {"ok": True, "started": True}
            if process.poll() is not None:
                break
            time.sleep(0.25)
        return {"ok": False, "error": f"Backend did not start. See {log_path}."}


def read_message(stream) -> dict:
    header = stream.read(4)
    if len(header) != 4:
        raise ValueError("Missing native message header")
    length = struct.unpack("=I", header)[0]
    if not 0 < length <= 4096:
        raise ValueError("Invalid native message size")
    raw = stream.read(length)
    if len(raw) != length:
        raise ValueError("Incomplete native message")
    message = json.loads(raw)
    if message != {"action": "start"}:
        raise ValueError("Unsupported native action")
    return message


def main() -> None:
    try:
        read_message(sys.stdin.buffer)
        result = ensure_backend()
    except Exception as exc:
        result = {"ok": False, "error": str(exc)}
    encoded = json.dumps(result).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)) + encoded)
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
