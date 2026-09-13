import concurrent.futures
import dataclasses
import re
import threading
import time

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.main import TokenValidatorUnavailable, client_ip_key, create_app
from tests.conftest import empty_remover, fake_remover, make_photo_bytes, make_settings

AUTH = {"Authorization": "Bearer test-token"}


def _post(client, photo=None, template="card-2", headers=AUTH, **fields):
    photo = make_photo_bytes() if photo is None else photo
    data = {"template": template, **fields}
    return client.post("/composite", data=data, files={"photo": ("p.jpg", photo, "image/jpeg")}, headers=headers)


def test_happy_path_returns_jpeg_bytes_in_image_mode(client, uploader):
    response = _post(client, name="Rajiv", constituency="Patna", state="Bihar")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/jpeg")
    assert response.content[:3] == b"\xff\xd8\xff"  # JPEG magic
    assert re.match(r"^[0-9a-f]{8}$", response.headers["x-request-id"])
    assert len(uploader.objects) == 0, "image mode must never touch the uploader"


def test_happy_path_returns_image_url_in_url_mode(url_client, uploader):
    response = _post(url_client, name="Rajiv", constituency="Patna", state="Bihar")
    assert response.status_code == 200, response.text
    url = response.json()["imageUrl"]
    assert url.startswith("https://example.test/mem/")
    assert len(uploader.objects) == 1
    assert next(iter(uploader.objects.values()))[:3] == b"\xff\xd8\xff"  # JPEG magic
    assert re.match(r"^[0-9a-f]{8}$", response.headers["x-request-id"])


def test_image_mode_needs_no_uploader_or_s3_config():
    """No uploader injected and an empty s3_bucket: if lifespan tried to build an S3Uploader in
    image mode this would raise (S3Uploader requires a bucket). It must not even try."""
    app = create_app(settings=make_settings(response_mode="image"), remover=fake_remover)
    with TestClient(app) as client:
        response = _post(client)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/jpeg")


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


def test_single_face_passes_when_face_check_on(uploader):
    app = create_app(
        settings=make_settings(face_check_enabled=True),
        remover=fake_remover,
        uploader=uploader,
        face_detector=lambda img: [(0.4, 0.1, 0.1, 0.1)],
    )
    with TestClient(app) as client:
        response = _post(client, name="Rajiv", constituency="Patna", state="Bihar")
    assert response.status_code == 200, response.text


def test_no_face_is_422_with_no_face_code(uploader):
    app = create_app(
        settings=make_settings(face_check_enabled=True),
        remover=fake_remover,
        uploader=uploader,
        face_detector=lambda img: [],
    )
    with TestClient(app) as client:
        response = _post(client)
    assert response.status_code == 422
    assert response.json()["detail"] == "no_face"


def test_multiple_faces_is_422_with_multiple_faces_code(uploader):
    app = create_app(
        settings=make_settings(face_check_enabled=True),
        remover=fake_remover,
        uploader=uploader,
        face_detector=lambda img: [(0.1, 0.1, 0.1, 0.1), (0.4, 0.1, 0.1, 0.1), (0.7, 0.1, 0.1, 0.1)],
    )
    with TestClient(app) as client:
        response = _post(client)
    assert response.status_code == 422
    assert response.json()["detail"] == "multiple_faces"


def test_overlap_warning_header_is_set(uploader, monkeypatch):
    from app.pipeline import Rendered
    monkeypatch.setattr("app.main.compose", lambda *a, **k: Rendered(jpeg=make_photo_bytes(), text_overlap=True))
    app = create_app(settings=make_settings(), remover=fake_remover, uploader=uploader)
    with TestClient(app) as client:
        response = _post(client)
    assert response.status_code == 200, response.text
    assert response.headers.get("x-poster-warning") == "text-overlap"


def test_no_overlap_warning_header_when_clear(uploader, monkeypatch):
    from app.pipeline import Rendered
    monkeypatch.setattr("app.main.compose", lambda *a, **k: Rendered(jpeg=make_photo_bytes(), text_overlap=False))
    app = create_app(settings=make_settings(), remover=fake_remover, uploader=uploader)
    with TestClient(app) as client:
        response = _post(client)
    assert response.status_code == 200
    assert "x-poster-warning" not in {k.lower() for k in response.headers}


def test_face_check_skipped_when_no_detector(uploader):
    """No detector injected and the flag off (test default): a normal photo still composites."""
    app = create_app(settings=make_settings(), remover=fake_remover, uploader=uploader)
    with TestClient(app) as client:
        response = _post(client)
    assert response.status_code == 200, response.text


