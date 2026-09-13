"""FastAPI wiring. Business logic lives in pipeline.py / storage.py."""
from __future__ import annotations

import functools
import hashlib
import logging
import uuid
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

import anyio
import httpx
import jwt
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.encoders import jsonable_encoder
from fastapi.exception_handlers import http_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.exceptions import HTTPException as StarletteHTTPException

from .body_limit import BodyLimitMiddleware
from .config import Settings, load_settings
from .faces import FaceDetector, make_face_detector
from .pipeline import (
    BadImageError,
    MultipleFacesError,
    NoFaceError,
    NoSubjectError,
    TextFields,
    compose,
)
from .placements import Placement, load_placements
from .profile import ProfileError, decrypt_profile, profile_from_claims
from .remover import Remover, make_remover
from .storage import LocalUploader, S3Uploader, UploadError, Uploader

log = logging.getLogger("ai-shubh")

TokenValidator = Callable[[str], Awaitable[bool]]

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
MULTIPART_OVERHEAD = 64 * 1024  # form fields, boundaries and part headers around the photo
QUEUE_FACTOR = 4  # requests allowed to queue per composite slot before we shed load


class TokenValidatorUnavailable(RuntimeError):
    """The validation endpoint could not be reached. That is our problem, not the caller's."""


@dataclass
class Runtime:
    """Heavy objects built once per process (in lifespan) or injected by tests."""

    remover: Remover | None = None
    uploader: Uploader | None = None
    http: httpx.AsyncClient | None = None
    face_detector: FaceDetector | None = None


