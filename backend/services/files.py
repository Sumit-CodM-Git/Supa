from __future__ import annotations

import os
from pathlib import Path


def safe_path(target: str | Path, base_dir: str | Path) -> Path:
    base = Path(base_dir).resolve()
    candidate = Path(target).resolve()
    if os.path.commonpath([str(base), str(candidate)]) != str(base):
        raise ValueError("Path escapes the download directory")
    return candidate
