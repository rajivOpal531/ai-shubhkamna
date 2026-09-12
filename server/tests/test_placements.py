import re
from pathlib import Path

import pytest

from app.placements import CARD_SIZE, Box, TEMPLATES_DIR, load_placements

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_TEMPLATES = REPO_ROOT / "src" / "data" / "templates.ts"


def test_box_geometry_helpers():
    box = Box(x=10, y=20, w=30, h=40)
    assert box.right == 40
    assert box.bottom == 60
    assert box.inside((40, 60)) is True
    assert box.inside((39, 60)) is False


def test_every_frontend_template_has_a_placement_and_a_clean_file():
    frontend_ids = set(re.findall(r"id:\s*'(card-\d+)'", FRONTEND_TEMPLATES.read_text(encoding="utf-8")))
    placements = load_placements()
    assert frontend_ids, "could not read ids from src/data/templates.ts"
    assert set(placements) == frontend_ids
    for placement in placements.values():
        assert placement.template_path.is_file(), placement.template_path


def test_all_boxes_lie_inside_the_card():
    for placement in load_placements().values():
        assert placement.photo_box.inside(CARD_SIZE), placement.template_id
        assert placement.text_box.inside(CARD_SIZE), placement.template_id
        assert placement.align in ("left", "right")
        assert re.fullmatch(r"#[0-9A-Fa-f]{6}", placement.text_color)


def test_load_placements_rejects_unknown_align(tmp_path):
    bad = tmp_path / "placements.json"
    bad.write_text(
        '{"card-1": {"photo_box": {"x":0,"y":0,"w":1,"h":1}, "text_box": {"x":0,"y":0,"w":1,"h":1},'
        ' "text_color": "#000000", "font_size": 10, "align": "center"}}',
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="align"):
        load_placements(bad)


def test_templates_dir_points_at_server_templates():
    assert (TEMPLATES_DIR / "clean").is_dir()
