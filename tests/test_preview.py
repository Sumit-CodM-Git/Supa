from fastapi.testclient import TestClient
from backend.main import app


def test_preview_player_uses_local_script_and_referrer():
    response = TestClient(app).get('/api/preview/player')
    assert response.status_code == 200
    assert response.headers['referrer-policy'] == 'strict-origin-when-cross-origin'
    assert '/api/preview/player.js' in response.text
    assert 'https://www.youtube.com/iframe_api' in response.text


def test_preview_script_is_served_as_javascript():
    response = TestClient(app).get('/api/preview/player.js')
    assert response.status_code == 200
    assert 'javascript' in response.headers['content-type']
    assert 'player.seekTo' in response.text
