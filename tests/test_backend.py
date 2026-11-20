from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import app
from backend.config import AppConfig
from backend.services.download_manager import DownloadJob, DownloadManager
from backend.services.files import safe_path
from backend.services.format_builder import build_formats
from backend.services.inspect import inspect_url


SAMPLE_INFO = {
    "id": "abc123",
    "title": "Sample video",
    "uploader": "Example Channel",
    "duration": 180,
    "thumbnail": "https://example.com/thumb.jpg",
    "is_live": False,
    "formats": [
        {"format_id": "137", "ext": "mp4", "height": 1080, "fps": 30, "vcodec": "avc1.4d401f", "acodec": "none", "filesize": 5000000, "protocol": "https", "dynamic_range": "SDR"},
        {"format_id": "248", "ext": "webm", "height": 1080, "fps": 30, "vcodec": "vp9", "acodec": "none", "filesize": 4500000, "protocol": "https", "dynamic_range": "SDR"},
        {"format_id": "140", "ext": "m4a", "abr": 128, "acodec": "mp4a.40.2", "vcodec": "none", "filesize": 3000000, "protocol": "https"},
        {"format_id": "251", "ext": "webm", "abr": 160, "acodec": "opus", "vcodec": "none", "filesize": 2500000, "protocol": "https"},
        {"format_id": "18", "ext": "mp4", "height": 360, "fps": 30, "vcodec": "avc1.4d401e", "acodec": "mp4a.40.2", "filesize": 8000000, "protocol": "https", "dynamic_range": "SDR"},
    ],
}


def test_build_formats_outputs_expected_rows():
    result = build_formats(SAMPLE_INFO)
    assert result["title"] == "Sample video"
    assert result["video_id"] == "abc123"
    assert any(item["kind"] == "video" for item in result["formats"])
    assert any(item["kind"] == "audio" for item in result["formats"])
    assert result["formats"][0]["kind"] == "video"
    assert result["formats"][0]["height"] == 1080


def test_inspect_url_playlist(monkeypatch):
    class DummyYDL:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download=False):
            return {
                "_type": "playlist",
                "title": "Playlist",
                "id": "pl123",
                "entries": [
                    {"id": "v1", "title": "A", "duration": 30, "webpage_url": "https://youtu.be/v1", "thumbnails": [{"url": "https://example.com/a.jpg"}]},
                    {"id": "v2", "title": "B", "duration": 40, "webpage_url": "https://youtu.be/v2", "thumbnails": [{"url": "https://example.com/b.jpg"}]},
                ],
            }

    monkeypatch.setattr("backend.services.inspect.YoutubeDL", DummyYDL)
    result = inspect_url("https://www.youtube.com/watch?v=abc123")
    assert result["type"] == "playlist"
    assert result["entries"][0]["id"] == "v1"


def test_download_route_creates_server_selected_job(monkeypatch):
    client = TestClient(app)
    queued = []
    inspected = {
        "type": "video",
        "video_id": "abc123",
        "title": "Sample video",
        "channel": "Example Channel",
        "thumbnail": "https://example.com/thumb.jpg",
        "formats": [
            {
                "kind": "video",
                "format_id": "137",
                "label": "1080p · mp4 · avc1",
                "expected_size": 7000000,
            }
        ],
    }
    monkeypatch.setattr("backend.main.inspect_url", lambda url, cfg: inspected)
    monkeypatch.setattr(app.state.manager, "queue_download", lambda record: queued.append(record) or "job-123")
    response = client.post(
        "/api/downloads",
        json={"url": "https://youtu.be/abc123", "kind": "video", "format_id": "137"},
    )
    assert response.status_code == 201
    assert response.json() == {"id": "job-123"}
    assert queued[0]["format_selector"] == "137+bestaudio/best"
    assert queued[0]["title"] == "Sample video"


