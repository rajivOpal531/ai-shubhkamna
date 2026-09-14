"""Pure image functions. No I/O except reading the template file in compose()."""
from __future__ import annotations

import io
import logging
import statistics
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

from .faces import FaceDetector
from .placements import Box, Placement
from .remover import Remover

# Teach Pillow to open HEIC/HEIF so iOS gallery photos (which are HEIC by default) decode instead of
# failing as "unsupported". pillow-heif bundles libheif, so no system package is required.
try:
    import pillow_heif

    pillow_heif.register_heif_opener()
    HEIF_SUPPORTED = True
except Exception as exc:  # pragma: no cover
    # Log loudly rather than swallow: without this, every iPhone (HEIC) upload fails as "unsupported".
    logging.getLogger("ai-shubh").error("HEIC support unavailable -- pillow-heif failed to load: %r", exc)
    HEIF_SUPPORTED = False

MAX_SIDE = 2000
MAX_PIXELS = 24_000_000  # ~2x headroom over a 12 MP phone photo; PNG/WebP skip the JPEG draft downscale below
ALPHA_THRESHOLD = 8
FONT_PATH = Path(__file__).resolve().parent / "fonts" / "Satoshi-Bold.ttf"
LINE_HEIGHT_FACTOR = 1.25
# The caption uses the largest size that fits the box, down to this absolute floor. Below this the
# text is unreadable, so a very long location shrinks to the floor and then truncates rather than
# going smaller; normal-length names/locations render at the placement's full size.
MIN_FONT_PX = 20

# Only an extreme face-fills-the-frame close-up should prompt "upload your upper body". A normal
# head-and-shoulders shot already measures ~0.076, so the threshold sits well above that; the
# compositor now places any photo cleanly, so this only catches genuinely tight face crops.
FACE_MAX_AREA_RATIO = 0.35

Font = ImageFont.FreeTypeFont


class BadImageError(ValueError):
    """The upload could not be decoded as an image."""


class NoSubjectError(ValueError):
    """Background removal left nothing opaque."""


class NoFaceError(ValueError):
    """The face detector found no face in the upload."""


class MultipleFacesError(ValueError):
    """The face detector found more than one face in the upload."""


@dataclass(frozen=True)
class TextFields:
    name: str = ""
    constituency: str = ""
    state: str = ""


@dataclass(frozen=True)
class Rendered:
    """Result of compose(): the JPEG plus whether the person overlapped the caption region."""

    jpeg: bytes
    text_overlap: bool = False


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
    # 0.94 safety factor: the width-vs-size relationship is only approximately linear, so a bare
    # estimate can land a pixel or two too wide and force a truncation. Undershoot slightly instead.
    width_estimate = size if widest <= max_width or widest == 0 else int(size * max_width * 0.94 / widest)
    cap = max(1, int(max_height / (max(1, len(lines)) * LINE_HEIGHT_FACTOR)))
    candidate = max(MIN_FONT_PX, min(size, cap, width_estimate))
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


TEXT_CLEAR_MARGIN = 24


def clear_of_text(photo_box: Box, text_box: Box) -> Box:
    """Shrink `photo_box` so it never overlaps `text_box`.

    If the boxes overlap, the person is moved to the side of the caption with more room (usually the
    opposite side of the text) and resized to fit that clear column. Guarantees the photo cannot cover
    the caption text; masking in compose() catches any pixels that still spill in.
    """
    overlaps = (
        photo_box.x < text_box.right
        and photo_box.right > text_box.x
        and photo_box.y < text_box.bottom
        and photo_box.bottom > text_box.y
    )
    if not overlaps:
        return photo_box
    left_room = text_box.x - photo_box.x
    right_room = photo_box.right - text_box.right
    if right_room >= left_room:
        new_x = text_box.right + TEXT_CLEAR_MARGIN
        new_w = photo_box.right - new_x
    else:
        new_x = photo_box.x
        new_w = (text_box.x - TEXT_CLEAR_MARGIN) - photo_box.x
    if new_w < 60:  # no usable room on either side; keep the box and rely on masking
        return photo_box
    return Box(new_x, photo_box.y, new_w, photo_box.h)


