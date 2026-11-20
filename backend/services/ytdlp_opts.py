from __future__ import annotations

import shutil

from backend.config import AppConfig


def base_opts(cfg: AppConfig, *, skip_download: bool = False) -> dict:
    opts: dict = {
        "quiet": True,
        "no_warnings": False,
        "noprogress": True,
        "socket_timeout": 20,
        "retries": 3,
        "cookiefile": cfg.cookiefile or None,
        "proxy": cfg.proxy or None,
        "cachedir": False,
        "js_runtimes": {
            name: {"path": path}
            for name in ("deno", "node")
            if (path := shutil.which(name))
        },
    }
    # Migrate the original hard-coded clients, including persisted settings.
    # An empty list delegates client selection to yt-dlp's maintained defaults.
    clients = cfg.player_clients
    if clients and clients != ["android", "web"]:
        opts["extractor_args"] = {"youtube": {"player_client": clients}}
    if skip_download:
        opts["skip_download"] = True
    return {k: v for k, v in opts.items() if v is not None}