def test_download_rejects_unknown_format(monkeypatch):
    client = TestClient(app)
    inspected = {"type": "video", "formats": []}
    monkeypatch.setattr("backend.main.inspect_url", lambda url, cfg: inspected)
    response = client.post(
        "/api/downloads",
        json={"url": "https://youtu.be/abc123", "kind": "video", "format_id": "client-selector"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["error"]["code"] == "FORMAT_NOT_FOUND"


def test_download_rejects_raw_selector():
    client = TestClient(app)
    response = client.post(
        "/api/downloads",
        json={
            "url": "https://youtu.be/abc123",
            "kind": "video",
            "format_id": "137",
            "selector": "137+bestaudio/best",
        },
    )
    assert response.status_code == 422


def test_settings_round_trip_updates_download_directory(tmp_path, monkeypatch):
    client = TestClient(app)
    original_config = app.state.config
    monkeypatch.setattr("backend.main.save_config", lambda config: config)
    selected_dir = tmp_path / "custom-downloads"
    try:
        response = client.put(
            "/api/settings",
            json={"download_dir": str(selected_dir), "max_concurrent": 3, "default_container": "mp4"},
        )
        assert response.status_code == 200
        cfg = client.get("/api/settings").json()
        assert cfg["max_concurrent"] == 3
        assert cfg["download_dir"] == str(selected_dir.resolve())
        assert selected_dir.is_dir()
    finally:
        app.state.config = original_config
        app.state.manager.update_config(original_config)


def test_download_manager_persists_completed_file_path(monkeypatch, tmp_path):
    saved_updates = []
    output_file = tmp_path / "sample.mp4"

    class FakeYDL:
        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download=False):
            output_file.write_bytes(b"video")
            self.options["postprocessor_hooks"][0](
                {"status": "finished", "info_dict": {"filepath": str(output_file)}}
            )
            return {"filepath": str(output_file)}

    monkeypatch.setattr("backend.services.download_manager.YoutubeDL", FakeYDL)
    monkeypatch.setattr(
        "backend.services.download_manager.update_download",
        lambda record_id, **fields: saved_updates.append(fields),
    )
    manager = DownloadManager.__new__(DownloadManager)
    job = DownloadJob(
        {
            "id": "job-456",
            "url": "https://youtu.be/abc123",
            "title": "Sample",
            "kind": "video",
            "format_id": "137",
            "format_selector": "137+bestaudio/best",
            "container": "mp4",
        },
        AppConfig(download_dir=str(tmp_path)),
    )

    manager._run_job(job)

    assert output_file.is_file()
    assert any(update.get("status") == "completed" for update in saved_updates)
    assert saved_updates[-1]["filepath"] == str(output_file)


def test_safe_path_rejects_traversal():
    base = Path(__file__).resolve().parent.parent / "tmp-test-base"
    base.mkdir(exist_ok=True)
    try:
        safe_path(base / "../escape.txt", base)
    except ValueError:
        assert True
    else:
        raise AssertionError("Expected ValueError for traversal")
    finally:
        if base.exists():
            for child in base.iterdir():
                if child.is_file():
                    child.unlink()
            base.rmdir()


def test_format_inference_estimates_sizes_and_handles_empty_thumbnails():
    result = build_formats({
        "duration": 10,
        "thumbnails": [],
        "formats": [
            {"format_id": "v", "ext": "mp4", "height": 720, "tbr": 1000},
            {"format_id": "a", "ext": "m4a", "resolution": "audio only", "abr": 128},
            {"format_id": "drm", "height": 1080, "vcodec": "avc1", "has_drm": True},
            {"format_id": "sb0", "ext": "mhtml"},
        ],
    })
    assert result["thumbnail"] is None
    assert result["type"] == "video"
    assert [row["format_id"] for row in result["formats"]] == ["v", "a"]
    assert result["formats"][0]["expected_size"] == 1410000
    assert result["formats"][1]["expected_size"] == 160000


def test_inspect_endpoint_exposes_all_format_kinds(monkeypatch):
    monkeypatch.setattr("backend.main.inspect_url", lambda url, cfg: build_formats(SAMPLE_INFO))
    response = TestClient(app).post("/api/inspect", json={"url": "https://youtu.be/abc123"})
    assert response.status_code == 200
    assert {row["kind"] for row in response.json()["formats"]} == {"video", "audio", "combined"}


def test_mp3_bitrate_is_validated_and_queued(monkeypatch):
    inspected = build_formats(SAMPLE_INFO)
    queued = []
    monkeypatch.setattr("backend.main.inspect_url", lambda url, cfg: inspected)
    monkeypatch.setattr(app.state.manager, "queue_download", lambda record: queued.append(record) or "audio-job")
    client = TestClient(app)
    for bitrate in (320, 256, 128):
        response = client.post("/api/downloads", json={
            "url": "https://youtu.be/abc123", "kind": "audio", "format_id": "251",
            "audio_format": "mp3", "audio_bitrate": bitrate,
        })
        assert response.status_code == 201
        assert queued[-1]["audio_bitrate"] == bitrate
        assert queued[-1]["format_selector"] == "251"
    response = client.post("/api/downloads", json={
        "url": "https://youtu.be/abc123", "kind": "audio", "format_id": "251",
        "audio_format": "mp3", "audio_bitrate": 999,
    })
    assert response.status_code == 422


def test_download_manager_uses_selected_mp3_bitrate(monkeypatch, tmp_path):
    options = []
    output_file = tmp_path / "audio.mp3"

    class FakeYDL:
        def __init__(self, opts):
            options.append(opts)
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def extract_info(self, url, download=False):
            output_file.write_bytes(b"audio")
            return {"filepath": str(output_file)}

    monkeypatch.setattr("backend.services.download_manager.YoutubeDL", FakeYDL)
    monkeypatch.setattr("backend.services.download_manager.update_download", lambda *args, **kwargs: None)
    manager = DownloadManager.__new__(DownloadManager)
    manager._run_job(DownloadJob({
        "id": "mp3-job", "url": "https://youtu.be/abc123", "kind": "audio",
        "format_selector": "251", "audio_format": "mp3", "audio_bitrate": 320,
    }, AppConfig(download_dir=str(tmp_path))))
    assert options[0]["postprocessors"][0] == {
        "key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "320",
    }


def test_extraction_uses_default_clients_and_available_runtimes(monkeypatch):
    from backend.services.ytdlp_opts import base_opts
    monkeypatch.setattr('backend.services.ytdlp_opts.shutil.which', lambda name: '/bin/node' if name == 'node' else None)
    for clients in (None, [], ['android', 'web']):
        opts = base_opts(AppConfig(player_clients=clients), skip_download=True)
        assert 'extractor_args' not in opts
        assert opts['js_runtimes'] == {'node': {'path': '/bin/node'}}
        assert opts['no_warnings'] is False
        assert opts['cachedir'] is False
        assert opts['skip_download'] is True
    custom = base_opts(AppConfig(player_clients=['default', '-web']))
    assert custom['extractor_args']['youtube']['player_client'] == ['default', '-web']


def test_all_distinct_source_formats_are_preserved():
    info = {**SAMPLE_INFO, 'formats': [
        *SAMPLE_INFO['formats'],
        {**SAMPLE_INFO['formats'][0], 'format_id': '270', 'protocol': 'm3u8_native'},
        {**SAMPLE_INFO['formats'][0], 'format_id': '137-low', 'filesize': 1000000},
    ]}
    rows = build_formats(info)['formats']
    assert len(rows) == len(info['formats'])
    assert {row['format_id'] for row in rows} == {fmt['format_id'] for fmt in info['formats']}
    assert next(row for row in rows if row['format_id'] == '270')['protocol'] == 'm3u8_native'


def test_legacy_client_settings_migrate_to_defaults(tmp_path, monkeypatch):
    import backend.config as config
    config_path = tmp_path / 'config.json'
    config_path.write_text('{"player_clients": ["android", "web"]}')
    monkeypatch.setattr(config, 'CONFIG_PATH', config_path)
    monkeypatch.setattr(config, 'ensure_dirs', lambda: None)
    assert config.load_config().player_clients == []
