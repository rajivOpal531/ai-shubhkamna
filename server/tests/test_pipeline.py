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


def test_crop_to_subject_returns_opaque_bbox():
    photo = decode_photo(make_photo_bytes(600, 800))
    cutout = crop_to_subject(fake_remover(photo))
    assert cutout.mode == "RGBA"
    assert cutout.size == (240, 640)


def test_crop_to_subject_raises_when_nothing_is_opaque():
    photo = decode_photo(make_photo_bytes(600, 800))
    with pytest.raises(NoSubjectError):
        crop_to_subject(empty_remover(photo))


def test_fit_bottom_center_scales_tall_image_by_height():
    x, y, w, h = fit_bottom_center((240, 640), Box(x=468, y=540, w=612, h=720))
    assert h == 720
    assert w == 270
    assert y == 540
    assert x == 468 + (612 - 270) // 2


def test_fit_bottom_center_scales_wide_image_by_width_and_anchors_bottom():
    x, y, w, h = fit_bottom_center((1000, 250), Box(x=0, y=540, w=628, h=720))
    assert w == 628
    assert h == 157
    assert x == 0
    assert y == 540 + 720 - 157
