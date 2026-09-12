import dataclasses
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.config import Settings, load_settings
from app.main import create_app
from app.storage import MemoryUploader


def make_settings(**overrides) -> Settings:
    """Defaults from load_settings(env={}) plus a test origin; override any field by keyword."""
    return dataclasses.replace(load_settings(env={}), allowed_origins=["https://app.example"], **overrides)


def make_photo_bytes(width: int = 600, height: int = 800, fmt: str = "JPEG") -> bytes:
    """A flat blue photo with a beige rectangle covering 30-70 % of the width and 20-100 % of
    the height. fake_remover ignores pixel content; the rectangle is only there so rendered
    outputs look plausible."""
    img = Image.new("RGB", (width, height), (40, 90, 200))
    draw = ImageDraw.Draw(img)
    draw.rectangle((width * 0.3, height * 0.2, width * 0.7, height), fill=(230, 200, 180))
    buf = io.BytesIO()
    img.save(buf, fmt)
    return buf.getvalue()


def fake_remover(img: Image.Image) -> Image.Image:
    """Stand-in for rembg: a horizontally centred, bottom-anchored rectangle (30-70 % of width, 20-100 % of height) is opaque; everything else transparent."""
    width, height = img.size
    rgba = img.convert("RGBA")
    mask = Image.new("L", img.size, 0)
    # PIL rectangles are inclusive; the -1 makes the opaque area exactly 40% x 80% (600x800 -> 240x640).
    ImageDraw.Draw(mask).rectangle((width * 0.3, height * 0.2, width * 0.7 - 1, height - 1), fill=255)
    rgba.putalpha(mask)
    return rgba


def empty_remover(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    rgba.putalpha(Image.new("L", img.size, 0))
    return rgba


@pytest.fixture
def photo_bytes() -> bytes:
    return make_photo_bytes()


@pytest.fixture
def uploader() -> MemoryUploader:
    return MemoryUploader()


@pytest.fixture
def client(uploader):
    app = create_app(
        settings=make_settings(rate_limit_per_minute=100, rate_limit_per_ip_per_minute=1000),
        remover=fake_remover,
        uploader=uploader,
    )
    with TestClient(app) as test_client:
        yield test_client
