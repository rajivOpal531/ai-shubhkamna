import io
import time
from collections import Counter

import pytest
from PIL import Image, ImageChops, ImageDraw

from app.pipeline import (
    FONT_PATH,
    MAX_SIDE,
    MIN_FONT_SCALE,
    BadImageError,
    NoSubjectError,
    TextFields,
    _fit_font,
    _load_font,
    _sample_background,
    _truncate,
    compose,
    crop_to_subject,
    decode_photo,
    draw_text_block,
    fit_bottom_center,
    text_lines,
)
from app.placements import Box, Placement, load_placements
from tests.conftest import empty_remover, fake_remover, make_photo_bytes


def test_decode_photo_returns_rgb_and_caps_longest_side():
    data = make_photo_bytes(width=3000, height=1500)
    img = decode_photo(data)
    assert img.mode == "RGB"
    assert max(img.size) == MAX_SIDE
    assert img.size == (2000, 1000)


def test_decode_photo_applies_exif_orientation():
    src = Image.new("RGB", (400, 200), "white")
    exif = src.getexif()
    exif[0x0112] = 6  # rotate 90 CW on display
    buf = io.BytesIO()
    src.save(buf, "JPEG", exif=exif.tobytes())
    img = decode_photo(buf.getvalue())
    assert img.size == (200, 400)


def test_decode_photo_rejects_garbage():
    with pytest.raises(BadImageError):
        decode_photo(b"definitely not an image")


def test_decode_photo_does_not_upscale_small_images():
    data = make_photo_bytes(width=300, height=200)
    img = decode_photo(data)
    assert img.size == (300, 200)


def test_decode_photo_rejects_images_over_max_pixels(monkeypatch):
    monkeypatch.setattr("app.pipeline.MAX_PIXELS", 1000)
    data = make_photo_bytes(width=100, height=100)
    with pytest.raises(BadImageError, match="too large"):
        decode_photo(data)


def test_decode_photo_wraps_errors_after_open(monkeypatch):
    def boom(img):
        raise OSError("bad exif")

    monkeypatch.setattr("app.pipeline.ImageOps.exif_transpose", boom)
    data = make_photo_bytes(width=100, height=100)
    with pytest.raises(BadImageError):
        decode_photo(data)


