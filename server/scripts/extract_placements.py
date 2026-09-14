"""Regenerate templates/placements.json from the design PSD (one open file, all templates as layers).

The PSD is a design asset, not committed to the repo. Get it from the "Open File PSD" Dropbox
folder (pm-birthday-AI-Shubhkamna-card.psd), then:

    pip install psd-tools aggdraw
    python scripts/extract_placements.py path/to/pm-birthday-AI-Shubhkamna-card.psd

What it does, per template:
  * photo_box    -> the "Layer 8" pixel layer (the sample user photo) bounds, clamped to the card.
  * text_box     -> the "-Your name constituency, State" caption layer, its height extended downward
                    so a real 3-line caption (name / constituency, / state) fits at the design font.
  * text_keepout -> the other two text layers (title + message). The compositor masks the user photo
                    out of these so baked text is never covered (overlapping the artwork is fine).
  * font_size / text_color / align -> read from the caption layer's type engine data.

The app's templates are card-1,2,3,4,5,6,8,9,10,11,15 (ids 7,12,13,14 are intentionally absent).
The card numbers do NOT map 1:1 to the PSD "Design-N" groups (card-4<->Design-5 and card-5<->Design-4
are swapped), so each clean template is matched to its design by rendering the design (sample person
hidden) and comparing to server/templates/clean/card-*.jpg. This makes the mapping self-correcting if
the PSD is re-numbered.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from psd_tools import PSDImage

HERE = Path(__file__).resolve().parent.parent
CLEAN_DIR = HERE / "templates" / "clean"
OUT_PATH = HERE / "templates" / "placements.json"
APP_CARDS = ["1", "2", "3", "4", "5", "6", "8", "9", "10", "11", "15"]
LINE_HEIGHT_FACTOR = 1.25  # keep in sync with pipeline.LINE_HEIGHT_FACTOR


def _thumb(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("L").resize((120, 140), Image.BILINEAR), dtype=np.float32)


def _render_design(group, size) -> Image.Image:
    """Flatten one design group with the sample photo (Layer 8) hidden — matches a clean template."""
    was_visible = group.visible
    group.visible = True
    saved = {}
    for child in group.descendants():
        if getattr(child, "name", None) == "Layer 8":
            saved[child] = child.visible
            child.visible = False
    img = group.composite(viewport=(0, 0, *size), force=True)
    if img.mode == "RGBA":
        flat = Image.new("RGB", img.size, (255, 255, 255))
        flat.paste(img, mask=img.split()[-1])
        img = flat
    for child, vis in saved.items():
        child.visible = vis
    group.visible = was_visible
    return img


def _match_cards_to_designs(designs: dict) -> dict[str, str]:
    thumbs = {n: _thumb(_render_design(g, g._psd.size)) for n, g in designs.items()}
    mapping = {}
    for cid in APP_CARDS:
        clean = _thumb(Image.open(CLEAN_DIR / f"card-{cid}.jpg"))
        mapping[cid] = min(thumbs, key=lambda n: float(np.mean((clean - thumbs[n]) ** 2)))
    return mapping


def _clamp(bbox, cw, ch):
    left, top, right, bottom = bbox
    return (max(0, min(left, cw)), max(0, min(top, ch)), max(0, min(right, cw)), max(0, min(bottom, ch)))


def _rect_to_box(bbox, cw, ch):
    left, top, right, bottom = _clamp(bbox, cw, ch)
    return {"x": int(left), "y": int(top), "w": int(right - left), "h": int(bottom - top)}


def _caption_style(layer):
    engine = layer.engine_dict
    style = engine["StyleRun"]["RunArray"][0]["StyleSheet"]["StyleSheetData"]
    size = float(style.get("FontSize", 32))
    try:
        size *= abs(layer.transform[3]) or 1.0  # font size is in the layer's transform scale
    except Exception:
        pass
    fill = style.get("FillColor", {}).get("Values")  # [a, r, g, b] in 0..1
    color = "#000000"
    if fill and len(fill) == 4:
        r, g, b = (int(round(v * 255)) for v in fill[1:])
        color = f"#{r:02X}{g:02X}{b:02X}"
    props = engine["ParagraphRun"]["RunArray"][0]["ParagraphSheet"]["Properties"]
    align = "right" if int(props.get("Justification", 0)) == 1 else "left"
    return round(size), color, align


def main(psd_path: str) -> None:
    psd = PSDImage.open(psd_path)
    cw, ch = psd.width, psd.height
    designs = {
        str(g.name).split("-")[-1]: g
        for g in psd
        if g.is_group() and str(g.name).lower().startswith("design")
    }
    mapping = _match_cards_to_designs(designs)

    out = {}
    for cid in APP_CARDS:
        group = designs[mapping[cid]]
        layer8 = None
        types = []
        for child in group.descendants():
            if getattr(child, "name", None) == "Layer 8" and child.kind == "pixel":
                layer8 = child.bbox
            if child.kind == "type":
                types.append(child)
        caption = next(t for t in types if t.text.strip().startswith("-Your name"))
        others = [t for t in types if t is not caption]

        font_size, color, align = _caption_style(caption)
        photo_box = _rect_to_box(layer8, cw, ch)
        cx, cy, _, cbottom = _clamp(caption.bbox, cw, ch)
        # Grow the caption downward so a 3-line caption fits at the design font, but never into the
        # photo band (when the caption sits above it) or off the card.
        needed = round(font_size * LINE_HEIGHT_FACTOR) * 3
        limit = ch - 8
        if cy < photo_box["y"]:
            limit = min(limit, photo_box["y"] - 8)
        bottom = min(cy + max(cbottom - cy, needed), limit)

        out[f"card-{cid}"] = {
            "photo_box": photo_box,
            "text_box": {"x": cx, "y": cy, "w": _clamp(caption.bbox, cw, ch)[2] - cx, "h": bottom - cy},
            "text_keepout": [_rect_to_box(t.bbox, cw, ch) for t in others],
            "text_color": color,
            "font_size": font_size,
            "align": align,
        }
        print(f"card-{cid:>2s} <- Design-{mapping[cid]}  font={font_size} {color} {align}")

    OUT_PATH.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {OUT_PATH}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python scripts/extract_placements.py path/to/pm-birthday-AI-Shubhkamna-card.psd")
    main(sys.argv[1])
