from __future__ import annotations

import json
import os
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any

from backend.services.files import safe_path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DOWNLOAD_DIR = BASE_DIR / "downloads"
CONFIG_PATH = DATA_DIR / "config.json"


@dataclass
class AppConfig:
    default_caption_language: str = "original"
    captions_enabled: bool = False
    auto_portrait: bool = False
    caption_style: dict = field(default_factory=dict)
    download_dir: str = "./downloads"
    max_concurrent: int = 2
    cookiefile: str | None = None
    cookies_from_browser: str | None = None
    proxy: str | None = None
    player_clients: list[str] | None = None
    default_container: str = "mp4"
    prefer_mp4: bool = True
    subtitle_langs: list[str] | None = None
    keep_original: bool = False
    filename_template: str = "%(title).150B [%(id)s].%(ext)s"

    @classmethod
    def defaults(cls) -> "AppConfig":
        return cls(
            download_dir="./downloads",
            max_concurrent=2,
            cookiefile=None,
            cookies_from_browser=None,
            proxy=None,
            player_clients=[],
            default_container="mp4",
            prefer_mp4=True,
            subtitle_langs=["en"],
            keep_original=False,
            filename_template="%(title).150B [%(id)s].%(ext)s",
        )


def _coerce(value: Any, default: Any) -> Any:
    return value if value is not None else default


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)


def resolve_download_dir(download_dir: str) -> Path:
    path = Path(download_dir).expanduser()
    if not path.is_absolute():
        path = BASE_DIR / path
    return path.resolve()


def load_config() -> AppConfig:
    ensure_dirs()
    config_path = safe_path(CONFIG_PATH, CONFIG_PATH.parent)
    if config_path.exists():
        try:
            cfg_data = json.loads(config_path.read_text())
        except json.JSONDecodeError:
            cfg_data = {}
    else:
        cfg_data = {}

    defaults = AppConfig.defaults()
    config = AppConfig(**{**asdict(defaults), **cfg_data})

    env_download_dir = os.getenv("DOWNLOAD_DIR")
    if env_download_dir:
        config.download_dir = env_download_dir

    values = {
        "cookiefile": os.getenv("COOKIEFILE") or config.cookiefile,
        "proxy": os.getenv("PROXY") or config.proxy,
    }
    for key, value in values.items():
        if value is not None and value != "":
            setattr(config, key, value)

    if config.player_clients is None or config.player_clients == ["android", "web"]:
        config.player_clients = defaults.player_clients
    if config.subtitle_langs is None:
        config.subtitle_langs = defaults.subtitle_langs
    return config


def save_config(config: AppConfig) -> AppConfig:
    ensure_dirs()
    if hasattr(config, "model_dump"):
        payload = config.model_dump()
    elif hasattr(config, "__dict__") and config.__class__.__name__ != "AppConfig":
        payload = config.__dict__
    else:
        payload = asdict(config)
    destination = safe_path(CONFIG_PATH, CONFIG_PATH.parent)
    temporary = safe_path(CONFIG_PATH.with_suffix(".tmp"), CONFIG_PATH.parent)
    temporary.write_text(json.dumps(payload, indent=2))
    temporary.replace(destination)
    return config


DEFAULT_CONFIG = load_config()