def test_decode_photo_png_with_alpha_becomes_rgb():
    img = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
    img.putpixel((0, 0), (255, 0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    decoded = decode_photo(buf.getvalue())
    assert decoded.mode == "RGB"
    assert decoded.size == (20, 20)
    assert decoded.getpixel((0, 0)) == (255, 255, 255)


def test_crop_to_subject_returns_opaque_bbox():
    photo = decode_photo(make_photo_bytes(600, 800))
    cutout = crop_to_subject(fake_remover(photo))
    assert cutout.mode == "RGBA"
    assert cutout.size == (240, 640)


def test_crop_to_subject_raises_when_nothing_is_opaque():
    photo = decode_photo(make_photo_bytes(600, 800))
    with pytest.raises(NoSubjectError):
        crop_to_subject(empty_remover(photo))


def test_crop_to_subject_converts_rgb_to_rgba():
    photo = decode_photo(make_photo_bytes(600, 800))
    assert photo.mode == "RGB"
    cutout = crop_to_subject(photo)
    assert cutout.mode == "RGBA"
    assert cutout.size == photo.size


def test_crop_to_subject_threshold_boundary():
    below = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    below.putpixel((5, 5), (255, 0, 0, 8))
    with pytest.raises(NoSubjectError):
        crop_to_subject(below)

    above = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    above.putpixel((5, 5), (255, 0, 0, 9))
    cutout = crop_to_subject(above)
    assert cutout.size == (1, 1)


def test_fit_bottom_center_scales_tall_image_by_height():
    fitted = fit_bottom_center((240, 640), Box(x=468, y=540, w=612, h=720))
    assert isinstance(fitted, Box)
    assert fitted.h == 720
    assert fitted.w == 270
    assert fitted.y == 540
    assert fitted.x == 468 + (612 - 270) // 2


def test_fit_bottom_center_scales_wide_image_by_width_and_anchors_bottom():
    fitted = fit_bottom_center((1000, 250), Box(x=0, y=540, w=628, h=720))
    assert fitted.w == 628
    assert fitted.h == 157
    assert fitted.x == 0
    assert fitted.y == 540 + 720 - 157


def test_fit_bottom_center_upscales_small_cutouts():
    fitted = fit_bottom_center((50, 50), Box(x=468, y=540, w=612, h=720))
    assert fitted.w == fitted.h == 612
    assert fitted.y == 540 + 720 - 612


def test_decode_photo_rejects_oversized_images_before_decoding_pixels(monkeypatch):
    # Build the fixture bytes first: ImageDraw.rectangle() and Image.save("JPEG") both call
    # Image.load() internally, so constructing them under the spy would pollute the count.
    data = make_photo_bytes(width=100, height=100)

    calls: list[int] = []
    original_load = Image.Image.load

    def spying_load(self, *args, **kwargs):
        calls.append(1)
        return original_load(self, *args, **kwargs)

    monkeypatch.setattr(Image.Image, "load", spying_load)
    monkeypatch.setattr("app.pipeline.MAX_PIXELS", 1000)
    with pytest.raises(BadImageError, match="too large"):
        decode_photo(data)
    assert calls == []


def test_text_lines_skips_blank_fields():
    assert text_lines(TextFields()) == []
    assert text_lines(TextFields(name=" Rajiv ")) == ["-Rajiv"]
    assert text_lines(TextFields(name="Rajiv", state="Bihar")) == ["-Rajiv", "Bihar"]
    assert text_lines(TextFields(name="Rajiv", constituency="Patna Sahib", state="Bihar")) == [
        "-Rajiv",
        "Patna Sahib, Bihar",
    ]


def test_text_lines_collapses_whitespace():
    assert text_lines(TextFields(name="Rajiv\nRanjan", constituency=" Patna\tSahib ", state="Bihar")) == [
        "-Rajiv Ranjan",
        "Patna Sahib, Bihar",
    ]


def _synthetic_placement(align: str = "left", text_color: str = "#FF0000") -> Placement:
    return Placement(
        template_id="synthetic",
        photo_box=Box(x=100, y=100, w=100, h=100),
        text_box=Box(x=20, y=20, w=160, h=60),
        text_color=text_color,
        font_size=24,
        align=align,
    )


def test_draw_text_block_covers_placeholder_and_draws_text_color():
    card = Image.new("RGB", (300, 300), (30, 60, 200))
    ImageDraw.Draw(card).text((25, 25), "-Your name", fill=(255, 255, 255))  # fake placeholder
    placement = _synthetic_placement()

    draw_text_block(card, placement, TextFields())
    box_pixels = set(card.crop((20, 20, 180, 80)).getdata())
    assert box_pixels == {(30, 60, 200)}, "empty fields must still wipe the placeholder"

    draw_text_block(card, placement, TextFields(name="Rajiv"))
    assert (255, 0, 0) in set(card.crop((20, 20, 180, 80)).getdata())


def test_draw_text_block_right_aligns_when_requested():
    card = Image.new("RGB", (300, 300), (255, 255, 255))
    placement = _synthetic_placement(align="right", text_color="#000000")
    draw_text_block(card, placement, TextFields(name="Ab"))
    cols_with_ink = [
        x for x in range(20, 180) if any(card.getpixel((x, y)) != (255, 255, 255) for y in range(20, 80))
    ]
    assert cols_with_ink, "expected some text ink"
    assert max(cols_with_ink) >= placement.text_box.right - 1 - 3, "ink should reach the right edge of the box"
    assert min(cols_with_ink) > placement.text_box.x + 10, "short right-aligned text should sit in the right half"


def test_draw_text_block_truncates_long_lines_with_ellipsis():
    card = Image.new("RGB", (300, 300), (255, 255, 255))
    placement = _synthetic_placement(text_color="#000000")
    draw_text_block(card, placement, TextFields(name="A" * 200))
    assert all(card.getpixel((x, 40)) == (255, 255, 255) for x in range(181, 300)), "ink must stay inside the box"
    assert any(
        card.getpixel((x, y)) != (255, 255, 255) for x in range(20, 180) for y in range(20, 80)
    ), "expected some ink to have been drawn inside the box"


def test_truncate_returns_fitting_prefix_with_ellipsis():
    img = Image.new("RGB", (300, 100), "white")
    draw = ImageDraw.Draw(img)
    font = _load_font(FONT_PATH, 24)

    result = _truncate(draw, "A" * 200, font, 150)
    assert result.endswith("…")
    assert len(result) < 200
    assert draw.textlength(result, font=font) <= 150

    assert _truncate(draw, "Ab", font, 150) == "Ab"


def test_truncate_is_fast_on_long_input():
    img = Image.new("RGB", (300, 100), "white")
    draw = ImageDraw.Draw(img)
    font = _load_font(FONT_PATH, 24)

    start = time.perf_counter()
    _truncate(draw, "A" * 5000, font, 150)
    assert time.perf_counter() - start < 0.5


def test_fit_font_shrinks_but_not_below_floor():
    img = Image.new("RGB", (300, 300), "white")
    draw = ImageDraw.Draw(img)

    long_line_font = _fit_font(draw, ["A" * 200], FONT_PATH, 24, 160)
    assert round(24 * MIN_FONT_SCALE) <= long_line_font.size < 24

    short_line_font = _fit_font(draw, ["Ab"], FONT_PATH, 24, 160)
    assert short_line_font.size == 24


def test_draw_text_block_shrinks_long_location_instead_of_truncating():
    """A location line that doesn't fit at the placement's font size, but does fit once
    shrunk toward MIN_FONT_SCALE, should be shrunk rather than truncated with an ellipsis."""
    img = Image.new("RGB", (300, 300), "white")
    draw = ImageDraw.Draw(img)
    box_width = _synthetic_placement().text_box.w

    line = "Madhya Pradesh"
    font = _fit_font(draw, [line], FONT_PATH, 24, box_width)
    assert font.size < 24, "line should have required shrinking at the synthetic box width"
    assert _truncate(draw, line, font, box_width) == line, "shrunk text should fit without truncation"


def test_sample_background_matches_dominant_block_colour_on_every_template():
    for placement in load_placements().values():
        tb = placement.text_box
        with Image.open(placement.template_path) as template:
            card = template.convert("RGB")
        dominant, _ = Counter(card.crop((tb.x, tb.y, tb.right, tb.bottom)).getdata()).most_common(1)[0]
        sampled = _sample_background(card, tb)
        assert all(abs(sampled[i] - dominant[i]) <= 10 for i in range(3)), (placement.template_id, sampled, dominant)


def test_draw_text_block_ink_stays_inside_text_box_on_every_template():
    fields = TextFields(name="Rajiv Ranjan", constituency="Gautam Buddha Nagar", state="Uttar Pradesh")
    for placement in load_placements().values():
        with Image.open(placement.template_path) as template:
            original = template.convert("RGB")
        copy = original.copy()
        draw_text_block(copy, placement, fields)
        diff = ImageChops.difference(copy, original).convert("L").point(lambda p: 255 if p > 24 else 0)
        bbox = diff.getbbox()
        assert bbox is not None, f"{placement.template_id}: expected drawing to change some pixels"
        bx0, by0, bx1, by1 = bbox
        tb = placement.text_box
        assert bx0 >= tb.x and by0 >= tb.y and bx1 <= tb.right and by1 <= tb.bottom, (
            placement.template_id,
            bbox,
            tb,
        )


def test_compose_end_to_end_produces_a_jpeg_of_card_size(photo_bytes):
    placement = load_placements()["card-2"]
    out = compose(photo_bytes, placement, TextFields(name="Rajiv", constituency="Patna", state="Bihar"), fake_remover)
    img = Image.open(io.BytesIO(out))
    assert img.format == "JPEG"
    assert img.size == (1080, 1260)

    with Image.open(placement.template_path) as template:
        clean = template.convert("RGB")
    tb = placement.text_box
    out_crop = img.convert("RGB").crop((tb.x, tb.y, tb.right, tb.bottom))
    clean_crop = clean.crop((tb.x, tb.y, tb.right, tb.bottom))
    assert ImageChops.difference(out_crop, clean_crop).getbbox() is not None


def test_compose_pastes_cutout_inside_photo_box(photo_bytes):
    placement = load_placements()["card-15"]
    out = compose(photo_bytes, placement, TextFields(), fake_remover)
    img = Image.open(io.BytesIO(out)).convert("RGB")
    pb = placement.photo_box
    # fake cutout is a flat (230,200,180)-ish rectangle; sample its centre-bottom
    cx, cy = pb.x + pb.w // 2, pb.bottom - 10
    r, g, b = img.getpixel((cx, cy))
    assert abs(r - 230) < 20 and abs(g - 200) < 20 and abs(b - 180) < 20


def test_compose_raises_no_subject_when_remover_returns_transparent(photo_bytes):
    placement = load_placements()["card-1"]
    with pytest.raises(NoSubjectError):
        compose(photo_bytes, placement, TextFields(), empty_remover)