def test_upload_failure_is_502():
    class FailingUploader:
        def upload_jpeg(self, data):
            from app.storage import UploadError

            raise UploadError("s3 down")

    app = create_app(settings=make_settings(response_mode="url"), remover=fake_remover, uploader=FailingUploader())
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


def test_fields_reach_compose(client, monkeypatch):
    from app.pipeline import TextFields
    from app.placements import load_placements

    seen = {}

    from app.pipeline import Rendered

    def record(data, placement, fields, remover, face_detector=None):
        seen["fields"] = fields
        seen["placement"] = placement
        return Rendered(jpeg=make_photo_bytes())

    monkeypatch.setattr("app.main.compose", record)
    assert _post(client, name="Rajiv", constituency="Patna", state="Bihar").status_code == 200
    assert seen["fields"] == TextFields(name="Rajiv", constituency="Patna", state="Bihar")
    assert seen["placement"] == load_placements()["card-2"]


def test_success_sets_request_id_header(client):
    response = _post(client)
    assert response.status_code == 200
    assert len(response.headers["x-request-id"]) == 8


def test_name_of_exactly_the_limit_is_accepted(client):
    assert _post(client, name="x" * 120).status_code == 200


def test_photo_of_exactly_the_limit_is_not_413(client, monkeypatch):
    from app.pipeline import Rendered as _R
    monkeypatch.setattr("app.main.compose", lambda *a, **k: _R(jpeg=make_photo_bytes()))
    limit = make_settings().max_upload_bytes
    response = _post(client, photo=b"x" * limit)
    assert response.status_code == 200, response.text


def test_rate_limit_buckets_per_bearer(uploader):
    # The per-IP ceiling is raised out of the way so only the per-bearer budget can fire.
    app = create_app(
        settings=make_settings(rate_limit_per_minute=1, rate_limit_per_ip_per_minute=100),
        remover=fake_remover,
        uploader=uploader,
    )
    with TestClient(app) as client:
        first = _post(client)
        second = _post(client)
        other = _post(client, headers={"Authorization": "Bearer other-token"})
    assert first.status_code == 200
    assert second.status_code == 429, "the same bearer must share one budget"
    assert other.status_code == 200, "a different bearer gets its own budget"


def test_rate_limit_falls_back_to_ip_without_bearer(uploader):
    # slowapi checks the limit before the handler runs, so the unauthenticated second
    # request is rejected by the limiter rather than by the 401 inside the route.
    app = create_app(settings=make_settings(rate_limit_per_minute=1), remover=fake_remover, uploader=uploader)
    with TestClient(app) as client:
        assert _post(client, headers={}).status_code == 401
        assert _post(client, headers={}).status_code == 429


def test_composite_limiter_serialises_work(uploader):
    lock = threading.Lock()
    live = 0
    peak = 0

    def slow_remover(img):
        nonlocal live, peak
        with lock:
            live += 1
            peak = max(peak, live)
        time.sleep(0.2)
        with lock:
            live -= 1
        return fake_remover(img)

    app = create_app(
        settings=make_settings(max_concurrent_composites=1, rate_limit_per_minute=100),
        remover=slow_remover,
        uploader=uploader,
    )
    with TestClient(app) as client:
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            results = [f.result() for f in [pool.submit(_post, client) for _ in range(3)]]
    assert [r.status_code for r in results] == [200, 200, 200]
    assert peak == 1


def test_queue_overflow_is_503(uploader):
    release = threading.Event()

    def blocking_remover(img):
        release.wait(10)
        return fake_remover(img)

    app = create_app(
        settings=make_settings(max_concurrent_composites=1, rate_limit_per_minute=100),
        remover=blocking_remover,
        uploader=uploader,
    )
    limiter = app.state.composite_limiter
    with TestClient(app) as client:
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            queued = [pool.submit(_post, client) for _ in range(5)]  # 1 running + 4 waiting
            deadline = time.monotonic() + 10
            while limiter.statistics().tasks_waiting < 4 and time.monotonic() < deadline:
                time.sleep(0.02)
            assert limiter.statistics().tasks_waiting == 4, "queue did not fill; test is inconclusive"
            overflow = _post(client)
            release.set()
            assert [f.result().status_code for f in queued] == [200] * 5
    assert overflow.status_code == 503
    assert overflow.json()["detail"] == "Busy, retry shortly"


def test_validator_outage_is_503(uploader):
    async def unavailable(token: str) -> bool:
        raise TokenValidatorUnavailable("connect timeout")

    app = create_app(
        settings=make_settings(jwt_validate_url="https://api.example/validate"),
        remover=fake_remover,
        uploader=uploader,
        token_validator=unavailable,
    )
    with TestClient(app) as client:
        response = _post(client)
    assert response.status_code == 503
    assert response.json()["detail"] == "Token check unavailable, retry shortly"


