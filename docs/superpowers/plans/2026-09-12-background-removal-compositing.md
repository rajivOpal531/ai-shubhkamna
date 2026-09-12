# Background Removal & Compositing Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client-side mock compositing with a Railway-hosted FastAPI service that removes the user's photo background, composites the cutout and name line onto the clean template, uploads to S3, and returns the URL.

**Architecture:** A `server/` Python package with four focused modules: `placements.py` (typed template geometry loaded from committed JSON), `pipeline.py` (pure image functions: decode → remove background → fit → paste → text → JPEG), `storage.py` (S3 uploader behind a tiny protocol with an in-memory stub), and `main.py` (FastAPI wiring: CORS, rate limit, JWT presence check, validation hook, error mapping). The frontend change is confined to `composite.ts` (real path gains profile fields + bearer header), `Processing.tsx` (receives `jwt` prop), a global stylesheet, and env config.

**Tech Stack:** Python 3.11, FastAPI, uvicorn, `rembg[cpu]` (ISNet model), Pillow, boto3, slowapi, httpx, pytest. Frontend unchanged: Vite + React + TS + vitest.

**Spec:** `docs/superpowers/specs/2026-09-12-background-removal-compositing-design.md`

**One deviation from the spec:** `Processing` receives `jwt` as a prop from `App` instead of calling `useJwt()` itself. `App`'s `Flow` already holds the jwt and passes everything else as props; a prop keeps `Processing` free of context and keeps its tests simple. Task 10 updates the spec line.

**Working directory note:** All `server/` commands below run from `D:\ai-shubhkamna\server` (Git Bash: `cd /d/ai-shubhkamna/server`). Frontend commands run from `D:\ai-shubhkamna`.

---

## File map

| Path | Responsibility |
|---|---|
| `server/requirements.txt` | runtime deps |
| `server/requirements-dev.txt` | runtime + pytest |
| `server/.env.example` | env variable names, empty values |
| `server/app/__init__.py` | package marker |
| `server/app/config.py` | `Settings` dataclass + `load_settings(env)` |
| `server/app/placements.py` | `Box`, `Placement`, `load_placements()`; template path resolution |
| `server/app/pipeline.py` | image functions; `compose()` orchestrator; `TextFields`; errors |
| `server/app/storage.py` | `Uploader` protocol, `S3Uploader`, `MemoryUploader`, `UploadError` |
| `server/app/remover.py` | `Remover` type alias + lazily-importing `make_remover()` |
| `server/app/main.py` | `create_app()` factory (no module-level app), `Runtime` dataclass, routes, middleware |
| `server/app/fonts/Poppins-SemiBold.ttf` + `OFL.txt` | bundled font |
| `server/templates/clean/card-*.jpg` | already committed |
| `server/templates/placements.json` | measured geometry (values in Task 2) |
| `server/tools/check_placements.py` | renders boxes on the with-silhouette cards (`src/assets/templates`) for visual review, validates bounds |
| `server/tests/conftest.py` | shared fixtures (fake remover, memory uploader, app) |
| `server/tests/test_*.py` | per-module tests |
| `server/Dockerfile` | Railway build |
| `server/README.md` | run, test, deploy |
| `src/services/composite.ts` | real path: fields + bearer |
| `src/steps/Processing.tsx` | `jwt` prop |
| `src/App.tsx` | pass `jwt` to `Processing` |
| `src/index.css`, `src/main.tsx`, `src/steps/Landing.css` | global font |
| `.env.example` | compositing URL + mock flag |

---

### Task 1: Server scaffold, settings, health endpoint

**Files:**
- Create: `server/requirements.txt`, `server/requirements-dev.txt`, `server/.env.example`, `server/app/__init__.py`, `server/app/config.py`, `server/app/main.py`, `server/tests/__init__.py`, `server/tests/test_config.py`, `server/tests/test_health.py`, `server/pytest.ini`
- Modify: `.gitignore` (repo root)

- [ ] **Step 1: Create dependency files**

`server/requirements.txt`:
```
fastapi>=0.115,<1
uvicorn[standard]>=0.30,<1
python-multipart>=0.0.9
rembg[cpu]>=2.0.59,<3
pillow>=10.4,<12
boto3>=1.35,<2
slowapi>=0.1.9,<1
httpx>=0.27,<1
```

`server/requirements-dev.txt`:
```
-r requirements.txt
pytest>=8.3,<9
```

`server/pytest.ini`:
```
[pytest]
testpaths = tests
pythonpath = .
```

`server/.env.example`:
```
# AWS credentials are read by boto3 from the environment. Never commit real values.
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=ap-south-1
S3_BUCKET=
S3_PREFIX=ai-shubh
S3_PUBLIC_READ_ACL=false

# Comma-separated list of browser origins allowed to call this service.
ALLOWED_ORIGINS=https://shubhkamnauat.narendramodi.in

# Per-client-IP limit for POST /composite.
RATE_LIMIT_PER_MINUTE=10

# Optional. When set, the bearer token is forwarded via GET to this URL and any non-200 rejects the request.
JWT_VALIDATE_URL=

# rembg model name; isnet-general-use is baked into the Docker image.
REMBG_MODEL=isnet-general-use
```

Append to repo-root `.gitignore`:
```
server/.venv/
server/.env
server/__pycache__/
server/**/__pycache__/
server/.pytest_cache/
server/check-output/
```

- [ ] **Step 2: Create the virtualenv and install dev deps**

```bash
cd /d/ai-shubhkamna/server
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements-dev.txt
```
Expected: installs complete (rembg pulls onnxruntime, ~200 MB; that is fine). All later `pytest`/`python` commands in this plan assume the venv is active.

- [ ] **Step 3: Write the failing settings test**

`server/tests/__init__.py`: empty file.

`server/tests/test_config.py`:
```python
from app.config import load_settings


def test_defaults_when_env_is_empty():
    s = load_settings(env={})
    assert s.s3_prefix == "ai-shubh"
    assert s.s3_public_read_acl is False
    assert s.allowed_origins == []
    assert s.rate_limit_per_minute == 10
    assert s.jwt_validate_url == ""
    assert s.max_upload_bytes == 10 * 1024 * 1024
    assert s.model_name == "isnet-general-use"


def test_parses_env_values():
    s = load_settings(
        env={
            "AWS_REGION": "ap-south-1",
            "S3_BUCKET": "cards",
            "S3_PREFIX": "/nested/prefix/",
            "S3_PUBLIC_READ_ACL": "TRUE",
            "ALLOWED_ORIGINS": "https://a.example, https://b.example ,",
            "RATE_LIMIT_PER_MINUTE": "3",
            "JWT_VALIDATE_URL": "https://api.example/validate",
            "REMBG_MODEL": "u2net",
        }
    )
    assert s.aws_region == "ap-south-1"
    assert s.s3_bucket == "cards"
    assert s.s3_prefix == "nested/prefix"
    assert s.s3_public_read_acl is True
    assert s.allowed_origins == ["https://a.example", "https://b.example"]
    assert s.rate_limit_per_minute == 3
    assert s.jwt_validate_url == "https://api.example/validate"
    assert s.model_name == "u2net"
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pytest tests/test_config.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app'`

- [ ] **Step 5: Implement config**

`server/app/__init__.py`: empty file.

