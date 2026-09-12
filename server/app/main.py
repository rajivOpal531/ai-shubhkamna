"""FastAPI wiring. Business logic lives in pipeline.py / storage.py."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, load_settings
from .remover import Remover, make_remover

log = logging.getLogger("ai-shubh")


@dataclass
class Runtime:
    """Heavy objects built once per process (in lifespan) or injected by tests."""

    remover: Remover | None = None
    uploader: Any | None = None  # becomes storage.Uploader once storage.py exists


def create_app(
    settings: Settings | None = None,
    remover: Remover | None = None,
    uploader: Any | None = None,
) -> FastAPI:
    """App factory. Run with `uvicorn app.main:create_app --factory`."""
    settings = settings if settings is not None else load_settings()
    runtime = Runtime(remover=remover, uploader=uploader)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if runtime.remover is None:
            runtime.remover = make_remover(settings.model_name)
        yield

    app = FastAPI(title="AI Shubhkamna compositing", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"status": "ok", "model_loaded": runtime.remover is not None}

    return app