@pytest.mark.parametrize("bad_url", ["not a url", "http://[::1", "ftp://x.example/v"])
def test_invalid_validate_url_fails_at_startup(bad_url):
    """Including the ones httpx rejects itself: InvalidURL must not escape create_app."""
    with pytest.raises(ValueError, match="JWT_VALIDATE_URL"):
        create_app(settings=make_settings(jwt_validate_url=bad_url))


def test_empty_allowed_origins_fails_at_startup():
    # make_settings() itself sets a test origin, so the override happens after via dataclasses.replace
    # rather than by passing allowed_origins=[] straight through to make_settings (which already
    # supplies that keyword and would collide with it).
    settings = dataclasses.replace(make_settings(), allowed_origins=[])
    with pytest.raises(ValueError, match="ALLOWED_ORIGINS"):
        create_app(settings=settings)


def test_unexpected_error_is_500_with_request_id(uploader):
    def exploding_remover(img):
        raise RuntimeError("model segfaulted")

    app = create_app(settings=make_settings(), remover=exploding_remover, uploader=uploader)
    with TestClient(app) as client:
        response = _post(client)
    assert response.status_code == 500
    request_id = response.headers["x-request-id"]
    assert len(request_id) == 8 and int(request_id, 16) >= 0
    assert f"req {request_id}" in response.json()["detail"]


def test_per_ip_ceiling_applies_across_rotated_bearers(uploader):
    """A forged bearer per request would otherwise buy a fresh bucket every time;
    the per-IP limit stacked under the per-bearer one is what stops that."""
    app = create_app(
        settings=make_settings(rate_limit_per_minute=100, rate_limit_per_ip_per_minute=2),
        remover=fake_remover,
        uploader=uploader,
    )
    with TestClient(app) as client:
        codes = [
            _post(client, headers={"Authorization": f"Bearer forged-{i}"}).status_code for i in range(3)
        ]
    assert codes == [200, 200, 429], "the third request from this IP must be shed regardless of token"


def test_per_ip_ceiling_uses_rightmost_forwarded_for(uploader):
    """The leftmost X-Forwarded-For hop is client-controlled; only the rightmost one (appended by
    the trusted platform proxy) is safe to bucket on. A spoofed leftmost must not buy a fresh
    per-IP budget, but a genuinely different rightmost hop must."""
    app = create_app(
        settings=make_settings(rate_limit_per_minute=100, rate_limit_per_ip_per_minute=2),
        remover=fake_remover,
        uploader=uploader,
    )
    with TestClient(app) as client:
        codes = [
            _post(
                client,
                headers={
                    "Authorization": f"Bearer forged-{i}",
                    "X-Forwarded-For": f"10.0.0.{i}, 203.0.113.9",
                },
            ).status_code
            for i in range(3)
        ]
        assert codes == [200, 200, 429], "same rightmost hop must share one budget regardless of the spoofed leftmost"

        other = _post(
            client,
            headers={
                "Authorization": "Bearer forged-other",
                "X-Forwarded-For": "1.1.1.1, 203.0.113.10",
            },
        )
    assert other.status_code == 200, "a different rightmost hop gets its own budget"


def test_request_id_header_on_validation_errors(client):
    request_id_pattern = re.compile(r"^[0-9a-f]{8}$")

    unknown_template = _post(client, template="card-7")
    assert unknown_template.status_code == 400
    assert request_id_pattern.match(unknown_template.headers["x-request-id"])

    wrong_content_type = client.post(
        "/composite",
        data={"template": "card-2"},
        files={"photo": ("p.txt", b"hello", "text/plain")},
        headers=AUTH,
    )
    assert wrong_content_type.status_code == 415
    assert request_id_pattern.match(wrong_content_type.headers["x-request-id"])

    field_too_long = _post(client, name="x" * 121)
    assert field_too_long.status_code == 422
    assert request_id_pattern.match(field_too_long.headers["x-request-id"])


def test_cors_exposes_request_id(client):
    response = _post(client, headers={**AUTH, "Origin": "https://app.example"})
    assert response.status_code == 200
    assert "x-request-id" in response.headers.get("access-control-expose-headers", "").lower()


def test_route_raised_400_gets_distinct_request_ids(client):
    """The unknown-template 400 is raised inside the route with a request id already attached via
    exc.headers; the StarletteHTTPException handler in main.py must preserve it (setdefault) rather
    than overwrite it with a fresh one. We can't read the route's minted id directly here, so this
    checks the next best thing: the header is present, and two separate requests get two different
    ids (i.e. nothing is falling back to some fixed/missing value)."""
    request_id_pattern = re.compile(r"^[0-9a-f]{8}$")

    first = _post(client, template="card-7")
    second = _post(client, template="card-7")

    assert first.status_code == second.status_code == 400
    assert request_id_pattern.match(first.headers["x-request-id"])
    assert request_id_pattern.match(second.headers["x-request-id"])
    assert first.headers["x-request-id"] != second.headers["x-request-id"]


