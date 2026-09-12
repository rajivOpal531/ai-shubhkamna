"""FastAPI wiring. Business logic lives in pipeline.py / storage.py."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from .config import Settings, load_settings

log = logging.getLogger("ai-shubh")

Remover = Callable[[Image.Image], Image.Image]


def make_remover(model_name: str) -> Remover:
    """Build the real rembg remover. Imported lazily so tests never load the model."""
    from rembg import new_session, remove  # noqa: WPS433 (lazy on purpose)

    session = new_session(model_name)

    def _remove(img: Image.Image) -> Image.Image:
        return remove(img, session=session).convert("RGBA")

    return _remove


def create_app(
    settings: Settings | None = None,
    remover: Remover | None = None,
    uploader: Any | None = None,
) -> FastAPI:
    settings = settings or load_settings()
    runtime: dict[str, Any] = {"remover": remover, "uploader": uploader}

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if runtime["remover"] is None:
            runtime["remover"] = make_remover(settings.model_name)
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
        return {"status": "ok", "model_loaded": runtime["remover"] is not None}

    return app


app = create_app()
