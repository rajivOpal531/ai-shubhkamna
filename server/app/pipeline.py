"""Pure image functions. No I/O except reading the template file in compose()."""
from __future__ import annotations

import io
import statistics
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

from .placements import Box, Placement
from .remover import Remover

MAX_SIDE = 2000
MAX_PIXELS = 24_000_000  # ~2x headroom over a 12 MP phone photo; PNG/WebP skip the JPEG draft downscale below
ALPHA_THRESHOLD = 8
FONT_PATH = Path(__file__).resolve().parent / "fonts" / "Poppins-SemiBold.ttf"
LINE_HEIGHT_FACTOR = 1.25
MIN_FONT_SCALE = 0.6

Font = ImageFont.FreeTypeFont


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


def _clean(value: str) -> str:
    return " ".join(value.split())


def text_lines(fields: TextFields) -> list[str]:
    lines: list[str] = []
    if _clean(fields.name):
        lines.append(f"-{_clean(fields.name)}")
    location = ", ".join(part for part in (_clean(fields.constituency), _clean(fields.state)) if part)
    if location:
        lines.append(location)
    return lines


def _load_font(path: Path, size: int) -> Font:
    """Per-call load: FreeTypeFont glyph rendering is not thread-safe when shared across requests."""
    if path.is_file():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size)  # keeps tests runnable before the font is vendored


def _truncate(draw: ImageDraw.ImageDraw, text: str, font: Font, max_width: int) -> str:
    """Longest prefix of `text` that fits in `max_width` (with a trailing ellipsis if anything was cut)."""
    if draw.textlength(text, font=font) <= max_width:
        return text
    lo, hi = 0, len(text)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if draw.textlength(text[:mid] + "…", font=font) <= max_width:
            lo = mid
        else:
            hi = mid - 1
    if lo == 0 and draw.textlength("…", font=font) > max_width:
        return ""
    return text[:lo] + "…"


def _fit_font(
    draw: ImageDraw.ImageDraw, lines: list[str], font_path: Path, size: int, max_width: int, max_height: int
) -> Font:
    """Single linear estimate of the largest common size in [size * MIN_FONT_SCALE, size] that fits both
    the widest line and the block's height; the caller still truncates anything that overflows at the floor."""
    font = _load_font(font_path, size)
    widest = max((draw.textlength(line, font=font) for line in lines), default=0)
    width_estimate = size if widest <= max_width or widest == 0 else int(size * max_width / widest)
    cap = max(1, int(max_height / (max(1, len(lines)) * LINE_HEIGHT_FACTOR)))
    floor = max(1, round(size * MIN_FONT_SCALE))
    candidate = max(floor, min(size, cap, width_estimate))
    if candidate == size:
        return font
    return _load_font(font_path, candidate)


def layout_caption(
    draw: ImageDraw.ImageDraw, fields: TextFields, font_path: Path, size: int, box: Box
) -> tuple[list[str], Font]:
    """Pick the caption lines and font size for `box`.

    Tries the normal `text_lines` layout first. If any line still overflows the box width at
    the fitted size, and both constituency and state are present (so the location line is
    "<constituency>, <state>"), also tries splitting the location across two lines
    ("Constituency," / "State") and refitting. Whichever layout overflows fewer lines wins;
    a tie goes to the larger font.
    """
    lines = text_lines(fields)
    if not lines:
        return lines, _load_font(font_path, size)

    font = _fit_font(draw, lines, font_path, size, box.w, box.h)
    overflowing = sum(1 for line in lines if draw.textlength(line, font=font) > box.w)

    constituency = _clean(fields.constituency)
    state = _clean(fields.state)
    if overflowing and constituency and state:
        split: list[str] = []
        name = _clean(fields.name)
        if name:
            split.append(f"-{name}")
        split.append(f"{constituency},")
        split.append(state)

        split_font = _fit_font(draw, split, font_path, size, box.w, box.h)
        split_overflowing = sum(1 for line in split if draw.textlength(line, font=split_font) > box.w)

        if (split_overflowing, -split_font.size) < (overflowing, -font.size):
            return split, split_font

    return lines, font


def _sample_background(card: Image.Image, tb: Box, pad: int = 4) -> tuple[int, int, int]:
    """Median of three samples down the left edge of the text box: immune to a stray pixel or JPEG ringing."""
    x = max(tb.x - pad, 0)
    samples = [card.getpixel((x, y)) for y in (tb.y, tb.y + tb.h // 2, tb.bottom - 1)]
    return tuple(int(statistics.median(px[i] for px in samples)) for i in range(3))  # type: ignore[return-value]


def draw_text_block(card: Image.Image, placement: Placement, fields: TextFields, font_path: Path = FONT_PATH) -> None:
    """Wipe the placeholder text with the sampled background and draw the user's lines."""
    tb = placement.text_box
    draw = ImageDraw.Draw(card)
    draw.rectangle((tb.x, tb.y, tb.right - 1, tb.bottom - 1), fill=_sample_background(card, tb))
    lines, font = layout_caption(draw, fields, font_path, placement.font_size, tb)
    if not lines:
        return
    # The vertical cap in _fit_font already bounds font.size so that
    # len(lines) * round(font.size * LINE_HEIGHT_FACTOR) fits within tb.h.
    line_height = round(font.size * LINE_HEIGHT_FACTOR)
    y = tb.y
    for line in lines:
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
    with Image.open(placement.template_path) as template:
        card = template.convert("RGB")
    draw_text_block(card, placement, fields, font_path)  # text first so the cutout can overlap it like the design
    fitted = fit_bottom_center(cutout.size, placement.photo_box)
    cutout = cutout.resize((fitted.w, fitted.h), Image.LANCZOS)
    card.paste(cutout, (fitted.x, fitted.y), cutout)
    buffer = io.BytesIO()
    card.save(buffer, "JPEG", quality=90, subsampling=0, optimize=True)
    return buffer.getvalue()
