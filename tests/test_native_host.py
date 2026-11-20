import io
import json
import struct

import pytest

from backend import install_native_host, native_host


def frame(message):
    raw = json.dumps(message).encode()
    return struct.pack("=I", len(raw)) + raw


def test_native_protocol():
    assert native_host.read_message(io.BytesIO(frame({"action": "start"}))) == {"action": "start"}


@pytest.mark.parametrize("raw", [b"", b"abc", struct.pack("=I", 5000), struct.pack("=I", 10) + b"{}", frame({"action": "execute", "command": "ls"}), frame(["start"])])
def test_native_protocol_rejects_invalid_messages(raw):
    with pytest.raises(ValueError):
        native_host.read_message(io.BytesIO(raw))


def test_running_backend_is_reused(monkeypatch):
    monkeypatch.setattr(native_host, "backend_ready", lambda: True)
    monkeypatch.setattr(native_host.subprocess, "Popen", lambda *args, **kwargs: pytest.fail("Must reuse running backend"))
    assert native_host.ensure_backend() == {"ok": True, "started": False}


def test_native_host_starts_detached_loopback_backend(monkeypatch, tmp_path):
    monkeypatch.setattr(native_host, "BASE_DIR", tmp_path)
    monkeypatch.setattr(native_host, "DATA_DIR", tmp_path / "data")
    readiness = iter([False, False, True])
    monkeypatch.setattr(native_host, "backend_ready", lambda: next(readiness))
    launched = []
    monkeypatch.setattr(native_host.subprocess, "Popen", lambda *args, **kwargs: launched.append((args, kwargs)))
    assert native_host.ensure_backend() == {"ok": True, "started": True}
    args, kwargs = launched[0]
    assert args[0][-4:] == ["--host", "127.0.0.1", "--port", "8000"]
    assert kwargs["start_new_session"] is True
    assert kwargs["stdin"] == native_host.subprocess.DEVNULL
    assert kwargs["cwd"] == tmp_path


def test_native_install_limits_origin_and_quotes_paths(monkeypatch, tmp_path):
    project = tmp_path / "project with spaces"
    monkeypatch.setattr(install_native_host, "BASE_DIR", project)
    monkeypatch.setattr(install_native_host, "DATA_DIR", project / "data")
    extension_id = "mdnnnioiamjhbajbcnnphppphjlmdend"
    manifest_path = install_native_host.install(extension_id, tmp_path / "hosts")
    manifest = json.loads(manifest_path.read_text())
    assert manifest["allowed_origins"] == [f"chrome-extension://{extension_id}/"]
    launcher = project / "data/start-native-host.sh"
    assert manifest["path"] == str(launcher)
    assert "'" + str(project) + "'" in launcher.read_text()
    assert launcher.stat().st_mode & 0o100


def test_native_install_rejects_invalid_id(tmp_path):
    with pytest.raises(ValueError):
        install_native_host.install("invalid", tmp_path / "hosts")
    assert not (tmp_path / "hosts").exists()