`server/app/config.py`:
```python
"""Environment-driven settings. Everything secret stays in the environment."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class Settings:
    aws_region: str
    s3_bucket: str
    s3_prefix: str
    s3_public_read_acl: bool
    allowed_origins: list[str]
    rate_limit_per_minute: int
    jwt_validate_url: str
    max_upload_bytes: int
    model_name: str


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    origins = [o.strip() for o in env.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    return Settings(
        aws_region=env.get("AWS_REGION", ""),
        s3_bucket=env.get("S3_BUCKET", ""),
        s3_prefix=env.get("S3_PREFIX", "ai-shubh").strip("/"),
        s3_public_read_acl=env.get("S3_PUBLIC_READ_ACL", "false").strip().lower() == "true",
        allowed_origins=origins,
        rate_limit_per_minute=int(env.get("RATE_LIMIT_PER_MINUTE", "10")),
        jwt_validate_url=env.get("JWT_VALIDATE_URL", "").strip(),
        max_upload_bytes=10 * 1024 * 1024,
        model_name=env.get("REMBG_MODEL", "isnet-general-use"),
    )
```

- [ ] **Step 6: Run config tests**

Run: `pytest tests/test_config.py -v`
Expected: 2 passed

- [ ] **Step 7: Write the failing health test**

`server/tests/test_health.py`:
```python
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def _settings() -> Settings:
    return Settings(
        aws_region="ap-south-1",
        s3_bucket="b",
        s3_prefix="p",
        s3_public_read_acl=False,
        allowed_origins=["https://app.example"],
        rate_limit_per_minute=10,
        jwt_validate_url="",
        max_upload_bytes=10 * 1024 * 1024,
        model_name="isnet-general-use",
    )


def test_health_reports_model_loaded_when_remover_injected():
    app = create_app(settings=_settings(), remover=lambda img: img, uploader=object())
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "model_loaded": True}
```

- [ ] **Step 8: Run it to verify it fails**

Run: `pytest tests/test_health.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.main'`

- [ ] **Step 9: Implement the minimal app factory**

`server/app/main.py`:
```python
"""FastAPI wiring. Business logic lives in pipeline.py / storage.py."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from .config import Settings, load_settings

log = logging.getLogger("ai-shubh")

Remover = Callable[[Image.Image], Image.Image]


def make_remover(model_name: str) -> Remover:
    """Build the real rembg remover. Imported lazily so tests never load the model."""
    from rembg import new_session, remove  # noqa: WPS433 (lazy on purpose)

    session = new_session(model_name)

    def _remove(img: Image.Image) -> Image.Image:
        return remove(img, session=session).convert("RGBA")

    return _remove


def create_app(
    settings: Settings | None = None,
    remover: Remover | None = None,
    uploader: Any | None = None,
) -> FastAPI:
    settings = settings or load_settings()
    runtime: dict[str, Any] = {"remover": remover, "uploader": uploader}

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if runtime["remover"] is None:
            runtime["remover"] = make_remover(settings.model_name)
        yield

    app = FastAPI(title="AI Shubhkamna compositing", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"status": "ok", "model_loaded": runtime["remover"] is not None}

    return app


app = create_app()
```

- [ ] **Step 10: Run all tests**

Run: `pytest -v`
Expected: 3 passed

- [ ] **Step 11: Commit**

```bash
cd /d/ai-shubhkamna
git add .gitignore server/requirements.txt server/requirements-dev.txt server/pytest.ini server/.env.example server/app server/tests
git commit -m "feat(server): scaffold compositing service with settings and health endpoint"
```

---

### Task 2: Placements data, loader, and check tool

**Files:**
- Create: `server/templates/placements.json`, `server/app/placements.py`, `server/tools/check_placements.py`, `server/tests/test_placements.py`

- [ ] **Step 1: Write placements.json with the measured values**

These were measured from gridded copies of the cards and validated visually on 2026-09-12. `photo_box` is the silhouette bounding box; `text_box` wraps the "-Your name / constituency, State" placeholder.

`server/templates/placements.json`:
```json
{
  "card-1":  { "photo_box": { "x": 468, "y": 540, "w": 612, "h": 720 }, "text_box": { "x": 100, "y": 1058, "w": 360, "h": 100 }, "text_color": "#1C1C1C", "font_size": 36, "align": "left" },
  "card-2":  { "photo_box": { "x": 468, "y": 540, "w": 612, "h": 720 }, "text_box": { "x": 110, "y": 1068, "w": 470, "h": 90 },  "text_color": "#FFFFFF", "font_size": 36, "align": "left" },
  "card-3":  { "photo_box": { "x": 468, "y": 540, "w": 612, "h": 720 }, "text_box": { "x": 55,  "y": 1075, "w": 320, "h": 90 },  "text_color": "#FFFFFF", "font_size": 34, "align": "left" },
  "card-4":  { "photo_box": { "x": 468, "y": 540, "w": 612, "h": 720 }, "text_box": { "x": 578, "y": 368,  "w": 440, "h": 90 },  "text_color": "#000000", "font_size": 36, "align": "left" },
  "card-5":  { "photo_box": { "x": 468, "y": 540, "w": 612, "h": 720 }, "text_box": { "x": 718, "y": 320,  "w": 300, "h": 85 },  "text_color": "#FFFFFF", "font_size": 32, "align": "left" },
  "card-6":  { "photo_box": { "x": 468, "y": 540, "w": 612, "h": 720 }, "text_box": { "x": 60,  "y": 1115, "w": 400, "h": 85 },  "text_color": "#000000", "font_size": 34, "align": "left" },
  "card-8":  { "photo_box": { "x": 468, "y": 540, "w": 612, "h": 720 }, "text_box": { "x": 55,  "y": 1110, "w": 400, "h": 85 },  "text_color": "#FFFFFF", "font_size": 34, "align": "left" },
  "card-9":  { "photo_box": { "x": 468, "y": 540, "w": 612, "h": 720 }, "text_box": { "x": 58,  "y": 1092, "w": 400, "h": 85 },  "text_color": "#000000", "font_size": 34, "align": "left" },
  "card-10": { "photo_box": { "x": 468, "y": 540, "w": 612, "h": 720 }, "text_box": { "x": 55,  "y": 1110, "w": 400, "h": 85 },  "text_color": "#FFFFFF", "font_size": 34, "align": "left" },
  "card-11": { "photo_box": { "x": 468, "y": 540, "w": 612, "h": 720 }, "text_box": { "x": 55,  "y": 1110, "w": 400, "h": 85 },  "text_color": "#FFFFFF", "font_size": 34, "align": "left" },
  "card-15": { "photo_box": { "x": 0,   "y": 540, "w": 628, "h": 720 }, "text_box": { "x": 690, "y": 1080, "w": 340, "h": 85 },  "text_color": "#E44D30", "font_size": 34, "align": "right" }
}
```

- [ ] **Step 2: Write the failing placements tests**

`server/tests/test_placements.py`:
```python
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
```

- [ ] **Step 3: Run to verify failure**

Run: `pytest tests/test_placements.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.placements'`

- [ ] **Step 4: Implement placements.py**

`server/app/placements.py`:
```python
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
```

- [ ] **Step 5: Run placements tests**

Run: `pytest tests/test_placements.py -v`
Expected: 5 passed

- [ ] **Step 6: Write the check tool**

`server/tools/check_placements.py`:
```python
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
```

- [ ] **Step 7: Run the tool and eyeball the sheet**

