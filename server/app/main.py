"""FastAPI wiring. Business logic lives in pipeline.py / storage.py."""
from __future__ import annotations

import hashlib
import logging
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import anyio
import httpx
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from .config import Settings, load_settings
from .pipeline import BadImageError, NoSubjectError, TextFields, compose
from .placements import Placement, load_placements
from .remover import Remover, make_remover
from .storage import S3Uploader, UploadError, Uploader

log = logging.getLogger("ai-shubh")

TokenValidator = Callable[[str], Awaitable[bool]]

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


@dataclass
class Runtime:
    """Heavy objects built once per process (in lifespan) or injected by tests."""

    remover: Remover | None = None
    uploader: Uploader | None = None


def make_token_validator(validate_url: str) -> TokenValidator:
    """GET validate_url with the bearer; any non-200 or network problem counts as invalid."""

    async def _validate(token: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as http:
                response = await http.get(validate_url, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as exc:
            log.warning("token validation call failed: %s", exc)
            return False
        return response.status_code == 200

    return _validate


def _bearer(authorization: str) -> str:
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


def create_app(
    settings: Settings | None = None,
    remover: Remover | None = None,
    uploader: Uploader | None = None,
    token_validator: TokenValidator | None = None,
    placements: dict[str, Placement] | None = None,
) -> FastAPI:
    """App factory. Run with `uvicorn app.main:create_app --factory`."""
    settings = settings if settings is not None else load_settings()
    placements = placements if placements is not None else load_placements()
    runtime = Runtime(remover=remover, uploader=uploader)
    if token_validator is None and settings.jwt_validate_url:
        token_validator = make_token_validator(settings.jwt_validate_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
        if runtime.remover is None:
            runtime.remover = make_remover(settings.model_name)
        if runtime.uploader is None:
            runtime.uploader = S3Uploader(
                bucket=settings.s3_bucket,
                region=settings.aws_region,
                prefix=settings.s3_prefix,
                public_read_acl=settings.s3_public_read_acl,
            )
        yield

    app = FastAPI(title="AI Shubhkamna compositing", lifespan=lifespan)
    composite_limiter = anyio.CapacityLimiter(settings.max_concurrent_composites)
    app.state.composite_limiter = composite_limiter

    limiter = Limiter(key_func=get_remote_address)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "model_loaded": runtime.remover is not None,
            "uploader_ready": runtime.uploader is not None,
        }

    @app.post("/composite")
    @limiter.limit(f"{settings.rate_limit_per_minute}/minute")
    async def composite(
        request: Request,
        photo: UploadFile = File(...),
        template: str = Form(...),
        name: str = Form(""),
        constituency: str = Form(""),
        state: str = Form(""),
        authorization: str = Header(""),
    ) -> dict[str, str]:
        token = _bearer(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Missing bearer token")
        if token_validator is not None and not await token_validator(token):
            raise HTTPException(status_code=401, detail="Invalid token")

        placement = placements.get(template)
        if placement is None:
            raise HTTPException(status_code=400, detail=f"Unknown template '{template}'")
        if photo.content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(status_code=415, detail="Unsupported image type")

        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > settings.max_upload_bytes + 64 * 1024:
            raise HTTPException(status_code=413, detail="Photo larger than 10 MB")
        data = await photo.read(settings.max_upload_bytes + 1)
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(status_code=413, detail="Photo larger than 10 MB")
        if any(len(value) > settings.max_field_chars for value in (name, constituency, state)):
            raise HTTPException(status_code=422, detail="Field too long")

        assert runtime.remover is not None and runtime.uploader is not None  # set in lifespan
        request_id = uuid.uuid4().hex[:8]
        log.info(
            "composite req=%s template=%s jwt=%s bytes=%d",
            request_id,
            template,
            hashlib.sha256(token.encode()).hexdigest()[:12],
            len(data),
        )

        try:
            async with composite_limiter:
                jpeg = await run_in_threadpool(
                    compose, data, placement, TextFields(name=name, constituency=constituency, state=state), runtime.remover
                )
        except BadImageError as exc:
            raise HTTPException(status_code=415, detail=str(exc)) from exc
        except NoSubjectError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        try:
            url = await run_in_threadpool(runtime.uploader.upload_jpeg, jpeg)
        except UploadError as exc:
            log.error("composite req=%s upload failed: %s", request_id, exc)
            raise HTTPException(status_code=502, detail="Upload failed") from exc

        return {"imageUrl": url}

    return app
