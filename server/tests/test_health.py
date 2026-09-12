from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def _settings() -> Settings:
    return Settings(
        aws_region="ap-south-1",
        s3_bucket="b",
        s3_prefix="p",
        s3_public_read_acl=False,
        allowed_origins=["https://app.example"],
        rate_limit_per_minute=10,
        jwt_validate_url="",
        max_upload_bytes=10 * 1024 * 1024,
        model_name="isnet-general-use",
    )


def test_health_reports_model_loaded_when_remover_injected():
    app = create_app(settings=_settings(), remover=lambda img: img, uploader=object())
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "model_loaded": True}
