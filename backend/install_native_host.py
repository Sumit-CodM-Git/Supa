"""Install the Chrome native host for one explicitly selected extension on macOS."""
import argparse
import json
from pathlib import Path
import re
import shlex
import sys

from backend.config import BASE_DIR, DATA_DIR
from backend.native_host import HOST_NAME
from backend.services.files import safe_path


def install(extension_id: str, host_directory: Path | None = None) -> Path:
    if not re.fullmatch(r"[a-p]{32}", extension_id):
        raise ValueError("Chrome extension ID must contain 32 letters from a to p.")
    directory = host_directory or Path.home() / "Library/Application Support/Google/Chrome/NativeMessagingHosts"
    directory = safe_path(directory, directory)
    directory.mkdir(parents=True, exist_ok=True)
    data_dir = safe_path(DATA_DIR, BASE_DIR)
    data_dir.mkdir(parents=True, exist_ok=True)
    launcher = safe_path(data_dir / "start-native-host.sh", data_dir)
    launcher.write_text(
        "#!/bin/sh\ncd -- " + shlex.quote(str(BASE_DIR)) + " || exit 1\nexec "
        + shlex.quote(sys.executable) + " -m backend.native_host \"$@\"\n"
    )
    launcher.chmod(0o755)
    manifest = safe_path(directory / f"{HOST_NAME}.json", directory)
    manifest.write_text(json.dumps({
        "name": HOST_NAME,
        "description": "Start the local YouTube Downloader backend",
        "path": str(launcher),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{extension_id}/"],
    }, indent=2) + "\n")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("extension_id")
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("This installer supports Google Chrome on macOS.")
    try:
        manifest = install(args.extension_id)
    except ValueError as exc:
        parser.error(str(exc))
    print(f"Installed automatic startup: {manifest}")
    print("Reload the extension at chrome://extensions, then click its toolbar icon.")


if __name__ == "__main__":
    main()
