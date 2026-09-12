import json
import re
from pathlib import Path

import pytest
from PIL import Image

from app.placements import ALIGNMENTS, CARD_SIZE, Box, TEMPLATES_DIR, load_placements

# parents[2] deliberately reaches outside server/ to the repo root so this
# parity test fails loudly in a server-only checkout instead of passing
# vacuously (frontend_ids would be empty and the assertion below would be
# comparing two empty sets).
REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_TEMPLATES = REPO_ROOT / "src" / "data" / "templates.ts"

VALID_ENTRY = {
    "photo_box": {"x": 0, "y": 0, "w": 10, "h": 10},
    "text_box": {"x": 0, "y": 0, "w": 10, "h": 10},
    "text_color": "#000000",
    "font_size": 10,
    "align": "left",
}


def _load(tmp_path: Path, entry: dict) -> dict:
    bad = tmp_path / "placements.json"
    bad.write_text(json.dumps({"card-1": entry}), encoding="utf-8")
    return load_placements(bad)


def test_box_geometry_helpers():
    box = Box(x=10, y=20, w=30, h=40)
    assert box.right == 40
    assert box.bottom == 60
    assert box.inside((40, 60)) is True
    assert box.inside((39, 60)) is False


def test_every_frontend_template_has_a_placement_and_a_clean_file():
    frontend_ids = set(re.findall(r"""id:\s*['"](card-\d+)['"]""", FRONTEND_TEMPLATES.read_text(encoding="utf-8")))
    placements = load_placements()
    assert frontend_ids, "could not read ids from src/data/templates.ts"
    assert set(placements) == frontend_ids
    for placement in placements.values():
        assert placement.template_path.is_file(), placement.template_path


def test_clean_templates_are_card_size():
    for placement in load_placements().values():
        with Image.open(placement.template_path) as img:
            assert img.size == CARD_SIZE, placement.template_id


def test_all_boxes_lie_inside_the_card():
    for placement in load_placements().values():
        assert placement.photo_box.inside(CARD_SIZE), placement.template_id
        assert placement.text_box.inside(CARD_SIZE), placement.template_id
        assert placement.align in ALIGNMENTS
        assert re.fullmatch(r"#[0-9A-Fa-f]{6}", placement.text_color)


def test_text_box_never_overlaps_photo_box():
    for placement in load_placements().values():
        tb, pb = placement.text_box, placement.photo_box
        assert tb.right <= pb.x or pb.right <= tb.x or tb.bottom <= pb.y or pb.bottom <= tb.y, placement.template_id


def test_load_placements_rejects_unknown_align(tmp_path):
    bad = tmp_path / "placements.json"
    bad.write_text(
        '{"card-1": {"photo_box": {"x":0,"y":0,"w":1,"h":1}, "text_box": {"x":0,"y":0,"w":1,"h":1},'
        ' "text_color": "#000000", "font_size": 10, "align": "center"}}',
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="align"):
        load_placements(bad)


def test_load_placements_rejects_bad_text_color(tmp_path):
    entry = {**VALID_ENTRY, "text_color": "puce"}
    with pytest.raises(ValueError, match="text_color"):
        _load(tmp_path, entry)


def test_load_placements_rejects_photo_box_outside_card(tmp_path):
    entry = {**VALID_ENTRY, "photo_box": {"x": 0, "y": 0, "w": 99999, "h": 10}}
    with pytest.raises(ValueError, match="photo_box"):
        _load(tmp_path, entry)


def test_load_placements_rejects_non_integer_coordinate(tmp_path):
    entry = {**VALID_ENTRY, "photo_box": {"x": 0.5, "y": 0, "w": 10, "h": 10}}
    with pytest.raises(ValueError, match="integer"):
        _load(tmp_path, entry)


def test_load_placements_rejects_missing_box_field(tmp_path):
    entry = {**VALID_ENTRY, "photo_box": {"x": 0, "y": 0, "h": 10}}
    with pytest.raises(ValueError, match="card-1"):
        _load(tmp_path, entry)


def test_load_placements_rejects_non_object_top_level(tmp_path):
    bad = tmp_path / "placements.json"
    bad.write_text("[]", encoding="utf-8")
    with pytest.raises(ValueError, match="object"):
        load_placements(bad)


def test_load_placements_rejects_non_object_entry(tmp_path):
    bad = tmp_path / "placements.json"
    bad.write_text(json.dumps({"card-1": "oops"}), encoding="utf-8")
    with pytest.raises(ValueError, match="card-1"):
        load_placements(bad)


def test_load_placements_rejects_non_string_text_color(tmp_path):
    entry = {**VALID_ENTRY, "text_color": 123}
    with pytest.raises(ValueError, match="text_color"):
        _load(tmp_path, entry)