Run: `python tools/check_placements.py`
Expected: `wrote 11 cards + contact-sheet.jpg to check-output`, exit code 0. The tool draws on the with-silhouette originals from `src/assets/templates/` (falling back to the clean card if one is missing) because the silhouette is the only visual reference for `photo_box`. Open `server/check-output/contact-sheet.jpg`: green boxes cover the silhouette (bottom-right on all but card-15, bottom-left on card-15); magenta boxes wrap "-Your name / constituency, State" on every card.

Review note (2026-09-12): after code review, `load_placements` also validates bounds, hex colour, integer coordinates and font size at load time with the template id in the error, the tool prints problems before rendering and skips the sheet when nothing rendered, and `tests/test_check_placements.py` covers the tool's exit codes.

- [ ] **Step 8: Commit**

```bash
cd /d/ai-shubhkamna
git add server/templates/placements.json server/app/placements.py server/tools/check_placements.py server/tests/test_placements.py
git commit -m "feat(server): add measured template placements, loader, and check tool"
```

---

### Task 3: Font asset

**Files:**
- Create: `server/app/fonts/Poppins-SemiBold.ttf`, `server/app/fonts/OFL.txt`

Poppins (SIL Open Font License) is the stand-in for the brand font until design supplies one. Downloading a file needs the user's OK; the plan author asked for it when handing over this plan.

- [ ] **Step 1: Download the font and licence**

```bash
cd /d/ai-shubhkamna/server
mkdir -p app/fonts
curl -sL -o app/fonts/Poppins-SemiBold.ttf "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-SemiBold.ttf"
curl -sL -o app/fonts/OFL.txt "https://github.com/google/fonts/raw/main/ofl/poppins/OFL.txt"
ls -la app/fonts
```
Expected: `Poppins-SemiBold.ttf` roughly 150 KB, `OFL.txt` roughly 4 KB.

- [ ] **Step 2: Verify Pillow can load it**

```bash
python -c "from PIL import ImageFont; f=ImageFont.truetype('app/fonts/Poppins-SemiBold.ttf', 34); print(f.getname())"
```
Expected: `('Poppins', 'SemiBold')`

- [ ] **Step 3: Commit**

```bash
cd /d/ai-shubhkamna
git add server/app/fonts
git commit -m "chore(server): bundle Poppins SemiBold (OFL) for the name line"
```

---

### Task 4: Pipeline — decode, crop, fit

**Files:**
- Create: `server/app/pipeline.py`, `server/tests/test_pipeline.py`, `server/tests/conftest.py`

- [ ] **Step 1: Write shared fixtures**

`server/tests/conftest.py` already exists (Task 1 review fix) with `make_settings`. Append the following (add the new imports at the top alongside the existing ones):
```python
import io

import pytest
from PIL import Image, ImageDraw


def make_photo_bytes(width: int = 600, height: int = 800, fmt: str = "JPEG") -> bytes:
    """A gradient photo with a solid figure in the middle; enough for the fake remover to 'find'."""
    img = Image.new("RGB", (width, height), (40, 90, 200))
    draw = ImageDraw.Draw(img)
    draw.rectangle((width * 0.3, height * 0.2, width * 0.7, height), fill=(230, 200, 180))
    buf = io.BytesIO()
    img.save(buf, fmt)
    return buf.getvalue()


def fake_remover(img: Image.Image) -> Image.Image:
    """Stand-in for rembg: keeps the centre 40 % width x 80 % height opaque, everything else transparent."""
    width, height = img.size
    rgba = img.convert("RGBA")
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rectangle((width * 0.3, height * 0.2, width * 0.7 - 1, height - 1), fill=255)
    rgba.putalpha(mask)
    return rgba


def empty_remover(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    rgba.putalpha(Image.new("L", img.size, 0))
    return rgba


@pytest.fixture
def photo_bytes() -> bytes:
    return make_photo_bytes()
```

- [ ] **Step 2: Write failing tests for decode / crop / fit**

`server/tests/test_pipeline.py`:
```python
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
```

- [ ] **Step 3: Run to verify failure**

Run: `pytest tests/test_pipeline.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.pipeline'`

- [ ] **Step 4: Implement decode / crop / fit**

`server/app/pipeline.py` (first half; text and compose are added in Task 5):
```python
"""Pure image functions. No I/O except reading the template file in compose()."""
from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

from .placements import Box, Placement
from .remover import Remover

MAX_SIDE = 2000
ALPHA_THRESHOLD = 8
FONT_PATH = Path(__file__).resolve().parent / "fonts" / "Poppins-SemiBold.ttf"
LINE_HEIGHT_FACTOR = 1.25


class BadImageError(ValueError):
    """The upload could not be decoded as an image."""


class NoSubjectError(ValueError):
    """Background removal left nothing opaque."""


@dataclass(frozen=True)
class TextFields:
    name: str = ""
    constituency: str = ""
    state: str = ""


def decode_photo(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:  # Pillow raises several unrelated types
        raise BadImageError("Could not decode image") from exc
    img = ImageOps.exif_transpose(img)
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    return img.convert("RGB")


def crop_to_subject(rgba: Image.Image) -> Image.Image:
    alpha = rgba.getchannel("A").point(lambda a: 255 if a > ALPHA_THRESHOLD else 0)
    bbox = alpha.getbbox()
    if bbox is None:
        raise NoSubjectError("No person detected in photo")
    return rgba.crop(bbox)


def fit_bottom_center(size: tuple[int, int], box: Box) -> tuple[int, int, int, int]:
    """(x, y, w, h) that contains `size` inside `box`, centred horizontally, anchored to the bottom."""
    width, height = size
    scale = min(box.w / width, box.h / height)
    fitted_w = max(1, round(width * scale))
    fitted_h = max(1, round(height * scale))
    x = box.x + (box.w - fitted_w) // 2
    y = box.bottom - fitted_h
    return x, y, fitted_w, fitted_h
```

- [ ] **Step 5: Run pipeline tests**

Run: `pytest tests/test_pipeline.py -v`
Expected: 7 passed

- [ ] **Step 6: Commit**

```bash
cd /d/ai-shubhkamna
git add server/app/pipeline.py server/tests/conftest.py server/tests/test_pipeline.py
git commit -m "feat(server): photo decode, subject crop, and fit maths"
```