def clear_of_all_text(photo_box: Box, boxes: tuple[Box, ...]) -> Box:
    """Shrink `photo_box` so it clears every text region. Fitting the photo into the result keeps it a
    solid, opaque cutout (no rectangular holes masked through it) while never covering the text."""
    box = photo_box
    for text_box in boxes:
        box = clear_of_text(box, text_box)
    return box


# Grow the photo up to this y (keeping clear of the top border artwork) when the space above it is free.
GROW_TOP_MARGIN = 180


def grow_up_into_clear_space(box: Box, boxes: tuple[Box, ...], top_margin: int = GROW_TOP_MARGIN) -> Box:
    """Extend `box` upward (staying bottom-anchored) into empty vertical space in its own column, so the
    photo fills the available room instead of sitting small with whitespace beside the text. Stops just
    below any text that sits in the box's horizontal span."""
    top = top_margin
    for tb in boxes:
        in_column = tb.right > box.x and tb.x < box.right
        above = tb.bottom <= box.y
        if in_column and above:
            top = max(top, tb.bottom + TEXT_CLEAR_MARGIN)
    new_top = min(box.y, top)
    return Box(box.x, new_top, box.w, box.bottom - new_top)


def _mask_out_text_box(cutout: Image.Image, x: int, y: int, text_box: Box) -> None:
    """Zero the alpha of any cutout pixels that fall inside `text_box` (with a margin), so the person
    can never be drawn over the caption even if the fitted box still slightly intersects it."""
    left = max(text_box.x - TEXT_CLEAR_MARGIN - x, 0)
    top = max(text_box.y - TEXT_CLEAR_MARGIN - y, 0)
    right = min(text_box.right + TEXT_CLEAR_MARGIN - x, cutout.width)
    bottom = min(text_box.bottom + TEXT_CLEAR_MARGIN - y, cutout.height)
    if right <= left or bottom <= top:
        return
    clear = Image.new("L", (right - left, bottom - top), 0)
    cutout.putalpha(_paste_alpha(cutout.getchannel("A"), clear, left, top))


def _opaque_in_text_box(cutout: Image.Image, x: int, y: int, text_box: Box) -> bool:
    """True if any sufficiently-opaque cutout pixel falls inside `text_box` (with the clear margin),
    i.e. the person would cover the caption. Measured before masking so we can warn the user."""
    left = max(text_box.x - TEXT_CLEAR_MARGIN - x, 0)
    top = max(text_box.y - TEXT_CLEAR_MARGIN - y, 0)
    right = min(text_box.right + TEXT_CLEAR_MARGIN - x, cutout.width)
    bottom = min(text_box.bottom + TEXT_CLEAR_MARGIN - y, cutout.height)
    if right <= left or bottom <= top:
        return False
    region = cutout.getchannel("A").crop((left, top, right, bottom))
    return region.getextrema()[1] > ALPHA_THRESHOLD


def _paste_alpha(alpha: Image.Image, clear: Image.Image, left: int, top: int) -> Image.Image:
    alpha = alpha.copy()
    alpha.paste(clear, (left, top))
    return alpha


def _paste_clipped(card: Image.Image, cutout: Image.Image, x: int, y: int) -> None:
    """Paste `cutout` with its top-left at (x, y), clipping whatever falls outside the card (x/y may be
    negative or push the cutout past an edge). This crops overflow instead of squashing it, so the
    result matches the Adjust preview, which crops the photo at the card border the same way."""
    left = max(0, -x)
    top = max(0, -y)
    right = min(cutout.width, card.width - x)
    bottom = min(cutout.height, card.height - y)
    if right <= left or bottom <= top:
        return
    piece = cutout.crop((left, top, right, bottom))
    card.paste(piece, (x + left, y + top), piece)


