import dataclasses
import io

import pytest
from PIL import Image, ImageDraw

from app.config import Settings, load_settings


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
    """Stand-in for rembg: keeps the centre 40 % width x 80 % height opaque, everything else transparent."""
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
