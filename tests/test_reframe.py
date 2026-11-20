from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from yt_dlp.utils import DownloadCancelled

from backend.main import app
from backend.services.reframe import plan_tracking, portrait_filter, run_cancelable
from test_clips import clip_api, request


def sample(time, *centers):
    return {"time": time, "people": [{"x": x, "y": 0.5, "area": area} for x, area in centers]}


def test_tracking_follows_moving_person_and_holds_through_gaps():
    points, detections = plan_tracking([
        sample(0), sample(0.4, (0.2, 0.1)), sample(0.8, (0.4, 0.1)), sample(1.2), sample(1.6, (0.5, 0.1)),
    ])
    assert detections == 3
    assert points[0]["x"] == points[1]["x"] == 0.2
    assert 0.2 < points[2]["x"] < 0.4
    assert points[3]["x"] == points[2]["x"]
    assert points[4]["x"] > points[3]["x"]


def test_tracking_keeps_subject_with_multiple_people_and_centers_empty_scene():
    points, _ = plan_tracking([sample(0, (0.2, 0.2), (0.8, 0.1)), sample(0.4, (0.25, 0.1), (0.8, 0.2))])
    assert points[1]["x"] < 0.4
    points, detections = plan_tracking([sample(0), sample(0.4)])
    assert detections == 0 and all(p["x"] == p["y"] == 0.5 for p in points)


def test_portrait_filter_has_exact_ratio_bounded_pan_and_interpolation(tmp_path):
    points, _ = plan_tracking([sample(0, (0.05, 0.2)), sample(0.4, (0.95, 0.2))])
    filters = portrait_filter({"width": 1920, "height": 1080, "points": points}, tmp_path)
    assert "crop@portrait=594:1056" in filters
    assert "scale=1080:1920,setsar=1" in filters
    commands = (tmp_path / "tracking.cmd").read_text()
    assert "*TI" in commands and "crop@portrait x" in commands
    assert "0.0000+(1326.0000)" in commands


def test_portrait_request_is_queued_with_captions(clip_api, monkeypatch):
    monkeypatch.setattr("backend.main.tracking_available", lambda: True)
    client, queued = clip_api
    response = client.post("/api/clips", json=request([{"start": 0, "end": 5}], auto_portrait=True, show_captions=True, captions=[{"start": 0, "end": 5, "text": "Edited"}]))
    assert response.status_code == 201
    assert queued[0]["auto_portrait"] is True
    assert queued[0]["captions"][0]["text"] == "Edited"
    assert "9:16" in queued[0]["label"]


def test_portrait_request_rejects_unavailable_tracker_before_queue(clip_api, monkeypatch):
    monkeypatch.setattr("backend.main.tracking_available", lambda: False)
    client, queued = clip_api
    response = client.post("/api/clips", json=request([{"start": 0, "end": 5}], auto_portrait=True))
    assert response.status_code == 400
    assert response.json()["detail"]["error"]["code"] == "TRACKING_UNAVAILABLE"
    assert not queued


def test_tracker_cancellation_stops_child_process(monkeypatch):
    job = SimpleNamespace(cancel_requested=False)
    killed = []
    class Process:
        def __init__(self, *args, **kwargs): job.cancel_requested = True
        def poll(self): return None
        def kill(self): killed.append(True)
        def communicate(self): return b"", b""
    monkeypatch.setattr("backend.services.reframe.subprocess.Popen", Process)
    with pytest.raises(DownloadCancelled):
        run_cancelable(["tracker"], job)
    assert killed


def test_render_crops_before_captions_and_uses_mp4(tmp_path, monkeypatch):
    from pathlib import Path
    from backend.services.captions import burn_captions
    source = tmp_path / 'clip.webm'
    source.write_bytes(b'original')
    points, _ = plan_tracking([sample(0, (0.3, 0.2)), sample(0.4, (0.4, 0.2))])
    monkeypatch.setattr('backend.services.captions.track_people', lambda *args: {'width': 640, 'height': 360, 'points': points, 'detections': 2})
    class Process:
        returncode = 0
        def __init__(self, command, **kwargs):
            filters = command[command.index('-vf') + 1]
            assert filters.index('crop@portrait') < filters.index('subtitles=')
            assert 'scale=1080:1920' in filters
            assert (kwargs['cwd'] / 'tracking.cmd').exists()
            Path(command[-1]).write_bytes(b'portrait')
        def communicate(self, **kwargs): return None, b''
        def poll(self): return 0
    monkeypatch.setattr('backend.services.captions.subprocess.Popen', Process)
    result = burn_captions(source, [{'start': 0, 'end': 1, 'text': 'Caption'}], SimpleNamespace(cancel_requested=False, payload={}), auto_portrait=True)
    assert result.name == 'clip-portrait-captioned.mp4'
    assert result.read_bytes() == b'portrait'
    assert not source.exists()
