import io

import pytest
from PIL import Image, ImageDraw

from app.pipeline import (
    MAX_SIDE,
    BadImageError,
    NoSubjectError,
    TextFields,
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
    assert min(cols_with_ink) > 100, "short right-aligned text should sit in the right half of the box"


def test_draw_text_block_truncates_long_lines_with_ellipsis():
    card = Image.new("RGB", (300, 300), (255, 255, 255))
    placement = _synthetic_placement(text_color="#000000")
    draw_text_block(card, placement, TextFields(name="A" * 200))
    assert all(card.getpixel((x, 40)) == (255, 255, 255) for x in range(181, 300)), "ink must stay inside the box"


def test_compose_end_to_end_produces_a_jpeg_of_card_size(photo_bytes):
    placement = load_placements()["card-2"]
    out = compose(photo_bytes, placement, TextFields(name="Rajiv", constituency="Patna", state="Bihar"), fake_remover)
    img = Image.open(io.BytesIO(out))
    assert img.format == "JPEG"
    assert img.size == (1080, 1260)


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
