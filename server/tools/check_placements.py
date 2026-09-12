"""Renders every placement as outlines on the with-silhouette card from src/assets/templates
(falls back to the clean card) so photo_box can be checked against the silhouette.

Usage (from server/):  python tools/check_placements.py [output_dir]
Exits non-zero if any box is outside the card or any file is missing.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.placements import CARD_SIZE, Placement, load_placements  # noqa: E402

VECTOR_DIR = Path(__file__).resolve().parents[2] / "src" / "assets" / "templates"


def vector_path(template_id: str) -> Path:
    return VECTOR_DIR / f"pm-birthday-AI-Shubhkamna-{template_id}.jpg"


def main(out_dir: Path, placements: dict[str, Placement] | None = None) -> int:
    placements = load_placements() if placements is None else placements
    out_dir.mkdir(parents=True, exist_ok=True)
    problems: list[str] = []
    tiles: list[Image.Image] = []
    for template_id, placement in placements.items():
        if not placement.template_path.is_file():
            problems.append(f"{template_id}: missing {placement.template_path}")
            continue
        source_path = vector_path(template_id)
        if not source_path.is_file():
            print(f"note: {template_id}: no silhouette card at {source_path}, drew on clean card")
            source_path = placement.template_path
        card = Image.open(source_path).convert("RGB")
        if card.size != CARD_SIZE:
            problems.append(f"{template_id}: size {card.size} != {CARD_SIZE}")
        for label, box in (("photo_box", placement.photo_box), ("text_box", placement.text_box)):
            if not box.inside(card.size):
                problems.append(f"{template_id}: {label} {box} outside card")
        draw = ImageDraw.Draw(card)
        pb, tb = placement.photo_box, placement.text_box
        draw.rectangle((pb.x, pb.y, pb.right - 1, pb.bottom - 1), outline=(0, 255, 0), width=6)
        draw.rectangle((tb.x, tb.y, tb.right - 1, tb.bottom - 1), outline=(255, 0, 255), width=5)
        card.save(out_dir / f"{template_id}.jpg", quality=85)
        tiles.append(card.resize((360, 420)))

    for problem in problems:
        print("PROBLEM:", problem)

    if tiles:
        cols = 4
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new("RGB", (360 * cols, 420 * rows), "white")
        for i, tile in enumerate(tiles):
            sheet.paste(tile, ((i % cols) * 360, (i // cols) * 420))
        sheet.save(out_dir / "contact-sheet.jpg", quality=88)

    if tiles:
        print(f"wrote {len(tiles)} cards + contact-sheet.jpg to {out_dir}")
    else:
        print(f"wrote 0 cards to {out_dir} (no contact sheet)")
    return 1 if problems else 0


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("check-output")
    raise SystemExit(main(target))