def test_multipart_parse_error_carries_request_id(client):
    """A multipart body with no boundary never reaches the route at all -- Starlette's own form
    parser raises a plain HTTPException(400) while parsing the body. The StarletteHTTPException
    handler in main.py must still mint a request id for it."""
    response = client.post(
        "/composite", content=b"xx", headers={"Content-Type": "multipart/form-data", **AUTH}
    )
    assert response.status_code == 400
    assert re.match(r"^[0-9a-f]{8}$", response.headers["x-request-id"])


def test_rate_limit_429_has_no_request_id(uploader):
    """slowapi raises RateLimitExceeded, not HTTPException, so the StarletteHTTPException handler
    never sees it and the 429 must remain exactly as before -- no X-Request-Id header."""
    app = create_app(settings=make_settings(rate_limit_per_minute=1), remover=fake_remover, uploader=uploader)
    with TestClient(app) as client:
        assert _post(client).status_code == 200
        response = _post(client)
    assert response.status_code == 429
    assert "x-request-id" not in response.headers


def test_missing_required_field_422_carries_request_id(client):
    """FastAPI raises this 422 itself, before the route body runs -- the handler in main.py is what
    puts a request id on it."""
    response = client.post(
        "/composite",
        files={"photo": ("p.jpg", make_photo_bytes(), "image/jpeg")},  # no `template` field
        headers=AUTH,
    )
    assert response.status_code == 422, response.text
    assert re.match(r"^[0-9a-f]{8}$", response.headers["x-request-id"])


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        # RFC 7230: repeated header lines are equivalent to one comma-joined line, so a client
        # injecting its own X-Forwarded-For line cannot shadow the entry the proxy appends.
        ([(b"x-forwarded-for", b"evil"), (b"x-forwarded-for", b"203.0.113.9")], "ip:203.0.113.9"),
        ([(b"x-forwarded-for", b"1.1.1.1, 203.0.113.9:41234")], "ip:203.0.113.9"),  # port stripped
        ([(b"x-forwarded-for", b"[2001:db8::99]:41234")], "ip:2001:db8::99"),  # bracketed IPv6 + port
        ([(b"x-forwarded-for", b"2001:db8::99")], "ip:2001:db8::99"),  # bare IPv6 left alone
        ([(b"x-forwarded-for", b"1.1.1.1, 203.0.113.9,")], "ip:203.0.113.9"),  # trailing comma
        ([(b"x-forwarded-for", b"   ")], "ip:9.9.9.9"),  # blank header -> socket peer
        ([], "ip:9.9.9.9"),  # no header at all -> socket peer
        ([(b"x-forwarded-for", b":8080")], "ip:9.9.9.9"),  # rightmost strips to empty -> socket peer
    ],
)
def test_client_ip_key_parses_forwarded_header(headers, expected):
    request = Request(
        {
            "type": "http",
            "headers": headers,
            "client": ("9.9.9.9", 1234),
            "method": "GET",
            "path": "/",
            "query_string": b"",
            "scheme": "http",
            "server": ("s", 80),
        }
    )
    assert client_ip_key(request) == expected


def test_local_storage_backend_serves_uploaded_card(tmp_path):
    """End to end with STORAGE_BACKEND=local and no uploader injected: create_app must build a
    LocalUploader itself in lifespan, mount /uploads, and the served bytes/content-type must match
    what compose() produced."""
    settings = make_settings(
        response_mode="url",
        storage_backend="local",
        local_storage_dir=str(tmp_path),
        public_base_url="http://localhost:8000",
    )
    app = create_app(settings=settings, remover=fake_remover)
    with TestClient(app) as client:
        response = _post(client, name="Rajiv", constituency="Patna", state="Bihar")
        assert response.status_code == 200, response.text
        url = response.json()["imageUrl"]
        assert url.startswith("http://localhost:8000/uploads/")

        name = url.rsplit("/", 1)[-1]
        assert (tmp_path / name).exists()

        served = client.get(f"/uploads/{name}")
        assert served.status_code == 200
        assert served.headers["content-type"] == "image/jpeg"
        assert served.content == (tmp_path / name).read_bytes()

        missing = client.get("/uploads/missing.jpg")
        assert missing.status_code == 404

        health = client.get("/health")
        assert health.json()["storage"] == "local"
        assert health.json()["uploader_ready"] is True
