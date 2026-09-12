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
        img.draft("RGB", (MAX_SIDE, MAX_SIDE))  # opportunistic JPEG DCT downscale; only applies when both edges are >= 2x MAX_SIDE. MAX_PIXELS is the real guard.
        img.load()
        ImageOps.exif_transpose(img, in_place=True)
        if max(img.size) > MAX_SIDE:
            img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            rgba = img.convert("RGBA")
            background = Image.new("RGB", rgba.size, (255, 255, 255))
            background.paste(rgba, mask=rgba.getchannel("A"))
            return background
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


def text_lines(fields: TextFields) -> list[str]:
    lines: list[str] = []
    if fields.name.strip():
        lines.append(f"-{fields.name.strip()}")
    location = ", ".join(part.strip() for part in (fields.constituency, fields.state) if part.strip())
    if location:
        lines.append(location)
    return lines


def _load_font(path: Path, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Per-call load: FreeTypeFont glyph rendering is not thread-safe when shared across requests."""
    if path.is_file():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size)  # keeps tests runnable before the font is vendored


def _truncate(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> str:
    if draw.textlength(text, font=font) <= max_width:
        return text
    while text and draw.textlength(text + "…", font=font) > max_width:
        text = text[:-1]
    return text + "…"


def draw_text_block(card: Image.Image, placement: Placement, fields: TextFields, font_path: Path = FONT_PATH) -> None:
    """Wipe the placeholder text with the sampled background and draw the user's lines."""
    tb = placement.text_box
    background = card.getpixel((max(tb.x - 4, 0), tb.y))
    draw = ImageDraw.Draw(card)
    draw.rectangle((tb.x, tb.y, tb.right - 1, tb.bottom - 1), fill=background)
    font = _load_font(font_path, placement.font_size)
    line_height = round(placement.font_size * LINE_HEIGHT_FACTOR)
    y = tb.y
    for line in text_lines(fields):
        line = _truncate(draw, line, font, tb.w)
        x = tb.right - draw.textlength(line, font=font) if placement.align == "right" else tb.x
        draw.text((x, y), line, font=font, fill=placement.text_color)
        y += line_height


def compose(
    photo_bytes: bytes,
    placement: Placement,
    fields: TextFields,
    remover: Remover,
    font_path: Path = FONT_PATH,
) -> bytes:
    """Full pipeline: returns JPEG bytes of the finished card. Opens the template fresh per call (thread safety)."""
    photo = decode_photo(photo_bytes)
    cutout = crop_to_subject(remover(photo))
    card = Image.open(placement.template_path).convert("RGB")
    draw_text_block(card, placement, fields, font_path)  # text first so the cutout can overlap it like the design
    fitted = fit_bottom_center(cutout.size, placement.photo_box)
    cutout = cutout.resize((fitted.w, fitted.h), Image.LANCZOS)
    card.paste(cutout, (fitted.x, fitted.y), cutout)
    buffer = io.BytesIO()
    card.save(buffer, "JPEG", quality=90)
    return buffer.getvalue()