def make_token_validator(validate_url: str, http_getter: Callable[[], httpx.AsyncClient]) -> TokenValidator:
    """GET validate_url with the bearer. Non-200 means invalid; an unreachable endpoint raises
    TokenValidatorUnavailable so the route can answer 503 instead of a bogus 401."""

    async def _validate(token: str) -> bool:
        http = http_getter()
        try:
            response = await http.get(validate_url, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as exc:
            log.warning("token validation call failed: %s", exc)
            raise TokenValidatorUnavailable(str(exc)) from exc
        return response.status_code == 200

    return _validate


def _bearer(authorization: str) -> str:
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


def rate_limit_key(request: Request) -> str:
    """Budget per bearer token (the thing we actually want to cap); fall back to the client IP.

    The token is unvalidated at this point, so this key alone is rotatable: POST /composite also
    carries a per-source-IP limit (see create_app) that caps a caller minting fresh tokens.
    A 429 from either limit -- and the middleware's own 413 -- carries no X-Request-Id, because
    both answer before the route runs and no request id has been minted yet.

    The no-token fallback is prefixed `jwtip:` rather than `ip:` so that it can never collide with
    a `client_ip_key` bucket for the same address: slowapi namespaces a bucket by key plus limit
    string, so two equal limit values would otherwise share one counter across both limiters.

    slowapi passes the request only if this parameter is literally named `request`.
    """
    token = _bearer(request.headers.get("authorization", ""))
    if token:
        return "jwt:" + hashlib.sha256(token.encode()).hexdigest()[:32]
    return "jwtip:" + get_remote_address(request)


def _strip_port(host: str) -> str:
    """'1.2.3.4:5678' -> '1.2.3.4'; '[2001:db8::1]:5678' -> '2001:db8::1'; bare IPv6 untouched."""
    host = host.strip()
    if host.startswith("["):
        return host[1:].split("]", 1)[0]
    if host.count(":") == 1:
        return host.split(":", 1)[0]
    return host


def client_ip_key(request: Request) -> str:
    """Per-source-IP bucket keyed on the RIGHTMOST X-Forwarded-For entry (appended by the trusted
    platform proxy; the leftmost is client-controlled). All header occurrences are joined first,
    as RFC 7230 requires, so a client-injected extra header line cannot shadow the proxy's. Empty
    segments (a trailing comma, say) are dropped so they cannot blank out the real rightmost entry.
    Falls back to the raw socket peer as seen by uvicorn when the header is absent or the rightmost
    segment strips to empty (e.g. a malformed entry like `:8080` with no host part) -- note that
    under `--forwarded-allow-ips='*'` uvicorn rewrites that socket peer from X-Forwarded-For itself,
    so this fallback may in turn be the leftmost forwarded entry. slowapi passes the request only if
    this parameter is literally named `request`."""
    forwarded = ", ".join(request.headers.getlist("x-forwarded-for"))
    parts = [part.strip() for part in forwarded.split(",") if part.strip()]
    rightmost = _strip_port(parts[-1]) if parts else ""
    if rightmost:
        return "ip:" + rightmost
    client = request.scope.get("client")
    host = client[0] if client else None
    return "ip:" + (host or get_remote_address(request))


async def _validate_request(
    photo: UploadFile,
    template: str,
    fields: TextFields,
    settings: Settings,
    placements: dict[str, Placement],
    request_id: str,
) -> tuple[Placement, bytes]:
    """Cheap guards before any real work: returns the placement and the photo bytes."""
    headers = {"X-Request-Id": request_id}
    placement = placements.get(template)
    if placement is None:
        raise HTTPException(status_code=400, detail=f"Unknown template '{template[:32]}'", headers=headers)
    if photo.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported image type", headers=headers)
    # Belt and braces: BodyLimitMiddleware already capped the whole body further upstream.
    data = await photo.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        megabytes = settings.max_upload_bytes // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"Photo larger than {megabytes} MB", headers=headers)
    if any(len(v) > settings.max_field_chars for v in (fields.name, fields.constituency, fields.state)):
        raise HTTPException(status_code=422, detail="Field too long", headers=headers)
    return placement, data


def create_app(
    settings: Settings | None = None,
    remover: Remover | None = None,
    uploader: Uploader | None = None,
    token_validator: TokenValidator | None = None,
    placements: dict[str, Placement] | None = None,
    face_detector: FaceDetector | None = None,
) -> FastAPI:
    """App factory. Run with `uvicorn app.main:create_app --factory`."""
    settings = settings if settings is not None else load_settings()
    placements = placements if placements is not None else load_placements()
    runtime = Runtime(remover=remover, uploader=uploader, face_detector=face_detector)

    if not settings.allowed_origins:
        raise ValueError("ALLOWED_ORIGINS is not set")

    if settings.jwt_validate_url:
        try:
            parsed = httpx.URL(settings.jwt_validate_url)
        except httpx.InvalidURL as exc:
            raise ValueError("JWT_VALIDATE_URL is not a valid http(s) URL") from exc
        if parsed.scheme not in ("http", "https") or not parsed.host:
            raise ValueError("JWT_VALIDATE_URL is not a valid http(s) URL")

    upload_dir: Path | None = None
    if settings.storage_backend == "local":
        upload_dir = Path(settings.local_storage_dir)
        upload_dir.mkdir(parents=True, exist_ok=True)

    def http_client() -> httpx.AsyncClient:
        if runtime.http is None:
            raise TokenValidatorUnavailable("HTTP client not started")
        return runtime.http

    if token_validator is None and settings.jwt_validate_url:
        token_validator = make_token_validator(settings.jwt_validate_url, http_client)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
        if runtime.remover is None:
            runtime.remover = make_remover(settings.model_name)
        if runtime.face_detector is None and settings.face_check_enabled:
            runtime.face_detector = make_face_detector(score_threshold=settings.face_score_threshold)
        if runtime.uploader is None and settings.response_mode == "url":
            if settings.storage_backend == "local":
                runtime.uploader = LocalUploader(upload_dir, settings.public_base_url)
            else:
                runtime.uploader = S3Uploader(
                    bucket=settings.s3_bucket,
                    region=settings.aws_region,
                    prefix=settings.s3_prefix,
                    public_read_acl=settings.s3_public_read_acl,
                    public_base_url=settings.s3_public_base_url,
                )
        async with AsyncExitStack() as stack:
            # One client per process, and only when something actually validates tokens:
            # building it loads the system trust store, which is slow and pointless otherwise.
            if settings.jwt_validate_url:
                runtime.http = await stack.enter_async_context(httpx.AsyncClient(timeout=5.0))
            try:
                yield
            finally:
                runtime.http = None

    app = FastAPI(title="AI Shubhkamna compositing", lifespan=lifespan)

    if upload_dir is not None:
        app.mount("/uploads", StaticFiles(directory=str(upload_dir)), name="uploads")

    composite_limiter = anyio.CapacityLimiter(settings.max_concurrent_composites)
    app.state.composite_limiter = composite_limiter

    limiter = Limiter(key_func=rate_limit_key, storage_uri=settings.rate_limit_storage_uri or "memory://")
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # Added first so CORS ends up outermost and can decorate the middleware's own 413.
    app.add_middleware(BodyLimitMiddleware, max_bytes=settings.max_upload_bytes + MULTIPART_OVERHEAD)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["X-Request-Id", "X-Poster-Warning"],
    )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        """FastAPI's own 422 for a missing/malformed field never reaches the route, so mint the
        request id here too -- otherwise the one error a caller hits most often has no id to quote."""
        request_id = uuid.uuid4().hex[:8]
        return JSONResponse(
            status_code=422,
            content={"detail": jsonable_encoder(exc.errors())},
            headers={"X-Request-Id": request_id},
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> Response:
        """Catches every HTTPException, including ones the route never gets to raise -- Starlette's
        own multipart parser raises a plain HTTPException(400) for a malformed body (e.g. a missing
        boundary) before the route body runs. setdefault preserves a request id the route already
        minted and attached via exc.headers; it only mints a fresh one when none is there yet."""
        response = await http_exception_handler(request, exc)
        response.headers.setdefault("X-Request-Id", uuid.uuid4().hex[:8])
        return response

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "model_loaded": runtime.remover is not None,
            "uploader_ready": runtime.uploader is not None,
            "storage": settings.storage_backend,
            "response_mode": settings.response_mode,
        }

    # Same two-limit shape as /composite (see below): both must pass.
    @app.get("/profile")
    @limiter.limit(f"{settings.rate_limit_per_minute}/minute")  # per bearer token (rate_limit_key)
    @limiter.limit(f"{settings.rate_limit_per_ip_per_minute}/minute", key_func=client_ip_key)  # per source IP
    async def get_profile(
        request: Request,
        response: Response,
        authorization: str = Header(""),
    ) -> Any:
        request_id = uuid.uuid4().hex[:8]
        rid = {"X-Request-Id": request_id}

        if not (settings.jwt_signing_secret and settings.profile_key_secret and settings.profile_iv_secret):
            raise HTTPException(status_code=503, detail="Profile lookup is not configured", headers=rid)

        token = _bearer(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Missing bearer token", headers=rid)

        try:
            payload = jwt.decode(token, settings.jwt_signing_secret, algorithms=["HS256"])
        except jwt.ExpiredSignatureError as exc:
            raise HTTPException(status_code=401, detail="Token expired", headers=rid) from exc
        except jwt.InvalidTokenError as exc:
            raise HTTPException(status_code=401, detail="Invalid token", headers=rid) from exc

        data_claim = payload.get("data")
        if not isinstance(data_claim, str) or not data_claim:
            raise HTTPException(status_code=422, detail="Token has no profile data", headers=rid)

        log.info(
            "profile req=%s jwt=%s",
            request_id,
            hashlib.sha256(token.encode()).hexdigest()[:12],
        )

        try:
            decrypted = decrypt_profile(data_claim, settings.profile_key_secret, settings.profile_iv_secret)
            profile = profile_from_claims(decrypted)
        except ProfileError as exc:
            log.error("profile req=%s could not read profile: %s", request_id, exc)
            raise HTTPException(status_code=502, detail="Could not read profile", headers=rid) from exc

        response.headers["X-Request-Id"] = request_id
        return {
            "username": profile.username,
            "email": profile.email,
            "mobileno": profile.mobileno,
            "state": profile.state,
            "constituency": profile.constituency,
            "district": profile.district,
        }

    # Both limits must pass. The bearer bucket is the one we care about, but it is keyed on an
    # unvalidated token, so the per-IP bucket is the backstop against a caller rotating tokens.
    @app.post("/composite")
    @limiter.limit(f"{settings.rate_limit_per_minute}/minute")  # per bearer token (rate_limit_key)
    @limiter.limit(f"{settings.rate_limit_per_ip_per_minute}/minute", key_func=client_ip_key)  # per source IP
    async def composite(
        request: Request,
        response: Response,
        photo: UploadFile = File(...),
        template: str = Form(...),
        name: str = Form(""),
        constituency: str = Form(""),
        state: str = Form(""),
        authorization: str = Header(""),
    ) -> Any:
        request_id = uuid.uuid4().hex[:8]
        rid = {"X-Request-Id": request_id}

        token = _bearer(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Missing bearer token", headers=rid)
        if token_validator is not None:
            try:
                accepted = await token_validator(token)
            except TokenValidatorUnavailable as exc:
                raise HTTPException(503, "Token check unavailable, retry shortly", headers=rid) from exc
            if not accepted:
                raise HTTPException(status_code=401, detail="Invalid token", headers=rid)

        fields = TextFields(name=name, constituency=constituency, state=state)
        placement, data = await _validate_request(photo, template, fields, settings, placements, request_id)
        if runtime.remover is None:
            raise HTTPException(status_code=503, detail="Service starting", headers=rid)
        if settings.response_mode == "url" and runtime.uploader is None:
            raise HTTPException(status_code=503, detail="Service starting", headers=rid)

        log.info(
            "composite req=%s template=%s jwt=%s bytes=%d",
            request_id,
            template,
            hashlib.sha256(token.encode()).hexdigest()[:12],
            len(data),
        )
        # Approximate ceiling: this read and the acquire below are not atomic, so a burst can
        # push the queue slightly past the bound before the next request sees it.
        if composite_limiter.statistics().tasks_waiting >= settings.max_concurrent_composites * QUEUE_FACTOR:
            raise HTTPException(status_code=503, detail="Busy, retry shortly", headers=rid)

        try:
            async with composite_limiter:
                rendered = await run_in_threadpool(
                    functools.partial(
                        compose, data, placement, fields, runtime.remover, face_detector=runtime.face_detector
                    )
                )
            warning = "text-overlap" if rendered.text_overlap else ""
            if settings.response_mode == "image":
                headers = {"X-Request-Id": request_id}
                if warning:
                    headers["X-Poster-Warning"] = warning
                return Response(content=rendered.jpeg, media_type="image/jpeg", headers=headers)
            assert runtime.uploader is not None
            url = await run_in_threadpool(runtime.uploader.upload_jpeg, rendered.jpeg)
        except BadImageError as exc:
            raise HTTPException(status_code=415, detail=str(exc), headers=rid) from exc
        except NoFaceError as exc:
            raise HTTPException(status_code=422, detail="no_face", headers=rid) from exc
        except MultipleFacesError as exc:
            raise HTTPException(status_code=422, detail="multiple_faces", headers=rid) from exc
        except NoSubjectError as exc:
            raise HTTPException(status_code=422, detail="no_subject", headers=rid) from exc
        except UploadError as exc:
            log.error("composite req=%s upload failed: %s", request_id, exc)
            raise HTTPException(status_code=502, detail="Upload failed", headers=rid) from exc
        except HTTPException:
            raise
        except Exception:
            log.exception("composite req=%s failed", request_id)
            raise HTTPException(500, f"Internal error (req {request_id})", headers=rid) from None

        response.headers["X-Request-Id"] = request_id
        if warning:
            response.headers["X-Poster-Warning"] = warning
        return {"imageUrl": url, "warning": warning or None}

    return app
