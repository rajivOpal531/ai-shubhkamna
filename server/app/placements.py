"""Typed access to templates/placements.json (hand-measured template geometry)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

CARD_SIZE = (1080, 1260)
TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
PLACEMENTS_PATH = TEMPLATES_DIR / "placements.json"
ALIGNMENTS = ("left", "right")


@dataclass(frozen=True)
class Box:
    x: int
    y: int
    w: int
    h: int

    @property
    def right(self) -> int:
        return self.x + self.w

    @property
    def bottom(self) -> int:
        return self.y + self.h

    def inside(self, size: tuple[int, int]) -> bool:
        width, height = size
        return self.x >= 0 and self.y >= 0 and self.w > 0 and self.h > 0 and self.right <= width and self.bottom <= height


@dataclass(frozen=True)
class Placement:
    template_id: str
    photo_box: Box
    text_box: Box
    text_color: str
    font_size: int
    align: str

    @property
    def template_path(self) -> Path:
        return TEMPLATES_DIR / "clean" / f"{self.template_id}.jpg"


def load_placements(path: Path = PLACEMENTS_PATH) -> dict[str, Placement]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    placements: dict[str, Placement] = {}
    for template_id, entry in raw.items():
        align = entry.get("align", "left")
        if align not in ALIGNMENTS:
            raise ValueError(f"{template_id}: align must be one of {ALIGNMENTS}, got {align!r}")
        placements[template_id] = Placement(
            template_id=template_id,
            photo_box=Box(**entry["photo_box"]),
            text_box=Box(**entry["text_box"]),
            text_color=entry["text_color"],
            font_size=int(entry["font_size"]),
            align=align,
        )
    return placements
