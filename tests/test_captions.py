import io
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from yt_dlp.utils import DownloadCancelled

from backend.config import AppConfig
from backend.main import app
from backend.services.captions import TranscriptStore, TranscriptRateLimited, select_language, burn_captions, clip_cues, load_transcript, parse_json3, srt_text
from test_clips import clip_api, request


@pytest.fixture(autouse=True)
def fresh_transcripts(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.captions.transcript_store", TranscriptStore(tmp_path / "transcripts"))


def test_json3_rolling_timings_and_plain_text():
    cues = parse_json3({"events": [
        {"tStartMs": 1000, "dDurationMs": 8000, "segs": [{"utf8": "Hello &amp; "}, {"utf8": "world"}]},
        {"tStartMs": 3000, "dDurationMs": 2000, "segs": [{"utf8": "Next"}]},
        {"tStartMs": 5000, "segs": [{"utf8": "\n"}]},
    ]})
    assert cues == [{"start": 1, "end": 3, "text": "Hello & world"}, {"start": 3, "end": 5, "text": "Next"}]
    assert clip_cues(cues, {"start": 2, "end": 4}) == [
        {"start": 0, "end": 1, "text": "Hello & world"}, {"start": 1, "end": 2, "text": "Next"}]
    rendered = srt_text([{"start": 0.125, "end": 61.5, "text": "<b>Edited</b>\n\n{\\an8}words"}])
    assert "00:00:00,125 --> 00:01:01,500" in rendered
    assert "Edited\nwords" in rendered
    assert "<b>" not in rendered and "an8" not in rendered


def test_transcript_prefers_manual_and_selects_language(monkeypatch):
    class YDL:
        def __init__(self, opts):
            assert opts["skip_download"] and opts["noplaylist"]
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def extract_info(self, *args, **kwargs):
            return {"duration": 2, "subtitles": {"en": [{"ext": "json3", "url": "manual"}]},
                    "automatic_captions": {"en": [{"ext": "json3", "url": "auto"}], "hi": [{"ext": "json3", "url": "hindi"}]}}
        def urlopen(self, url):
            return io.BytesIO(json.dumps({"events": [{"tStartMs": 0, "dDurationMs": 3000, "segs": [{"utf8": url}]}]}).encode())
    monkeypatch.setattr("backend.services.captions.YoutubeDL", YDL)
    result = load_transcript("https://youtu.be/example", AppConfig())
    assert result["cues"] == [{"start": 0, "end": 2, "text": "manual"}]
    assert not result["automatic"]
    assert load_transcript("https://youtu.be/example", AppConfig(), "hi")["automatic"]
    with pytest.raises(ValueError, match="unavailable"):
        load_transcript("https://youtu.be/example", AppConfig(), "missing")
    with pytest.raises(ValueError, match="valid YouTube"):
        load_transcript("https://other.example/video", AppConfig())


def test_transcript_endpoint_maps_unavailable(monkeypatch):
    def unavailable(*args): raise ValueError("No transcript available")
    monkeypatch.setattr("backend.main.load_transcript", unavailable)
    response = TestClient(app).post("/api/transcript", json={"url": "https://youtu.be/example"})
    assert response.status_code == 400
    assert response.json()["detail"]["error"]["code"] == "TRANSCRIPT_UNAVAILABLE"


def test_caption_batch_preserves_edits_and_rebases_each_clip(clip_api):
    client, queued = clip_api
    response = client.post("/api/clips", json=request(
        [{"start": 10, "end": 20}, {"start": 18, "end": 30}], show_captions=True,
        captions=[{"start": 8, "end": 22, "text": "My edited transcript"}]))
    assert response.status_code == 201
    assert queued[0]["captions"] == [{"start": 0, "end": 10, "text": "My edited transcript"}]
    assert queued[1]["captions"] == [{"start": 0, "end": 4, "text": "My edited transcript"}]


@pytest.mark.parametrize("changes, status", [
    ({"captions": []}, 400),
    ({"captions": [{"start": 0, "end": 101, "text": "invalid"}]}, 400),
    ({"captions": [{"start": 4, "end": 3, "text": "invalid"}]}, 422),
    ({"captions": [{"start": 0, "end": 5, "text": ""}]}, 400),
    ({"captions": [{"start": 30, "end": 35, "text": "outside"}]}, 400),
    ({"kind": "audio", "captions": []}, 400),
])
def test_invalid_captions_queue_nothing(clip_api, changes, status):
    client, queued = clip_api
    response = client.post("/api/clips", json=request([{"start": 0, "end": 10}], show_captions=True, **changes))
    assert response.status_code == status
    assert queued == []


def test_renderer_uses_safe_fixed_filter_and_cleans_work_files(tmp_path, monkeypatch):
    source = tmp_path / "video's [name].webm"
    source.write_bytes(b"original")
    commands = []
    class Process:
        returncode = 0
        def __init__(self, command, **kwargs):
            commands.append(command)
            assert (kwargs["cwd"] / "captions.srt").read_text().endswith("Edited\n")
            from pathlib import Path
            Path(command[-1]).write_bytes(b"captioned")
        def communicate(self, **kwargs): return None, b""
        def poll(self): return 0
    monkeypatch.setattr("backend.services.captions.subprocess.Popen", Process)
    result = burn_captions(source, [{"start": 0, "end": 1, "text": "Edited"}], SimpleNamespace(cancel_requested=False))
    assert result.suffix == ".mp4" and result.read_bytes() == b"captioned"
    assert not source.exists()
    assert "subtitles=captions.srt" in commands[0][commands[0].index("-vf") + 1]
    assert not list(tmp_path.glob("captions-*"))


def test_renderer_cancellation_keeps_source_and_terminates_process(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"original")
    killed = []
    class Process:
        def __init__(self, *args, **kwargs): pass
        def poll(self): return None
        def kill(self): killed.append(True)
        def communicate(self): return None, b""
    monkeypatch.setattr("backend.services.captions.subprocess.Popen", Process)
    with pytest.raises(DownloadCancelled):
        burn_captions(source, [], SimpleNamespace(cancel_requested=True))
    assert killed and source.exists()
    assert not list(tmp_path.glob("captions-*"))


def test_original_track_preferred_over_translation():
    assert select_language({}, ['en', 'hi', 'hi-orig'], ['en'], None) == 'hi-orig'
    assert select_language({}, ['en', 'hi', 'hi-orig'], ['en'], 'hi') == 'hi-orig'
    assert select_language({}, ['en', 'hi-orig'], ['en'], 'en') == 'en'
    assert select_language({'en': []}, ['en', 'hi-orig'], ['en'], None) == 'en'


def test_cache_survives_restart_normalizes_url_and_separates_languages(tmp_path, monkeypatch):
    calls = []
    def fetch(url, cfg, lang):
        calls.append((url, lang))
        return {'language': lang or 'hi-orig', 'cues': [{'start': 0, 'end': 1, 'text': 'Original'}]}
    monkeypatch.setattr('backend.services.captions._fetch_transcript', fetch)
    store = TranscriptStore(tmp_path / 'cache', clock=lambda: 1000)
    first = store.get('https://youtu.be/c27jDP-ddQA?si=tracking', AppConfig())
    first['cues'][0]['text'] = 'Edited'
    second = TranscriptStore(tmp_path / 'cache', clock=lambda: 1001).get('https://www.youtube.com/watch?v=c27jDP-ddQA', AppConfig())
    assert second['cues'][0]['text'] == 'Original'
    assert len(calls) == 1
    store.get('https://youtu.be/c27jDP-ddQA', AppConfig(), 'en')
    assert len(calls) == 2


def test_rate_limit_respects_retry_after_and_suppresses_repeated_calls(tmp_path, monkeypatch):
    now = [1000]
    calls = []
    class Limited(Exception):
        status = 429
        headers = {'Retry-After': '120'}
    def fetch(*args):
        calls.append(True)
        if len(calls) == 1:
            raise Limited('HTTP Error 429: Too Many Requests')
        return {'language': 'hi-orig', 'cues': []}
    monkeypatch.setattr('backend.services.captions._fetch_transcript', fetch)
    store = TranscriptStore(tmp_path / 'cache', clock=lambda: now[0])
    with pytest.raises(TranscriptRateLimited) as raised:
        store.get('https://youtu.be/c27jDP-ddQA', AppConfig())
    assert raised.value.retry_after == 120
    now[0] += 10
    with pytest.raises(TranscriptRateLimited) as raised:
        store.get('https://youtu.be/anotherVideo', AppConfig())
    assert raised.value.retry_after == 110 and len(calls) == 1
    now[0] += 111
    assert store.get('https://youtu.be/c27jDP-ddQA', AppConfig())['language'] == 'hi-orig'
    assert len(calls) == 2


def test_cache_available_during_rate_limit_and_expiry(tmp_path, monkeypatch):
    now = [1000]
    calls = []
    def fetch(*args):
        calls.append(True)
        return {'language': 'en', 'cues': []}
    monkeypatch.setattr('backend.services.captions._fetch_transcript', fetch)
    store = TranscriptStore(tmp_path / 'cache', clock=lambda: now[0])
    url = 'https://youtu.be/example'
    store.get(url, AppConfig())
    store.blocked_until = 2000
    store.get(url, AppConfig())
    assert len(calls) == 1
    now[0] += 86401
    store.get(url, AppConfig())
    assert len(calls) == 2


def test_transcript_endpoint_returns_429_and_retry_header(monkeypatch):
    def limited(*args): raise TranscriptRateLimited(90)
    monkeypatch.setattr('backend.main.load_transcript', limited)
    response = TestClient(app).post('/api/transcript', json={'url': 'https://youtu.be/example'})
    assert response.status_code == 429
    assert response.headers['Retry-After'] == '90'
    assert response.json()['detail']['error']['code'] == 'TRANSCRIPT_RATE_LIMITED'
