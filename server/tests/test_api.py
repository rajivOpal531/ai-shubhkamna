from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import empty_remover, fake_remover, make_photo_bytes, make_settings

AUTH = {"Authorization": "Bearer test-token"}


def _post(client, photo=None, template="card-2", headers=AUTH, **fields):
    photo = make_photo_bytes() if photo is None else photo
    data = {"template": template, **fields}
    return client.post("/composite", data=data, files={"photo": ("p.jpg", photo, "image/jpeg")}, headers=headers)


def test_happy_path_returns_image_url_and_uploads_jpeg(client, uploader):
    response = _post(client, name="Rajiv", constituency="Patna", state="Bihar")
    assert response.status_code == 200, response.text
    url = response.json()["imageUrl"]
    assert url.startswith("https://example.test/mem/")
    assert len(uploader.objects) == 1
    assert next(iter(uploader.objects.values()))[:3] == b"\xff\xd8\xff"  # JPEG magic


def test_profile_fields_are_optional(client):
    assert _post(client).status_code == 200


def test_missing_bearer_is_401(client):
    assert _post(client, headers={}).status_code == 401
    assert _post(client, headers={"Authorization": "Bearer "}).status_code == 401
    assert _post(client, headers={"Authorization": "Basic abc"}).status_code == 401


def test_unknown_template_is_400(client):
    response = _post(client, template="card-7")
    assert response.status_code == 400
    assert "card-7" in response.json()["detail"]


def test_wrong_content_type_is_415(client):
    response = client.post(
        "/composite",
        data={"template": "card-2"},
        files={"photo": ("p.txt", b"hello", "text/plain")},
        headers=AUTH,
    )
    assert response.status_code == 415


def test_undecodable_image_is_415(client):
    response = _post(client, photo=b"not really a jpeg")
    assert response.status_code == 415


def test_oversized_upload_is_413(uploader):
    app = create_app(settings=make_settings(max_upload_bytes=1000), remover=fake_remover, uploader=uploader)
    with TestClient(app) as client:
        response = _post(client, photo=make_photo_bytes(800, 800))
    assert response.status_code == 413


def test_field_too_long_is_422(client):
    response = _post(client, name="x" * 121)
    assert response.status_code == 422
    assert "too long" in response.json()["detail"].lower()


def test_no_subject_is_422(uploader):
    app = create_app(settings=make_settings(), remover=empty_remover, uploader=uploader)
    with TestClient(app) as client:
        response = _post(client)
    assert response.status_code == 422


def test_upload_failure_is_502():
    class FailingUploader:
        def upload_jpeg(self, data):
            from app.storage import UploadError

            raise UploadError("s3 down")

    app = create_app(settings=make_settings(), remover=fake_remover, uploader=FailingUploader())
    with TestClient(app) as client:
        response = _post(client)
    assert response.status_code == 502


def test_rate_limit_is_429_after_limit(uploader):
    app = create_app(settings=make_settings(rate_limit_per_minute=2), remover=fake_remover, uploader=uploader)
    with TestClient(app) as client:
        assert _post(client).status_code == 200
        assert _post(client).status_code == 200
        assert _post(client).status_code == 429


def test_composite_limiter_uses_configured_concurrency(uploader):
    app = create_app(settings=make_settings(max_concurrent_composites=3), remover=fake_remover, uploader=uploader)
    assert app.state.composite_limiter.total_tokens == 3


def test_jwt_validation_hook_rejects_on_false(uploader):
    async def always_reject(token: str) -> bool:
        return False

    app = create_app(
        settings=make_settings(jwt_validate_url="https://api.example/validate"),
        remover=fake_remover,
        uploader=uploader,
        token_validator=always_reject,
    )
    with TestClient(app) as client:
        assert _post(client).status_code == 401


def test_jwt_validation_hook_allows_on_true(uploader):
    seen = []

    async def accept(token: str) -> bool:
        seen.append(token)
        return True

    app = create_app(
        settings=make_settings(jwt_validate_url="https://api.example/validate"),
        remover=fake_remover,
        uploader=uploader,
        token_validator=accept,
    )
    with TestClient(app) as client:
        assert _post(client).status_code == 200
    assert seen == ["test-token"]


def test_cors_preflight_allows_configured_origin_only(client):
    ok = client.options(
        "/composite",
        headers={"Origin": "https://app.example", "Access-Control-Request-Method": "POST"},
    )
    assert ok.headers.get("access-control-allow-origin") == "https://app.example"
    bad = client.options(
        "/composite",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in bad.headers


def test_health_reports_uploader_ready(client):
    assert client.get("/health").json() == {"status": "ok", "model_loaded": True, "uploader_ready": True}
