"""Tests for the "adjust photo" flow: POST /cutout and the cutout+box path of POST /composite."""
import re

from app.placements import CARD_SIZE, load_placements
from tests.conftest import make_photo_bytes

AUTH = {"Authorization": "Bearer test-token"}
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"


def _cutout(client, photo=None, template="card-2", headers=AUTH):
    photo = make_photo_bytes() if photo is None else photo
    return client.post(
        "/cutout",
        data={"template": template},
        files={"photo": ("p.jpg", photo, "image/jpeg")},
        headers=headers,
    )


def _composite_cutout(client, png, box, template="card-2", headers=AUTH, **fields):
    return client.post(
        "/composite",
        data={"template": template, "box": box, **fields},
        files={"cutout": ("cut.png", png, "image/png")},
        headers=headers,
    )


def test_cutout_returns_transparent_png_and_geometry(client):
    response = _cutout(client)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/png")
    assert response.content[:8] == PNG_MAGIC
    assert re.match(r"^[0-9a-f]{8}$", response.headers["x-request-id"])

    placement = load_placements()["card-2"]
    pb = placement.photo_box
    tb = placement.text_box
    assert response.headers["x-card-size"] == f"{CARD_SIZE[0]},{CARD_SIZE[1]}"
    assert response.headers["x-photo-box"] == f"{pb.x},{pb.y},{pb.w},{pb.h}"
    assert response.headers["x-text-box"] == f"{tb.x},{tb.y},{tb.w},{tb.h}"


def test_cutout_requires_bearer(client):
    assert _cutout(client, headers={}).status_code == 401


def test_cutout_rejects_unknown_template(client):
    assert _cutout(client, template="does-not-exist").status_code == 400


def test_cutout_rejects_non_image(client):
    response = client.post(
        "/cutout",
        data={"template": "card-2"},
        files={"photo": ("p.txt", b"hello", "text/plain")},
        headers=AUTH,
    )
    assert response.status_code == 415


def test_adjusted_composite_places_cutout_image_mode(client):
    """The cutout produced by /cutout composites at an explicit box, returning the finished JPEG."""
    png = _cutout(client).content
    response = _composite_cutout(client, png, box="120,150,400,700", name="Rajiv", state="Bihar")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("image/jpeg")
    assert response.content[:3] == JPEG_MAGIC


def test_adjusted_composite_url_mode_uploads(url_client, uploader):
    png = _cutout(url_client).content
    response = _composite_cutout(url_client, png, box="120,150,400,700")
    assert response.status_code == 200, response.text
    assert response.json()["imageUrl"].startswith("https://example.test/mem/")
    assert len(uploader.objects) == 1
    assert next(iter(uploader.objects.values()))[:3] == JPEG_MAGIC


def test_adjusted_composite_rejects_bad_box(client):
    png = _cutout(client).content
    assert _composite_cutout(client, png, box="1,2,3").status_code == 422
    assert _composite_cutout(client, png, box="").status_code == 422
    assert _composite_cutout(client, png, box="a,b,c,d").status_code == 422
    assert _composite_cutout(client, png, box="10,10,0,100").status_code == 422


def test_adjusted_composite_rejects_undecodable_cutout(client):
    # We no longer gate on content-type (webviews send generic types); a genuinely undecodable
    # cutout is still rejected because compose_with_cutout can't open it.
    response = client.post(
        "/composite",
        data={"template": "card-2", "box": "10,10,400,600"},
        files={"cutout": ("cut.png", b"not an image at all", "image/png")},
        headers=AUTH,
    )
    assert response.status_code == 415


def test_adjusted_composite_out_of_bounds_box_is_clamped(client):
    """A box that runs past the card edge must not error -- compose_with_cutout clamps it."""
    png = _cutout(client).content
    response = _composite_cutout(client, png, box="900,1100,900,900")
    assert response.status_code == 200, response.text
    assert response.content[:3] == JPEG_MAGIC
