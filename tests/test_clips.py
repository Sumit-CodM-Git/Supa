from fastapi.testclient import TestClient
import pytest

from backend.main import app
from backend.config import AppConfig
from backend.services.download_manager import DownloadJob, DownloadManager


@pytest.fixture
def clip_api(monkeypatch):
    queued = []
    monkeypatch.setattr("backend.main.shutil.which", lambda name: "/usr/bin/ffmpeg")
    monkeypatch.setattr("backend.main.inspect_url", lambda *args: {
        "type": "video", "title": "Sample", "duration": 100,
        "formats": [{"format_id": "137", "kind": "video", "label": "1080p"}],
    })
    monkeypatch.setattr(app.state.manager, "queue_download", lambda record: queued.append(record) or record["id"])
    return TestClient(app), queued


def request(ranges, **changes):
    return {"url": "https://youtu.be/example", "kind": "video", "format_id": "137", "ranges": ranges, **changes}


def test_batch_queues_separate_clips(clip_api):
    client, queued = clip_api
    ranges = [{"start": 1.5, "end": 10}, {"start": 20, "end": 40}]
    response = client.post("/api/clips", json=request(ranges))
    assert response.status_code == 201
    assert len(set(response.json()["ids"])) == 2
    assert [record["clip"] for record in queued] == ranges
    assert all(record["format_selector"] == "137+bestaudio/best" for record in queued)
    assert "1.5–10s" in queued[0]["label"]


@pytest.mark.parametrize("ranges", [[], [{"start": -1, "end": 10}], [{"start": 10, "end": 10}], [{"start": 20, "end": 10}], [{"start": 0, "end": 10}] * 51])
def test_invalid_ranges_queue_nothing(clip_api, ranges):
    client, queued = clip_api
    assert client.post("/api/clips", json=request(ranges)).status_code == 422
    assert queued == []


def test_out_of_duration_rejects_entire_batch(clip_api):
    client, queued = clip_api
    response = client.post("/api/clips", json=request([{"start": 0, "end": 10}, {"start": 90, "end": 101}]))
    assert response.status_code == 400
    assert queued == []


def test_clips_require_ffmpeg(clip_api, monkeypatch):
    client, queued = clip_api
    monkeypatch.setattr("backend.main.shutil.which", lambda name: None)
    assert client.post("/api/clips", json=request([{"start": 0, "end": 10}])).status_code == 400
    assert queued == []


def test_clips_reject_client_selectors(clip_api):
    client, queued = clip_api
    assert client.post("/api/clips", json=request([{"start": 0, "end": 10}], format_selector="best")).status_code == 422
    assert client.post("/api/clips", json=request([{"start": 0, "end": 10}], format_id="unknown")).status_code == 400
    assert queued == []


@pytest.mark.parametrize("info", [{"type": "playlist"}, {"type": "video", "duration": 100, "is_live": True}, {"type": "video"}])
def test_unsuitable_video_rejected(clip_api, monkeypatch, info):
    client, queued = clip_api
    monkeypatch.setattr("backend.main.inspect_url", lambda *args: info)
    assert client.post("/api/clips", json=request([{"start": 0, "end": 10}])).status_code == 400
    assert queued == []


def test_clip_download_options_and_unique_paths(monkeypatch, tmp_path):
    options = []
    updates = []
    output = tmp_path / "clip.mp4"

    class FakeYDL:
        def __init__(self, opts):
            options.append(opts)
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def extract_info(self, *args, **kwargs):
            output.write_bytes(b"clip")
            return {"filepath": str(output)}

    monkeypatch.setattr("backend.services.download_manager.YoutubeDL", FakeYDL)
    monkeypatch.setattr("backend.services.download_manager.update_download", lambda *args, **kwargs: updates.append(kwargs))
    manager = DownloadManager.__new__(DownloadManager)
    for job_id in ("clip-one", "clip-two"):
        manager._run_job(DownloadJob({"id": job_id, "url": "https://youtu.be/example", "kind": "video", "format_selector": "137+bestaudio/best", "clip": {"start": 1.5, "end": 10}}, AppConfig(download_dir=str(tmp_path))))
    assert options[0]["outtmpl"] != options[1]["outtmpl"]
    assert options[0]["force_keyframes_at_cuts"] is True
    ranges = list(options[0]["download_ranges"]({"duration": 100}, None))
    assert ranges[0]["start_time"] == 1.5
    assert ranges[0]["end_time"] == 10
    assert updates[-1]["status"] == "completed"
