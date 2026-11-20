from dataclasses import asdict
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.config import AppConfig
from backend.main import app
from backend.models import CaptionStyle, SettingsConfig
from backend.services.captions import TranscriptStore, caption_force_style
from test_clips import clip_api, request


def test_style_maps_colors_positions_and_fonts_without_filter_injection():
    style = caption_force_style({'font': 'Georgia', 'color': '#123456', 'outline_color': '#ABCDEF', 'position': 'top', 'align': 'right', 'bold': False, 'italic': True, 'margin': 30})
    assert 'FontName=Georgia' in style and 'PrimaryColour=&H00563412' in style
    assert 'OutlineColour=&H00EFCDAB' in style and 'Alignment=7' in style
    assert 'Bold=0' in style and 'Italic=-1' in style and 'MarginV=30' in style
    assert 'BorderStyle=3' in caption_force_style({'background': True})


@pytest.mark.parametrize('style', [{'font': "Arial',movie=/etc/passwd"}, {'color': 'red,Outline=0'}, {'position': 'outside'}, {'size': 0}, {'margin': 200}])
def test_invalid_appearance_rejected(style):
    with pytest.raises(ValidationError):
        CaptionStyle(**style)


def test_new_settings_persist_and_old_settings_have_defaults(tmp_path, monkeypatch):
    import backend.config as config
    monkeypatch.setattr(config, 'CONFIG_PATH', tmp_path / 'config.json')
    monkeypatch.setattr(config, 'ensure_dirs', lambda: None)
    cfg = AppConfig(default_caption_language='fr', captions_enabled=True, auto_portrait=True, caption_style={'font': 'Georgia', 'color': '#FFCC00', 'position': 'top'})
    config.save_config(cfg)
    loaded = config.load_config()
    assert loaded.default_caption_language == 'fr' and loaded.captions_enabled and loaded.auto_portrait
    assert loaded.caption_style == cfg.caption_style
    (tmp_path / 'config.json').write_text('{"download_dir": "./downloads"}')
    old = config.load_config()
    assert old.default_caption_language == 'original'
    assert CaptionStyle(**old.caption_style).font == 'Arial'


def test_chosen_language_is_requested_instead_of_original(tmp_path, monkeypatch):
    calls = []
    def fetch(url, cfg, language):
        calls.append(language)
        return {'language': language, 'cues': []}
    monkeypatch.setattr('backend.services.captions._fetch_transcript', fetch)
    store = TranscriptStore(tmp_path / 'cache')
    cfg = AppConfig(default_caption_language='fr')
    assert store.get('https://youtu.be/example', cfg)['language'] == 'fr'
    store.get('https://youtu.be/example', cfg)
    assert calls == ['fr']
    assert store.get('https://youtu.be/example', cfg, 'hi-orig')['language'] == 'hi-orig'


def test_caption_style_is_snapshotted_into_queued_clip(clip_api, monkeypatch):
    client, queued = clip_api
    cfg = AppConfig(caption_style={'font': 'Georgia', 'position': 'top', 'color': '#FFCC00'})
    monkeypatch.setitem(app.state._state, 'config', cfg)
    response = client.post('/api/clips', json=request([{'start': 0, 'end': 5}], show_captions=True, captions=[{'start': 0, 'end': 5, 'text': 'Edited'}]))
    assert response.status_code == 201
    assert queued[0]['caption_style']['font'] == 'Georgia'
    cfg.caption_style['font'] = 'Arial'
    assert queued[0]['caption_style']['font'] == 'Georgia'


def test_settings_endpoint_validates_and_returns_appearance(tmp_path, monkeypatch):
    monkeypatch.setattr('backend.main.save_config', lambda cfg: cfg)
    monkeypatch.setattr(app.state.manager, 'update_config', lambda cfg: None)
    monkeypatch.setitem(app.state._state, 'config', AppConfig())
    data = SettingsConfig(download_dir=str(tmp_path), default_caption_language='hi', caption_style=CaptionStyle(color='#FFCC00', position='top')).model_dump()
    client = TestClient(app)
    response = client.put('/api/settings', json=data)
    assert response.status_code == 200
    assert client.get('/api/settings').json()['caption_style']['color'] == '#FFCC00'
    assert client.get('/api/settings').json()['default_caption_language'] == 'hi'
    data['caption_style']['font'] = 'Unsafe,Outline=0'
    assert client.put('/api/settings', json=data).status_code == 422
