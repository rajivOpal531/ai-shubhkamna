"""Typed access to templates/placements.json (hand-measured template geometry)."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

CARD_SIZE = (1080, 1260)
TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
PLACEMENTS_PATH = TEMPLATES_DIR / "placements.json"
ALIGNMENTS = ("left", "right")
HEX_COLOR = re.compile(r"#[0-9A-Fa-f]{6}")


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
        return (
            self.x >= 0 and self.y >= 0 and self.w > 0 and self.h > 0
            and self.right <= width and self.bottom <= height
        )


@dataclass(frozen=True)
class Placement:
    template_id: str
    photo_box: Box
    text_box: Box
    text_color: str
    font_size: int
    align: Literal["left", "right"]
    # Extra baked-in text regions (title, message) the composited photo must never cover. The
    # caption (text_box) is masked and redrawn separately; these are only masked out of the photo.
    text_keepout: tuple[Box, ...] = ()

    @property
    def template_path(self) -> Path:
        return TEMPLATES_DIR / "clean" / f"{self.template_id}.jpg"


def _box(entry: dict, key: str) -> Box:
    value = entry[key]
    fields = {}
    for field in ("x", "y", "w", "h"):
        v = value[field]
        if not isinstance(v, int) or isinstance(v, bool):
            raise ValueError(f"{key}.{field} must be an integer")
        fields[field] = v
    return Box(**fields)


def load_placements(path: Path = PLACEMENTS_PATH) -> dict[str, Placement]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("placements.json must be an object keyed by template id")
    placements: dict[str, Placement] = {}
    for template_id, entry in raw.items():
        try:
            if not isinstance(entry, dict):
                raise ValueError("entry must be an object")

            align = entry.get("align", "left")
            if align not in ALIGNMENTS:
                raise ValueError(f"align must be one of {ALIGNMENTS}, got {align!r}")

            text_color = entry["text_color"]
            if not isinstance(text_color, str) or not HEX_COLOR.fullmatch(text_color):
                raise ValueError("text_color must be #RRGGBB")

            font_size = entry["font_size"]
            if not isinstance(font_size, int) or isinstance(font_size, bool) or font_size <= 0:
                raise ValueError(f"font_size must be a positive integer, got {font_size!r}")

            photo_box = _box(entry, "photo_box")
            text_box = _box(entry, "text_box")
            if not photo_box.inside(CARD_SIZE):
                raise ValueError(f"photo_box outside card: {photo_box}")
            if not text_box.inside(CARD_SIZE):
                raise ValueError(f"text_box outside card: {text_box}")

            keepout_raw = entry.get("text_keepout", [])
            if not isinstance(keepout_raw, list):
                raise ValueError("text_keepout must be a list of boxes")
            text_keepout: list[Box] = []
            for i, kb in enumerate(keepout_raw):
                box = _box({"kb": kb}, "kb")
                if not box.inside(CARD_SIZE):
                    raise ValueError(f"text_keepout[{i}] outside card: {box}")
                text_keepout.append(box)

            placements[template_id] = Placement(
                template_id=template_id,
                photo_box=photo_box,
                text_box=text_box,
                text_color=text_color,
                font_size=font_size,
                align=align,
                text_keepout=tuple(text_keepout),
            )
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise ValueError(f"{template_id}: bad placement entry ({exc})") from exc
    return placements
