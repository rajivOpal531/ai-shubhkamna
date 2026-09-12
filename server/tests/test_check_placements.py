from pathlib import Path

from app.placements import Box, Placement
from tools.check_placements import main


def _placement(**overrides) -> Placement:
    base = dict(
        template_id="card-1",
        photo_box=Box(468, 540, 612, 720),
        text_box=Box(100, 1058, 360, 100),
        text_color="#1C1C1C",
        font_size=36,
        align="left",
    )
    base.update(overrides)
    return Placement(**base)


def test_tool_returns_zero_and_writes_sheet_for_valid_placement(tmp_path):
    assert main(tmp_path, {"card-1": _placement()}) == 0
    assert (tmp_path / "card-1.jpg").is_file()
    assert (tmp_path / "contact-sheet.jpg").is_file()


def test_tool_returns_one_and_no_sheet_when_template_file_is_missing(tmp_path, capsys):
    assert main(tmp_path, {"card-999": _placement(template_id="card-999")}) == 1
    assert "PROBLEM" in capsys.readouterr().out
    assert not (tmp_path / "contact-sheet.jpg").exists()