Review note (2026-09-12): after code review, `decode_photo` gained a `MAX_PIXELS = 50_000_000` cap checked before `load()`, a `draft("RGB", (MAX_SIDE, MAX_SIDE))` call so JPEGs decode downscaled, and the whole decode path sits inside the `try` so any Pillow failure becomes `BadImageError`; `crop_to_subject` converts non-RGBA input; `fit_bottom_center` returns a `Box` instead of a tuple (Task 5's `compose` uses `fitted.x/.y/.w/.h`).

---

### Task 5: Pipeline — text block and compose

**Files:**
- Modify: `server/app/pipeline.py`
- Modify: `server/tests/test_pipeline.py`

- [ ] **Step 1: Add failing tests for text and compose**

Append to `server/tests/test_pipeline.py`:
```python
from app.pipeline import TextFields, compose, draw_text_block, text_lines
from app.placements import Placement, load_placements


def test_text_lines_skips_blank_fields():
    assert text_lines(TextFields()) == []
    assert text_lines(TextFields(name=" Rajiv ")) == ["-Rajiv"]
    assert text_lines(TextFields(name="Rajiv", state="Bihar")) == ["-Rajiv", "Bihar"]
    assert text_lines(TextFields(name="Rajiv", constituency="Patna Sahib", state="Bihar")) == [
        "-Rajiv",
        "Patna Sahib, Bihar",
    ]


def _placement_for(card: Image.Image) -> Placement:
    return Placement(
        template_id="synthetic",
        photo_box=Box(x=100, y=100, w=100, h=100),
        text_box=Box(x=20, y=20, w=160, h=60),
        text_color="#FF0000",
        font_size=24,
        align="left",
    )


def test_draw_text_block_covers_placeholder_and_draws_text_color():
    card = Image.new("RGB", (300, 300), (30, 60, 200))
    ImageDraw.Draw(card).text((25, 25), "-Your name", fill=(255, 255, 255))  # fake placeholder
    placement = _placement_for(card)

    draw_text_block(card, placement, TextFields())
    box_pixels = set(card.crop((20, 20, 180, 80)).getdata())
    assert box_pixels == {(30, 60, 200)}, "empty fields must still wipe the placeholder"

    draw_text_block(card, placement, TextFields(name="Rajiv"))
    assert (255, 0, 0) in set(card.crop((20, 20, 180, 80)).getdata())


def test_draw_text_block_right_aligns_when_requested():
    card = Image.new("RGB", (300, 300), (255, 255, 255))
    placement = Placement("synthetic", Box(0, 0, 10, 10), Box(20, 20, 160, 60), "#000000", 24, "right")
    draw_text_block(card, placement, TextFields(name="Ab"))
    cols_with_ink = [x for x in range(20, 180) if any(card.getpixel((x, y)) != (255, 255, 255) for y in range(20, 80))]
    assert cols_with_ink, "expected some text ink"
    assert min(cols_with_ink) > 100, "short right-aligned text should sit in the right half of the box"


def test_draw_text_block_truncates_long_lines_with_ellipsis():
    card = Image.new("RGB", (300, 300), (255, 255, 255))
    placement = Placement("synthetic", Box(0, 0, 10, 10), Box(20, 20, 160, 60), "#000000", 24, "left")
    draw_text_block(card, placement, TextFields(name="A" * 200))
    assert all(card.getpixel((x, 40)) == (255, 255, 255) for x in range(181, 300)), "ink must stay inside the box"


def test_compose_end_to_end_produces_a_jpeg_of_card_size(photo_bytes):
    placement = load_placements()["card-2"]
    out = compose(photo_bytes, placement, TextFields(name="Rajiv", constituency="Patna", state="Bihar"), fake_remover)
    img = Image.open(io.BytesIO(out))
    assert img.format == "JPEG"
    assert img.size == (1080, 1260)


def test_compose_pastes_cutout_inside_photo_box(photo_bytes):
    placement = load_placements()["card-15"]
    out = compose(photo_bytes, placement, TextFields(), fake_remover)
    img = Image.open(io.BytesIO(out)).convert("RGB")
    pb = placement.photo_box
    # fake cutout is a flat (230,200,180)-ish rectangle; sample its centre-bottom
    cx, cy = pb.x + pb.w // 2, pb.bottom - 10
    r, g, b = img.getpixel((cx, cy))
    assert abs(r - 230) < 20 and abs(g - 200) < 20 and abs(b - 180) < 20


def test_compose_raises_no_subject_when_remover_returns_transparent(photo_bytes):
    placement = load_placements()["card-1"]
    with pytest.raises(NoSubjectError):
        compose(photo_bytes, placement, TextFields(), empty_remover)
```

Also add `from PIL import ImageDraw` to the imports at the top of the test file.

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_pipeline.py -v`
Expected: FAIL with `ImportError: cannot import name 'TextFields'`… (actually `TextFields` exists; failure is `cannot import name 'compose'`)

- [ ] **Step 3: Implement text and compose**

Append to `server/app/pipeline.py`:
```python
def text_lines(fields: TextFields) -> list[str]:
    lines: list[str] = []
    if fields.name.strip():
        lines.append(f"-{fields.name.strip()}")
    location = ", ".join(part.strip() for part in (fields.constituency, fields.state) if part.strip())
    if location:
        lines.append(location)
    return lines


def _load_font(path: Path, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if path.is_file():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size)  # keeps tests runnable before the font is vendored


def _truncate(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> str:
    if draw.textlength(text, font=font) <= max_width:
        return text
    while text and draw.textlength(text + "…", font=font) > max_width:
        text = text[:-1]
    return text + "…"


def draw_text_block(card: Image.Image, placement: Placement, fields: TextFields, font_path: Path = FONT_PATH) -> None:
    """Wipe the placeholder text with the sampled background and draw the user's lines."""
    tb = placement.text_box
    background = card.getpixel((max(tb.x - 4, 0), tb.y))
    draw = ImageDraw.Draw(card)
    draw.rectangle((tb.x, tb.y, tb.right - 1, tb.bottom - 1), fill=background)
    font = _load_font(font_path, placement.font_size)
    line_height = round(placement.font_size * LINE_HEIGHT_FACTOR)
    y = tb.y
    for line in text_lines(fields):
        line = _truncate(draw, line, font, tb.w)
        x = tb.right - draw.textlength(line, font=font) if placement.align == "right" else tb.x
        draw.text((x, y), line, font=font, fill=placement.text_color)
        y += line_height


def compose(
    photo_bytes: bytes,
    placement: Placement,
    fields: TextFields,
    remover: Remover,
    font_path: Path = FONT_PATH,
) -> bytes:
    """Full pipeline: returns JPEG bytes of the finished card."""
    photo = decode_photo(photo_bytes)
    cutout = crop_to_subject(remover(photo))
    card = Image.open(placement.template_path).convert("RGB")
    draw_text_block(card, placement, fields, font_path)  # text first so the cutout can overlap it like the design
    fitted = fit_bottom_center(cutout.size, placement.photo_box)
    cutout = cutout.resize((fitted.w, fitted.h), Image.LANCZOS)
    card.paste(cutout, (fitted.x, fitted.y), cutout)
    buffer = io.BytesIO()
    card.save(buffer, "JPEG", quality=90)
    return buffer.getvalue()
```

- [ ] **Step 4: Run pipeline tests**

Run: `pytest tests/test_pipeline.py -v`
Expected: 14 passed

- [ ] **Step 5: Render one real card and look at it**

```bash
python - <<'EOF'
from pathlib import Path
from app.pipeline import compose, TextFields
from app.placements import load_placements
from tests.conftest import make_photo_bytes, fake_remover
out = compose(make_photo_bytes(600, 800), load_placements()["card-2"], TextFields("Rajiv Ranjan", "Gautam Buddha Nagar", "Uttar Pradesh"), fake_remover)
Path("check-output").mkdir(exist_ok=True)
Path("check-output/sample-card-2.jpg").write_bytes(out)
print("wrote check-output/sample-card-2.jpg")
EOF
```
Open `server/check-output/sample-card-2.jpg`: the blue block reads "-Rajiv Ranjan / Gautam Buddha Nagar, Uttar Pradesh" in white where the placeholder was, and a flat beige rectangle sits bottom-right where the silhouette used to be.

- [ ] **Step 6: Commit**

```bash
cd /d/ai-shubhkamna
git add server/app/pipeline.py server/tests/test_pipeline.py
git commit -m "feat(server): name-line rendering and full compose pipeline"
```

---

### Task 6: Storage — S3 uploader and in-memory stub

**Files:**
- Create: `server/app/storage.py`, `server/tests/test_storage.py`

- [ ] **Step 1: Write failing storage tests**

`server/tests/test_storage.py`:
```python
import pytest
from botocore.exceptions import ClientError

from app.storage import MemoryUploader, S3Uploader, UploadError


class FakeS3Client:
    def __init__(self, fail: bool = False):
        self.calls = []
        self.fail = fail

    def put_object(self, **kwargs):
        if self.fail:
            raise ClientError({"Error": {"Code": "AccessDenied", "Message": "nope"}}, "PutObject")
        self.calls.append(kwargs)


def test_s3_uploader_puts_jpeg_and_returns_public_url():
    client = FakeS3Client()
    uploader = S3Uploader(bucket="cards", region="ap-south-1", prefix="ai-shubh", client=client)
    url = uploader.upload_jpeg(b"jpegbytes")
    assert len(client.calls) == 1
    call = client.calls[0]
    assert call["Bucket"] == "cards"
    assert call["Key"].startswith("ai-shubh/") and call["Key"].endswith(".jpg")
    assert call["Body"] == b"jpegbytes"
    assert call["ContentType"] == "image/jpeg"
    assert "ACL" not in call
    assert url == f"https://cards.s3.ap-south-1.amazonaws.com/{call['Key']}"


def test_s3_uploader_sets_public_read_acl_when_enabled():
    client = FakeS3Client()
    uploader = S3Uploader(bucket="cards", region="ap-south-1", prefix="", public_read_acl=True, client=client)
    uploader.upload_jpeg(b"x")
    call = client.calls[0]
    assert call["ACL"] == "public-read"
    assert "/" not in call["Key"], "empty prefix must not produce a leading slash"


def test_s3_uploader_wraps_client_errors():
    uploader = S3Uploader(bucket="cards", region="ap-south-1", prefix="p", client=FakeS3Client(fail=True))
    with pytest.raises(UploadError):
        uploader.upload_jpeg(b"x")


def test_memory_uploader_stores_bytes_and_returns_unique_urls():
    uploader = MemoryUploader()
    a = uploader.upload_jpeg(b"a")
    b = uploader.upload_jpeg(b"b")
    assert a != b
    assert set(uploader.objects.values()) == {b"a", b"b"}
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_storage.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.storage'`

- [ ] **Step 3: Implement storage.py**

`server/app/storage.py`:
```python
"""Where finished cards go. S3 in production, memory in tests."""
from __future__ import annotations

import uuid
from typing import Any, Protocol

import boto3
from botocore.exceptions import BotoCoreError, ClientError


class UploadError(RuntimeError):
    """The object store rejected the upload."""


class Uploader(Protocol):
    def upload_jpeg(self, data: bytes) -> str:  # returns a public URL
        ...


class S3Uploader:
    def __init__(
        self,
        bucket: str,
        region: str,
        prefix: str = "ai-shubh",
        public_read_acl: bool = False,
        client: Any | None = None,
    ) -> None:
        self.bucket = bucket
        self.region = region
        self.prefix = prefix.strip("/")
        self.public_read_acl = public_read_acl
        self.client = client or boto3.client("s3", region_name=region)

    def upload_jpeg(self, data: bytes) -> str:
        name = f"{uuid.uuid4().hex}.jpg"
        key = f"{self.prefix}/{name}" if self.prefix else name
        extra: dict[str, Any] = {"ContentType": "image/jpeg"}
        if self.public_read_acl:
            extra["ACL"] = "public-read"
        try:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=data, **extra)
        except (BotoCoreError, ClientError) as exc:
            raise UploadError(str(exc)) from exc
        return f"https://{self.bucket}.s3.{self.region}.amazonaws.com/{key}"


class MemoryUploader:
    """Test double: keeps uploads in a dict."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def upload_jpeg(self, data: bytes) -> str:
        key = f"mem/{uuid.uuid4().hex}.jpg"
        self.objects[key] = data
        return f"https://example.test/{key}"
```

- [ ] **Step 4: Run storage tests**

Run: `pytest tests/test_storage.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
cd /d/ai-shubhkamna
git add server/app/storage.py server/tests/test_storage.py
git commit -m "feat(server): S3 uploader with in-memory test double"
```

---

### Task 7: `POST /composite` endpoint with guards

**Files:**
- Modify: `server/app/main.py`
- Create: `server/tests/test_api.py`
- Modify: `server/tests/conftest.py`

- [ ] **Step 1: Add an app fixture to conftest**

`server/tests/conftest.py` already has `make_settings(**overrides)` (added in the Task 1 review fix; it uses `dataclasses.replace(load_settings(env={}), allowed_origins=["https://app.example"], **overrides)`). Append:
```python
from fastapi.testclient import TestClient

from app.main import create_app
from app.storage import MemoryUploader


@pytest.fixture
def uploader() -> MemoryUploader:
    return MemoryUploader()


@pytest.fixture
def client(uploader):
    app = create_app(settings=make_settings(rate_limit_per_minute=100), remover=fake_remover, uploader=uploader)
    with TestClient(app) as test_client:
        yield test_client
```

- [ ] **Step 2: Write failing API tests**

`server/tests/test_api.py`:
```python
from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import empty_remover, fake_remover, make_photo_bytes, make_settings

AUTH = {"Authorization": "Bearer test-token"}


def _post(client, photo=None, template="card-2", headers=AUTH, **fields):
    photo = make_photo_bytes() if photo is None else photo
    data = {"template": template, **fields}
    return client.post("/composite", data=data, files={"photo": ("p.jpg", photo, "image/jpeg")}, headers=headers)


def test_happy_path_returns_image_url_and_uploads_jpeg(client, uploader):
    response = _post(client, name="Rajiv", constituency="Patna", state="Bihar")
    assert response.status_code == 200, response.text
    url = response.json()["imageUrl"]
    assert url.startswith("https://example.test/mem/")
    assert len(uploader.objects) == 1
    assert next(iter(uploader.objects.values()))[:3] == b"\xff\xd8\xff"  # JPEG magic


def test_profile_fields_are_optional(client):
    assert _post(client).status_code == 200


def test_missing_bearer_is_401(client):
    assert _post(client, headers={}).status_code == 401
    assert _post(client, headers={"Authorization": "Bearer "}).status_code == 401
    assert _post(client, headers={"Authorization": "Basic abc"}).status_code == 401


def test_unknown_template_is_400(client):
    response = _post(client, template="card-7")
    assert response.status_code == 400
    assert "card-7" in response.json()["detail"]


def test_wrong_content_type_is_415(client):
    response = client.post(
        "/composite",
        data={"template": "card-2"},
        files={"photo": ("p.txt", b"hello", "text/plain")},
        headers=AUTH,
    )
    assert response.status_code == 415


def test_undecodable_image_is_415(client):
    response = _post(client, photo=b"not really a jpeg")
    assert response.status_code == 415


def test_oversized_upload_is_413(uploader):
    app = create_app(settings=make_settings(max_upload_bytes=1000), remover=fake_remover, uploader=uploader)
    with TestClient(app) as client:
        response = _post(client, photo=make_photo_bytes(800, 800))
    assert response.status_code == 413


def test_no_subject_is_422(uploader):
    app = create_app(settings=make_settings(), remover=empty_remover, uploader=uploader)
    with TestClient(app) as client:
        response = _post(client)
    assert response.status_code == 422


def test_upload_failure_is_502():
    class FailingUploader:
        def upload_jpeg(self, data):
            from app.storage import UploadError

            raise UploadError("s3 down")

    app = create_app(settings=make_settings(), remover=fake_remover, uploader=FailingUploader())
    with TestClient(app) as client:
        response = _post(client)
    assert response.status_code == 502


def test_rate_limit_is_429_after_limit(uploader):
    app = create_app(settings=make_settings(rate_limit_per_minute=2), remover=fake_remover, uploader=uploader)
    with TestClient(app) as client:
        assert _post(client).status_code == 200
        assert _post(client).status_code == 200
        assert _post(client).status_code == 429


def test_jwt_validation_hook_rejects_on_false(uploader):
    async def always_reject(token: str) -> bool:
        return False

    app = create_app(
        settings=make_settings(jwt_validate_url="https://api.example/validate"),
        remover=fake_remover,
        uploader=uploader,
        token_validator=always_reject,
    )
    with TestClient(app) as client:
        assert _post(client).status_code == 401


def test_jwt_validation_hook_allows_on_true(uploader):
    seen = []

    async def accept(token: str) -> bool:
        seen.append(token)
        return True

    app = create_app(
        settings=make_settings(jwt_validate_url="https://api.example/validate"),
        remover=fake_remover,
        uploader=uploader,
        token_validator=accept,
    )
    with TestClient(app) as client:
        assert _post(client).status_code == 200
    assert seen == ["test-token"]


def test_cors_preflight_allows_configured_origin_only(client):
    ok = client.options(
        "/composite",
        headers={"Origin": "https://app.example", "Access-Control-Request-Method": "POST"},
    )
    assert ok.headers.get("access-control-allow-origin") == "https://app.example"
    bad = client.options(
        "/composite",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in bad.headers
```

- [ ] **Step 3: Run to verify failure**

Run: `pytest tests/test_api.py -v`
Expected: FAIL — most tests 404 (`/composite` missing), the validator tests fail with `TypeError: create_app() got an unexpected keyword argument 'token_validator'`

- [ ] **Step 4: Implement the endpoint**

Replace `server/app/main.py` with:
```python
"""FastAPI wiring. Business logic lives in pipeline.py / storage.py."""
from __future__ import annotations

import hashlib
import logging
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import httpx
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from .config import Settings, load_settings
from .pipeline import BadImageError, NoSubjectError, TextFields, compose
from .placements import Placement, load_placements
from .remover import Remover, make_remover
from .storage import S3Uploader, UploadError, Uploader

log = logging.getLogger("ai-shubh")

TokenValidator = Callable[[str], Awaitable[bool]]

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


@dataclass
class Runtime:
    """Heavy objects built once per process (in lifespan) or injected by tests."""

    remover: Remover | None = None
    uploader: Uploader | None = None


def make_token_validator(validate_url: str) -> TokenValidator:
    """GET validate_url with the bearer; any non-200 or network problem counts as invalid."""

    async def _validate(token: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as http:
                response = await http.get(validate_url, headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError as exc:
            log.warning("token validation call failed: %s", exc)
            return False
        return response.status_code == 200

    return _validate


def _bearer(authorization: str) -> str:
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


def create_app(
    settings: Settings | None = None,
    remover: Remover | None = None,
    uploader: Uploader | None = None,
    token_validator: TokenValidator | None = None,
    placements: dict[str, Placement] | None = None,
) -> FastAPI:
    """App factory. Run with `uvicorn app.main:create_app --factory`."""
    settings = settings if settings is not None else load_settings()
    placements = placements if placements is not None else load_placements()
    runtime = Runtime(remover=remover, uploader=uploader)
    if token_validator is None and settings.jwt_validate_url:
        token_validator = make_token_validator(settings.jwt_validate_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
        if runtime.remover is None:
            runtime.remover = make_remover(settings.model_name)
        if runtime.uploader is None:
            runtime.uploader = S3Uploader(
                bucket=settings.s3_bucket,
                region=settings.aws_region,
                prefix=settings.s3_prefix,
                public_read_acl=settings.s3_public_read_acl,
            )
        yield

    app = FastAPI(title="AI Shubhkamna compositing", lifespan=lifespan)

    limiter = Limiter(key_func=get_remote_address)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "model_loaded": runtime.remover is not None,
            "uploader_ready": runtime.uploader is not None,
        }

    @app.post("/composite")
    @limiter.limit(f"{settings.rate_limit_per_minute}/minute")
    async def composite(
        request: Request,
        photo: UploadFile = File(...),
        template: str = Form(...),
        name: str = Form(""),
        constituency: str = Form(""),
        state: str = Form(""),
        authorization: str = Header(""),
    ) -> dict[str, str]:
        token = _bearer(authorization)
        if not token:
            raise HTTPException(status_code=401, detail="Missing bearer token")
        if token_validator is not None and not await token_validator(token):
            raise HTTPException(status_code=401, detail="Invalid token")

        placement = placements.get(template)
        if placement is None:
            raise HTTPException(status_code=400, detail=f"Unknown template '{template}'")
        if photo.content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(status_code=415, detail="Unsupported image type")

        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > settings.max_upload_bytes + 64 * 1024:
            raise HTTPException(status_code=413, detail="Photo larger than 10 MB")
        data = await photo.read(settings.max_upload_bytes + 1)
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(status_code=413, detail="Photo larger than 10 MB")

        assert runtime.remover is not None and runtime.uploader is not None  # set in lifespan
        request_id = uuid.uuid4().hex[:8]
        log.info(
            "composite req=%s template=%s jwt=%s bytes=%d",
            request_id,
            template,
            hashlib.sha256(token.encode()).hexdigest()[:12],
            len(data),
        )

        try:
            jpeg = await run_in_threadpool(
                compose, data, placement, TextFields(name=name, constituency=constituency, state=state), runtime.remover
            )
        except BadImageError as exc:
            raise HTTPException(status_code=415, detail=str(exc)) from exc
        except NoSubjectError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        try:
            url = await run_in_threadpool(runtime.uploader.upload_jpeg, jpeg)
        except UploadError as exc:
            log.error("composite req=%s upload failed: %s", request_id, exc)
            raise HTTPException(status_code=502, detail="Upload failed") from exc

        return {"imageUrl": url}

    return app
```

- [ ] **Step 5: Run the whole suite**

Run: `pytest -v`
Expected: all pass (2 config + 3 health + 5 placements + 14 pipeline + 4 storage + 13 api = 41). Note `test_health.py` (from the Task 1 review fix) asserts `{"status": "ok", "model_loaded": True}` exactly; update that assertion to include `"uploader_ready": False` now that health reports the uploader too.

- [ ] **Step 6: Commit**

```bash
cd /d/ai-shubhkamna
git add server/app/main.py server/tests/conftest.py server/tests/test_api.py
git commit -m "feat(server): POST /composite with bearer check, limits, rate limiting, and CORS"
```

---

### Task 8: Dockerfile, README, local smoke run

**Files:**
- Create: `server/Dockerfile`, `server/.dockerignore`, `server/README.md`

- [ ] **Step 1: Write the Dockerfile**

`server/Dockerfile`:
```dockerfile
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    U2NET_HOME=/models

WORKDIR /srv

RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the model weights into the image so a cold container never downloads at request time.
RUN python -c "from rembg import new_session; new_session('isnet-general-use')"

COPY app ./app
COPY templates ./templates

EXPOSE 8000
CMD uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips="*"
```

`server/.dockerignore`:
```
.venv
.env
.pytest_cache
__pycache__
check-output
tests
tools
```

- [ ] **Step 2: Write the README**

`server/README.md`:
```markdown
# AI Shubhkamna compositing service

Removes the background from a user photo, composites it onto the clean card template,
renders the name line, uploads to S3, and returns the URL. Spec:
`docs/superpowers/specs/2026-09-12-background-removal-compositing-design.md`.

## API

`POST /composite` (multipart) — fields `photo` (file), `template` (e.g. `card-2`), optional
`name`, `constituency`, `state`; header `Authorization: Bearer <jwt>`.
Returns `{ "imageUrl": "https://<bucket>.s3.<region>.amazonaws.com/<prefix>/<uuid>.jpg" }`.
Errors: 400 bad template, 401 missing/invalid token, 413 too large, 415 bad image,
422 no person found, 429 rate limited, 502 upload failed.

`GET /health` → `{ "status": "ok", "model_loaded": true }`.

## Local

    python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash
    pip install -r requirements-dev.txt
    pytest
    cp .env.example .env   # fill AWS + bucket values
    set -a; source .env; set +a
    uvicorn app.main:create_app --factory --reload --port 8000

First start downloads the ISNet model (~170 MB) into `~/.u2net/`.

## Template geometry

`templates/placements.json` holds hand-measured boxes per template id. After editing it, run
`python tools/check_placements.py` and inspect `check-output/contact-sheet.jpg`.
Template ids must match `src/data/templates.ts`; `tests/test_placements.py` enforces this.

## Railway

- New service from this repo, **Root Directory** = `server`, builder = Dockerfile.
- Health check path `/health`. Size the service at 2 GB memory (ISNet needs ~1 GB RSS).
- Variables: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`,
  `S3_PREFIX` (default `ai-shubh`), `S3_PUBLIC_READ_ACL` (default `false`),
  `ALLOWED_ORIGINS` (comma-separated), `RATE_LIMIT_PER_MINUTE` (default `10`),
  optional `JWT_VALIDATE_URL`.
- Point the frontend at it: `VITE_COMPOSITE_URL=https://<app>.up.railway.app/composite`,
  `VITE_USE_MOCK_COMPOSITE=false`.
```

- [ ] **Step 3: Smoke-run the real service locally against the memory uploader**

This is the only step that loads the real model. It proves rembg + the pipeline work together.

```bash
cd /d/ai-shubhkamna/server
python - <<'EOF'
import io, sys
from pathlib import Path
from PIL import Image
from app.remover import make_remover
from app.pipeline import compose, TextFields
from app.placements import load_placements
remover = make_remover("isnet-general-use")   # downloads model on first run
photo = Path("../src/assets/templates/pm-birthday-AI-Shubhkamna-card-4.jpg").read_bytes()  # has a real person on a flat background
out = compose(photo, load_placements()["card-2"], TextFields("Rajiv Ranjan", "Gautam Buddha Nagar", "Uttar Pradesh"), remover)
Path("check-output").mkdir(exist_ok=True)
Path("check-output/smoke-real-model.jpg").write_bytes(out)
print("ok", len(out), "bytes")
EOF
```
Expected: prints `ok <n> bytes`. Open `server/check-output/smoke-real-model.jpg`: the figure from card-4 appears cut out (no cream/yellow background) bottom-right of card-2, and the name line reads correctly.

- [ ] **Step 4: Commit**

```bash
cd /d/ai-shubhkamna
git add server/Dockerfile server/.dockerignore server/README.md
git commit -m "feat(server): Dockerfile for Railway and README"
```

---

### Task 9: Frontend — real compositing path sends profile fields and bearer

**Files:**
- Modify: `src/services/composite.ts`
- Modify: `src/services/composite.test.ts`

- [ ] **Step 1: Update the test for the real path**

In `src/services/composite.test.ts`, change `PARAMS` to include a jwt and replace the "posts to the compositing endpoint" test:

```ts
const PARAMS = {
  photo: new Blob(['photo-bytes'], { type: 'image/jpeg' }),
  templateId: 'card-1',
  templateImageUrl: 'data:image/jpeg;base64,template',
  profile: PROFILE,
  jwt: 'test-jwt',
};
```

```ts
  it('posts multipart fields with a bearer header and returns the image url when useMock is false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ imageUrl: 'https://cards.s3.ap-south-1.amazonaws.com/ai-shubh/abc.jpg' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await compositePhoto(PARAMS, { useMock: false });

    expect(result.imageUrl).toBe('https://cards.s3.ap-south-1.amazonaws.com/ai-shubh/abc.jpg');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-jwt');
    const form = init.body as FormData;
    expect(form.get('template')).toBe('card-1');
    expect(form.get('name')).toBe('Rajiv Ranjan');
    expect(form.get('constituency')).toBe('Gautam Buddha Nagar');
    expect(form.get('state')).toBe('Uttar Pradesh');
    expect(form.get('photo')).toBeInstanceOf(Blob);
  });
```

- [ ] **Step 2: Run to verify failure**

Run (from `D:\ai-shubhkamna`): `npx vitest run src/services/composite.test.ts`
Expected: FAIL — `Authorization` is `undefined` and `form.get('name')` is `null`

- [ ] **Step 3: Update composite.ts**

Replace the `CompositeParams` type and `realCompositePhoto` in `src/services/composite.ts`:

```ts
type CompositeParams = {
  photo: Blob;
  templateId: string;
  templateImageUrl: string;
  profile: Profile;
  jwt: string;
};
```

```ts
// Real endpoint: server/README.md (POST /composite). Multipart fields + bearer header; returns { imageUrl }.
async function realCompositePhoto({ photo, templateId, profile, jwt }: CompositeParams): Promise<CompositeResult> {
  const form = new FormData();
  form.append('template', templateId);
  form.append('photo', photo, 'photo.jpg');
  form.append('name', profile.username);
  form.append('constituency', profile.constituency);
  form.append('state', profile.state);

  const response = await fetch(config.compositeUrl, {
    method: 'POST',
    body: form,
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) {
    throw new Error(`Compositing failed with status ${response.status}`);
  }
  const data = (await response.json()) as { imageUrl: string };
  return { imageUrl: data.imageUrl };
}
```

Delete the old "provisional pending the real contract" comment block above `compositePhoto`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/services/composite.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
cd /d/ai-shubhkamna
git add src/services/composite.ts src/services/composite.test.ts
git commit -m "feat: send profile fields and bearer token to the compositing service"
```

---

### Task 10: Frontend — Processing receives jwt, App passes it

**Files:**
- Modify: `src/steps/Processing.tsx`
- Modify: `src/steps/Processing.test.tsx`
- Modify: `src/App.tsx`
- Modify: `docs/superpowers/specs/2026-09-12-background-removal-compositing-design.md`

- [ ] **Step 1: Add a failing assertion to the Processing test**

In `src/steps/Processing.test.tsx`, add `jwt="test-jwt"` to every `<Processing … />` render (there are five), and extend the first test:

```ts
  it('calls onComposited once compositing succeeds', async () => {
    compositePhotoMock.mockResolvedValue({ imageBlob: new Blob(['x']) });
    const onComposited = vi.fn();
    render(
      <Processing jwt="test-jwt" photo={PHOTO} template={TEMPLATE} profile={PROFILE} onComposited={onComposited} onError={vi.fn()} />,
    );

    await waitFor(() => expect(onComposited).toHaveBeenCalledWith({ imageBlob: expect.any(Blob) }));
    expect(compositePhotoMock).toHaveBeenCalledWith(expect.objectContaining({ jwt: 'test-jwt', templateId: 'card-1' }));
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/steps/Processing.test.tsx`
Expected: FAIL — TypeScript/props error or `expect.objectContaining({ jwt: 'test-jwt' })` not matched

- [ ] **Step 3: Update Processing.tsx**

In `src/steps/Processing.tsx`:

```ts
type Props = {
  jwt: string;
  photo: Blob;
  template: Template;
  profile: Profile;
  onComposited: (result: CompositeResult) => void;
  onError: () => void;
};

export function Processing({ jwt, photo, template, profile, onComposited, onError }: Props) {
```

and in the effect:

```ts
    compositePhoto({
      photo,
      templateId: template.id,
      templateImageUrl: template.image,
      profile: latest.current.profile,
      jwt,
    })
```

Add `jwt` to the effect's dependency array: `}, [attempt, photo, template.id, template.image, jwt]);`

- [ ] **Step 4: Pass jwt from App**

In `src/App.tsx`, the `Processing` element becomes:

```tsx
      {step === 'processing' && photo && (
        <Processing
          jwt={jwt}
          photo={photo}
          template={selectedTemplate}
          profile={{ ...profile, username: name }}
          onComposited={(result) => {
            setComposited(result);
            setStep('preview');
          }}
          onError={() => setStep('landing')}
        />
      )}
```

- [ ] **Step 5: Run the full frontend suite and type check**

Run: `npx tsc -b && npx vitest run`
Expected: type check clean, 16 files / 60 tests passed (59 + the new composite assertion counts inside an existing test, so 59 or 60 depending on how you count; all green is what matters)

- [ ] **Step 6: Update the spec line**

In the spec's "Frontend changes" section replace:
`- `Processing.tsx`: read `jwt` via `useJwt()` and pass it into `compositePhoto`.`
with:
`- `Processing.tsx`: receives `jwt` as a prop from `App` (which already holds it) and passes it into `compositePhoto`.`

- [ ] **Step 7: Commit**

```bash
cd /d/ai-shubhkamna
git add src/steps/Processing.tsx src/steps/Processing.test.tsx src/App.tsx docs/superpowers/specs/2026-09-12-background-removal-compositing-design.md
git commit -m "feat: thread jwt through Processing to the compositing call"
```

---

### Task 11: Frontend — global font and env config

**Files:**
- Create: `src/index.css`
- Modify: `src/main.tsx`, `src/steps/Landing.css`, `.env.example`

- [ ] **Step 1: Create the global stylesheet**

`src/index.css`:
```css
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}

button,
input,
textarea {
  font-family: inherit;
}
```

- [ ] **Step 2: Import it and drop the Landing-only declaration**

In `src/main.tsx` add as the first import: `import './index.css';`

In `src/steps/Landing.css` delete the line `  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;` from the `.landing` rule.

- [ ] **Step 3: Update .env.example**

Replace the compositing lines in `.env.example`:
```
# Compositing service (server/README.md). Set VITE_USE_MOCK_COMPOSITE=true to use the local canvas mock instead.
VITE_COMPOSITE_URL=https://<railway-app>.up.railway.app/composite
VITE_USE_MOCK_COMPOSITE=false

# Profile endpoint is still not available - leave blank, mock is used.
VITE_PROFILE_URL=
VITE_USE_MOCK_PROFILE=true
```

- [ ] **Step 4: Verify tests and build**

Run: `npx vitest run && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 5: Visual check**

Start the dev server (`.claude/launch.json` config `ai-shubhkamna-dev` or `npm run dev`), open `http://localhost:5173/?jwt=x` in a mobile viewport, click Capture. The Tips screen and the exit dialog now use the same sans-serif as Landing.

- [ ] **Step 6: Commit**

```bash
cd /d/ai-shubhkamna
git add src/index.css src/main.tsx src/steps/Landing.css .env.example
git commit -m "fix: apply the app font globally; point env at the compositing service"
```

---

### Task 12: Deploy and end-to-end verification

No code. Needs the user for Railway variables and a real UAT JWT.

- [ ] **Step 1: Deploy to Railway**

In Railway: new service from this repo, Root Directory `server`, Dockerfile builder, health check `/health`, memory 2 GB. Set the variables listed in `server/README.md`. Wait for the build (model download happens during build, expect several minutes).

Verify: `curl https://<app>.up.railway.app/health` → `{"status":"ok","model_loaded":true}`

- [ ] **Step 2: Curl the endpoint directly**

```bash
curl -s -X POST "https://<app>.up.railway.app/composite" \
  -H "Authorization: Bearer test" \
  -F "template=card-2" -F "name=Rajiv Ranjan" -F "constituency=Gautam Buddha Nagar" -F "state=Uttar Pradesh" \
  -F "photo=@/d/ai-shubhkamna/src/assets/templates/pm-birthday-AI-Shubhkamna-card-4.jpg;type=image/jpeg"
```
Expected: `{"imageUrl":"https://<bucket>.s3.<region>.amazonaws.com/ai-shubh/<uuid>.jpg"}` and the URL opens in a browser showing the composited card.

- [ ] **Step 3: Frontend end-to-end**

In `.env.local` set `VITE_COMPOSITE_URL` to the Railway URL and `VITE_USE_MOCK_COMPOSITE=false`, restart the dev server, open `http://localhost:5173/?jwt=<real UAT jwt>` in a mobile viewport, Upload a portrait photo, confirm Preview shows the S3-hosted card with the background removed and the name line rendered, then Post and confirm the Media Wall redirect.

- [ ] **Step 4: Record the Railway URL**

Add the deployed URL to `server/README.md` under "Railway" and commit:
```bash
cd /d/ai-shubhkamna
git add server/README.md
git commit -m "docs(server): record Railway deployment URL"
```

---

## Self-review

**Spec coverage**
- API shape, fields, header, response, error table → Task 7 (400/401/413/415/422/429/502; 500 falls through FastAPI's default handler).
- Pipeline steps 1–7 → Tasks 4, 5 (text drawn before the paste, per the deviation noted in `compose`'s comment; the cutout is contained in `photo_box`, which never overlaps any `text_box`, so order only matters for placeholder coverage).
- Template data: hand-measured JSON, sampled block colour, check tool, 4/5 swap already committed → Task 2.
- Security: CORS, rate limit, bearer presence, hashed log, validation hook, body limit, secrets via env → Tasks 1, 7.
- Frontend: composite fields + header, Processing jwt, env, global font → Tasks 9, 10, 11.
- Deployment: Dockerfile, Railway, env table, memory sizing → Task 8, 12.
- Testing list → Tasks 1, 2, 4, 5, 6, 7, 9, 10; manual → Task 12.

**Placeholder scan** — none; every step has code or an exact command.

**Type consistency** — `Box(x,y,w,h)` with `.right/.bottom/.inside()`; `Placement(template_id, photo_box, text_box, text_color, font_size, align)`; `TextFields(name, constituency, state)`; `Remover = Callable[[Image], Image]` (in `remover.py`); `Runtime(remover, uploader)`; `create_app(settings, remover, uploader, token_validator, placements)` with no module-level `app` (uvicorn `--factory`); `Uploader.upload_jpeg(bytes) -> str`; frontend `CompositeParams.jwt`, `Processing` prop `jwt`. All consistent across tasks.
