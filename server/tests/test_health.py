from fastapi.testclient import TestClient

from app.main import create_app
from app.storage import MemoryUploader
from tests.conftest import make_settings


def test_health_reports_model_loaded_when_remover_injected():
    app = create_app(settings=make_settings(), remover=lambda img: img, uploader=MemoryUploader())
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "model_loaded": True,
        "uploader_ready": True,
        "storage": "s3",
    }


def test_lifespan_builds_remover_from_settings_when_none_injected(monkeypatch):
    built: list[str] = []

    def fake_make_remover(model_name: str):
        built.append(model_name)
        return lambda img: img

    monkeypatch.setattr("app.main.make_remover", fake_make_remover)
    app = create_app(settings=make_settings(model_name="u2net"), uploader=MemoryUploader())
    with TestClient(app) as client:
        assert client.get("/health").json()["model_loaded"] is True
    assert built == ["u2net"]


def test_cors_allows_configured_origin_and_rejects_others():
    app = create_app(settings=make_settings(), remover=lambda img: img, uploader=MemoryUploader())
    with TestClient(app) as client:
        allowed = client.get("/health", headers={"Origin": "https://app.example"})
        denied = client.get("/health", headers={"Origin": "https://evil.example"})
    assert allowed.headers["access-control-allow-origin"] == "https://app.example"
    assert "access-control-allow-origin" not in denied.headers


def test_lifespan_builds_s3_uploader_from_settings_when_none_injected(monkeypatch):
    monkeypatch.setattr("app.main.make_remover", lambda model_name: (lambda img: img))

    recorded = {}

    class FakeS3Uploader:
        def __init__(self, bucket, region, prefix, public_read_acl, public_base_url):
            recorded["bucket"] = bucket
            recorded["region"] = region
            recorded["prefix"] = prefix
            recorded["public_read_acl"] = public_read_acl
            recorded["public_base_url"] = public_base_url

        def upload_jpeg(self, data: bytes) -> str:
            return "https://cards.s3.ap-south-1.amazonaws.com/fake.jpg"

    monkeypatch.setattr("app.main.S3Uploader", FakeS3Uploader)
    app = create_app(settings=make_settings(s3_bucket="cards", aws_region="ap-south-1"))
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.json() == {
        "status": "ok",
        "model_loaded": True,
        "uploader_ready": True,
        "storage": "s3",
    }
    assert recorded == {
        "bucket": "cards",
        "region": "ap-south-1",
        "prefix": "ai-shubh",
        "public_read_acl": False,
        "public_base_url": "",
    }


def test_lifespan_builds_local_uploader_when_backend_is_local(tmp_path, monkeypatch):
    monkeypatch.setattr("app.main.make_remover", lambda model_name: (lambda img: img))
    app = create_app(
        settings=make_settings(
            storage_backend="local",
            local_storage_dir=str(tmp_path / "uploads"),
            public_base_url="http://localhost:8000",
        )
    )
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.json() == {
        "status": "ok",
        "model_loaded": True,
        "uploader_ready": True,
        "storage": "local",
    }
