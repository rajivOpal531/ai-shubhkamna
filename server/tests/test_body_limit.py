import json

import anyio
from fastapi.testclient import TestClient

from app.body_limit import BodyLimitMiddleware
from app.main import create_app
from app.storage import MemoryUploader
from tests.conftest import fake_remover, make_photo_bytes, make_settings


def _client() -> TestClient:
    app = create_app(
        settings=make_settings(max_upload_bytes=1000),
        remover=fake_remover,
        uploader=MemoryUploader(),
    )
    return TestClient(app)


def test_oversized_body_is_413_before_authentication():
    """200 KB with no Authorization header: the 413 proves the cap runs above the route."""
    with _client() as client:
        response = client.post(
            "/composite",
            data={"template": "card-2"},
            files={"photo": ("p.jpg", b"x" * (200 * 1024), "image/jpeg")},
        )
    assert response.status_code == 413
    assert "Body larger than" in response.json()["detail"]


def test_body_under_limit_still_reaches_the_auth_check():
    with _client() as client:
        response = client.post(
            "/composite",
            data={"template": "card-2"},
            files={"photo": ("p.jpg", make_photo_bytes(60, 60), "image/jpeg")},
        )
    assert response.status_code == 401


def test_streamed_body_without_content_length_is_413_once_over_the_limit():
    """Chunked upload: no content-length to pre-check, so the running total must catch it."""
    chunks = [b"a" * 60, b"a" * 60, b"a" * 60]
    reached_app = []
    sent: list[dict] = []

    async def tiny_app(scope, receive, send):
        reached_app.append(scope["path"])
        while True:
            message = await receive()
            if message["type"] != "http.request" or not message.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    async def receive():
        if chunks:
            return {"type": "http.request", "body": chunks.pop(0), "more_body": bool(chunks)}
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "POST", "path": "/composite", "headers": []}
    anyio.run(BodyLimitMiddleware(tiny_app, max_bytes=100), scope, receive, send)

    assert reached_app == ["/composite"], "the app runs; it just never gets the whole body"
    assert sent[0]["type"] == "http.response.start"
    assert sent[0]["status"] == 413
    assert b"Body larger than" in sent[1]["body"]
    assert len(sent) == 2, "the app's own 200 must not be forwarded after our 413"


def test_streamed_body_under_limit_passes_through():
    sent: list[dict] = []

    async def tiny_app(scope, receive, send):
        while True:
            message = await receive()
            if message["type"] != "http.request" or not message.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    async def receive():
        return {"type": "http.request", "body": b"a" * 50, "more_body": False}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "POST", "path": "/composite", "headers": []}
    anyio.run(BodyLimitMiddleware(tiny_app, max_bytes=100), scope, receive, send)
    assert sent[0]["status"] == 200


def test_non_http_scopes_are_passed_straight_through():
    seen = []

    async def tiny_app(scope, receive, send):
        seen.append(scope["type"])

    async def noop(*_args):
        return {}

    anyio.run(BodyLimitMiddleware(tiny_app, max_bytes=1), {"type": "lifespan"}, noop, noop)
    assert seen == ["lifespan"]


def test_streamed_overflow_through_the_real_app_answers_413_once():
    """The other streamed test drives the middleware over a toy app. This one drives the whole
    stack FastAPI actually builds -- CORS, the middleware, the exception handlers and the route --
    with a chunked multipart body and no content-length, and checks the caller sees exactly one
    response. The lifespan is never run: the middleware answers above routing, so nothing in the
    route (remover, uploader) is reached."""
    app = create_app(
        settings=make_settings(max_upload_bytes=1000),
        remover=fake_remover,
        uploader=MemoryUploader(),
    )
    stack = app.build_middleware_stack()

    boundary = b"----test-boundary"
    head = (
        b"--" + boundary + b"\r\n"
        b'Content-Disposition: form-data; name="photo"; filename="p.jpg"\r\n'
        b"Content-Type: image/jpeg\r\n\r\n"
    )
    tail = b"\r\n--" + boundary + b"--\r\n"
    payload = head + b"x" * (200 * 1024) + tail
    chunks = [payload[i : i + 16 * 1024] for i in range(0, len(payload), 16 * 1024)]
    sent: list[dict] = []

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/composite",
        "raw_path": b"/composite",
        "root_path": "",
        "query_string": b"",
        "client": ("10.0.0.9", 51234),
        "server": ("testserver", 80),
        # Deliberately no content-length: only the running byte count can catch this body.
        "headers": [
            (b"host", b"testserver"),
            (b"transfer-encoding", b"chunked"),
            (b"content-type", b"multipart/form-data; boundary=" + boundary),
        ],
        "app": app,
    }

    async def receive():
        if chunks:
            return {"type": "http.request", "body": chunks.pop(0), "more_body": bool(chunks)}
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    async def main():
        await stack(scope, receive, send)

    anyio.run(main)

    starts = [m for m in sent if m["type"] == "http.response.start"]
    assert len(starts) == 1, f"caller must see exactly one response, got {[m['type'] for m in sent]}"
    assert starts[0]["status"] == 413
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    assert json.loads(body)["detail"] == "Body larger than 66536 bytes"
