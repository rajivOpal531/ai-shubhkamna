from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import make_settings


def test_health_reports_model_loaded_when_remover_injected():
    app = create_app(settings=make_settings(), remover=lambda img: img)
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "model_loaded": True}


def test_lifespan_builds_remover_from_settings_when_none_injected(monkeypatch):
    built: list[str] = []

    def fake_make_remover(model_name: str):
        built.append(model_name)
        return lambda img: img

    monkeypatch.setattr("app.main.make_remover", fake_make_remover)
    app = create_app(settings=make_settings(model_name="u2net"))
    with TestClient(app) as client:
        assert client.get("/health").json()["model_loaded"] is True
    assert built == ["u2net"]


def test_cors_allows_configured_origin_and_rejects_others():
    app = create_app(settings=make_settings(), remover=lambda img: img)
    with TestClient(app) as client:
        allowed = client.get("/health", headers={"Origin": "https://app.example"})
        denied = client.get("/health", headers={"Origin": "https://evil.example"})
    assert allowed.headers["access-control-allow-origin"] == "https://app.example"
    assert "access-control-allow-origin" not in denied.headers
