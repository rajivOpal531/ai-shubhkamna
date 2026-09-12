"""Render every placement as outlines on its clean card for visual review.

Usage (from server/):  python tools/check_placements.py [output_dir]
Exits non-zero if any box is outside the card or any file is missing.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.placements import CARD_SIZE, load_placements  # noqa: E402


def main(out_dir: Path) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    problems: list[str] = []
    tiles: list[Image.Image] = []
    for template_id, p in load_placements().items():
        if not p.template_path.is_file():
            problems.append(f"{template_id}: missing {p.template_path}")
            continue
        card = Image.open(p.template_path).convert("RGB")
        if card.size != CARD_SIZE:
            problems.append(f"{template_id}: size {card.size} != {CARD_SIZE}")
        for label, box in (("photo_box", p.photo_box), ("text_box", p.text_box)):
            if not box.inside(card.size):
                problems.append(f"{template_id}: {label} {box} outside card")
        draw = ImageDraw.Draw(card)
        pb, tb = p.photo_box, p.text_box
        draw.rectangle((pb.x, pb.y, pb.right - 1, pb.bottom - 1), outline=(0, 255, 0), width=6)
        draw.rectangle((tb.x, tb.y, tb.right - 1, tb.bottom - 1), outline=(255, 0, 255), width=5)
        card.save(out_dir / f"{template_id}.jpg", quality=85)
        tiles.append(card.resize((360, 420)))
    cols = 4
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (360 * cols, 420 * rows), "white")
    for i, tile in enumerate(tiles):
        sheet.paste(tile, ((i % cols) * 360, (i // cols) * 420))
    sheet.save(out_dir / "contact-sheet.jpg", quality=88)
    for problem in problems:
        print("PROBLEM:", problem)
    print(f"wrote {len(tiles)} cards + contact-sheet.jpg to {out_dir}")
    return 1 if problems else 0


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("check-output")
    raise SystemExit(main(target))