def compose(
    photo_bytes: bytes,
    placement: Placement,
    fields: TextFields,
    remover: Remover,
    font_path: Path = FONT_PATH,
    face_detector: FaceDetector | None = None,
) -> Rendered:
    """Full pipeline: returns JPEG bytes of the finished card. Opens the template fresh per call (thread safety).

    When `face_detector` is supplied, the upload is checked first: no face -> NoFaceError,
    more than one -> MultipleFacesError. This runs before the (much heavier) background removal
    so a bad photo is rejected fast with a specific message.
    """
    photo = decode_photo(photo_bytes)
    if face_detector is not None:
        faces = face_detector(photo)
        if len(faces) == 0:
            raise NoFaceError("No face detected in photo")
        if len(faces) > 1:
            raise MultipleFacesError(f"{len(faces)} faces detected in photo")
    cutout = crop_to_subject(remover(photo))
    with Image.open(placement.template_path) as template:
        card = template.convert("RGB")
    # Confine the photo to the region clear of the caption AND the baked title/message, then grow it up
    # into the empty space in that column so it fills the available room rather than sitting small with
    # whitespace. Fitting keeps the cutout solid and opaque; masking is a safety net so text is never
    # covered even if a box could not be fully cleared. The photo may overlap template artwork -- fine.
    protected = (placement.text_box, *placement.text_keepout)
    clear_box = grow_up_into_clear_space(clear_of_all_text(placement.photo_box, protected), protected)
    fitted = fit_bottom_center(cutout.size, clear_box)
    cutout = cutout.resize((fitted.w, fitted.h), Image.LANCZOS)
    for b in protected:
        _mask_out_text_box(cutout, fitted.x, fitted.y, b)
    card.paste(cutout, (fitted.x, fitted.y), cutout)
    draw_text_block(card, placement, fields, font_path)
    buffer = io.BytesIO()
    card.save(buffer, "JPEG", quality=90, subsampling=0, optimize=True)
    return Rendered(jpeg=buffer.getvalue(), text_overlap=False)


def remove_background(
    photo_bytes: bytes,
    remover: Remover,
    face_detector: FaceDetector | None = None,
) -> tuple[bytes, bool]:
    """Decode + (optional) face-check + background removal, cropped to the subject.

    Returns the cutout as PNG bytes (transparent background) and whether the face is a close-up
    (a hint the Adjust UI can surface). Used by the "adjust photo" flow, which composites later.
    """
    photo = decode_photo(photo_bytes)
    close_up = False
    if face_detector is not None:
        faces = face_detector(photo)
        if len(faces) == 0:
            raise NoFaceError("No face detected in photo")
        if len(faces) > 1:
            raise MultipleFacesError(f"{len(faces)} faces detected in photo")
        close_up = max(w * h for _, _, w, h in faces) > FACE_MAX_AREA_RATIO
    cutout = crop_to_subject(remover(photo))
    buffer = io.BytesIO()
    cutout.save(buffer, "PNG")
    return buffer.getvalue(), close_up


def compose_with_cutout(
    cutout_bytes: bytes,
    placement: Placement,
    fields: TextFields,
    box: Box,
    font_path: Path = FONT_PATH,
) -> Rendered:
    """Composite an already-background-removed cutout at an explicit `box` (card coordinates), for
    the user-adjusted flow. No background removal here -- the caller supplies the cutout and where
    it goes. The caption is still masked out of the person and drawn last.
    """
    try:
        cutout = Image.open(io.BytesIO(cutout_bytes)).convert("RGBA")
    except Exception as exc:  # not a decodable image -> 415, not a 500
        raise BadImageError("Could not decode cutout") from exc
    with Image.open(placement.template_path) as template:
        card = template.convert("RGB")
    # Resize to the exact size the user chose (preserving its aspect ratio); the box may run past the
    # card edges, which is fine -- _paste_clipped crops the overflow just like the Adjust preview does.
    # Squashing w/h independently to fit the card (the old behaviour) distorted the photo.
    x, y = round(box.x), round(box.y)
    w, h = max(1, round(box.w)), max(1, round(box.h))
    cutout = cutout.resize((w, h), Image.LANCZOS)
    protected = (placement.text_box, *placement.text_keepout)
    for b in protected:
        _mask_out_text_box(cutout, x, y, b)
    _paste_clipped(card, cutout, x, y)
    draw_text_block(card, placement, fields, font_path)
    buffer = io.BytesIO()
    card.save(buffer, "JPEG", quality=90, subsampling=0, optimize=True)
    return Rendered(jpeg=buffer.getvalue(), text_overlap=False)
