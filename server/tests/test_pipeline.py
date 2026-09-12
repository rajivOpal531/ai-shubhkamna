import io

import pytest
from PIL import Image

from app.pipeline import (
    MAX_SIDE,
    BadImageError,
    NoSubjectError,
    crop_to_subject,
    decode_photo,
    fit_bottom_center,
)
from app.placements import Box
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
