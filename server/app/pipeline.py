"""Pure image functions. No I/O except reading the template file in compose()."""
from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

from .placements import Box, Placement
from .remover import Remover

MAX_SIDE = 2000
MAX_PIXELS = 50_000_000
ALPHA_THRESHOLD = 8
FONT_PATH = Path(__file__).resolve().parent / "fonts" / "Poppins-SemiBold.ttf"
LINE_HEIGHT_FACTOR = 1.25


class BadImageError(ValueError):
    """The upload could not be decoded as an image."""


class NoSubjectError(ValueError):
    """Background removal left nothing opaque."""


@dataclass(frozen=True)
class TextFields:
    name: str = ""
    constituency: str = ""
    state: str = ""


def decode_photo(data: bytes) -> Image.Image:
    """Decode an upload to an RGB image no larger than MAX_SIDE on its longest edge.

    Raises BadImageError for anything Pillow cannot turn into a usable image, including
    inputs whose pixel count exceeds MAX_PIXELS (a cheap DoS via a tiny-but-huge JPEG).
    """
    try:
        img = Image.open(io.BytesIO(data))
        width, height = img.size
        if width * height > MAX_PIXELS:
            raise BadImageError(f"Image too large ({width}x{height} px)")
        img.draft("RGB", (MAX_SIDE, MAX_SIDE))  # JPEG DCT downscale; must precede load()
        img.load()
        img = ImageOps.exif_transpose(img)
        if max(img.size) > MAX_SIDE:
            img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        return img.convert("RGB")
    except BadImageError:
        raise
    except Exception as exc:  # Pillow raises several unrelated types for bad input
        raise BadImageError("Could not decode image") from exc


def crop_to_subject(rgba: Image.Image) -> Image.Image:
    if rgba.mode != "RGBA":
        rgba = rgba.convert("RGBA")
    alpha = rgba.getchannel("A").point(lambda a: 255 if a > ALPHA_THRESHOLD else 0)
    bbox = alpha.getbbox()
    if bbox is None:
        raise NoSubjectError("No person detected in photo")
    return rgba.crop(bbox)


def fit_bottom_center(size: tuple[int, int], box: Box) -> Box:
    """Box that contains `size` inside `box`, centred horizontally, anchored to the bottom.

    Precondition: both dimensions of `size` and of `box` are >= 1 (guaranteed by
    crop_to_subject and load_placements).
    """
    width, height = size
    scale = min(box.w / width, box.h / height)
    fitted_w = max(1, round(width * scale))
    fitted_h = max(1, round(height * scale))
    x = box.x + (box.w - fitted_w) // 2
    y = box.bottom - fitted_h
    return Box(x=x, y=y, w=fitted_w, h=fitted_h)
