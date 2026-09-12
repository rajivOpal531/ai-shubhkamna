# AI Shubhkamna compositing service

A small FastAPI service that takes a user's photo, cuts the subject out with a background-removal
model (rembg/ISNet), pastes it into one of a fixed set of birthday-card templates, draws the
supporter's name/constituency/state onto the card, and uploads the finished JPEG to S3. It backs
the "generate my card" flow in the AI Shubhkamna frontend. For the full design rationale (why
background removal instead of a simple photo frame, how templates are measured, error-handling
philosophy) see
[`docs/superpowers/specs/2026-09-12-background-removal-compositing-design.md`](../docs/superpowers/specs/2026-09-12-background-removal-compositing-design.md).

## API

### `POST /composite`

`multipart/form-data` body:

| Field          | Type   | Required | Notes                                                   |
| -------------- | ------ | -------- | -------------------------------------------------------- |
| `photo`        | file   | yes      | jpeg/png/webp, ≤ 10 MB                                    |
| `template`     | string | yes      | a template id from `templates/placements.json`           |
| `name`         | string | no       | ≤ 120 characters                                          |
| `constituency` | string | no       | ≤ 120 characters                                          |
| `state`        | string | no       | ≤ 120 characters                                          |

Header: `Authorization: Bearer <jwt>` (required).

Success response, `200 OK`:

```json
{ "imageUrl": "https://<bucket>.s3.<region>.amazonaws.com/<prefix>/<uuid>.jpg" }
```

Every response the route itself produces — the success response and every 4xx/5xx it raises
(400/401/413/415/422/500/502/503) — carries an `X-Request-Id` header: an 8-character hex id, also
logged server-side, that a caller can quote back in a support request. FastAPI's own `422` for a
missing or malformed field (raised before the route body runs) carries one too, minted by the
`RequestValidationError` handler in `app/main.py`. Only two responses have no request id at all:
the `429` from either rate limiter, and the body-limit middleware's own `413` for a request body
that's oversized before multipart parsing even starts — both answer before any id is minted. `CORSMiddleware` is configured with `expose_headers=["X-Request-Id"]`, so a browser
page calling this API cross-origin can read the header off the response (without that, browsers
hide all but a handful of default response headers from cross-origin JavaScript).

Error responses:

| Status | Cause                                                                 |
| ------ | ---------------------------------------------------------------------- |
| 400    | Unknown `template` id                                                  |
| 401    | Missing/malformed bearer token, or the JWT validator rejected it       |
| 413    | Request body or `photo` bigger than the configured limit               |
| 415    | Unsupported content type, or the photo bytes could not be decoded      |
| 422    | A text field is over 120 characters, no subject was found in the photo, or a required field/file is missing |
| 429    | Rate limited (per bearer token or per source IP — see "Rate limiting") |
| 500    | Unexpected server error; the detail message includes the request id    |
| 502    | The finished JPEG could not be uploaded to S3                          |
| 503    | The JWT validator is unreachable, the inference queue is overloaded, or the service is still starting (remover/uploader not built yet) |

### `GET /health`

```json
{ "status": "ok", "model_loaded": true, "uploader_ready": true }
```

`model_loaded`/`uploader_ready` are false only in the brief window before the lifespan finishes
building the rembg session and the S3 client (or if they were never injected in a test).

## Local development

```bash
cd server
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements-dev.txt
pytest
```

Running the app for real also needs the environment configured:

```bash
cp .env.example .env
# edit .env with real values, then load it into the shell:
set -a; source .env; set +a
uvicorn app.main:create_app --factory --reload --port 8000
```

The first start downloads the ISNet background-removal model (~170 MB) into `~/.u2net/` — expect a
pause before `/health` reports `model_loaded: true`. Subsequent starts reuse the cached weights.
`pytest` never triggers this download: tests inject a fake in-memory remover (see
`tests/conftest.py`) instead of loading rembg.

## Template geometry

`templates/placements.json` holds hand-measured pixel boxes (`photo_box`, `text_box`, font size,
alignment, text color) for each template, keyed by the same template id the frontend uses. Template
ids must match the ids in `src/data/templates.ts` one-to-one — `tests/test_placements.py` enforces
this and fails the suite if a template is added on one side and not the other.

After editing `placements.json`, regenerate the visual check:

```bash
python tools/check_placements.py
```

This draws the `photo_box` (green) and `text_box` (magenta) outlines onto each template and writes
`check-output/<template-id>.jpg` plus a combined `check-output/contact-sheet.jpg`; inspect the
contact sheet to confirm boxes line up with the card artwork before committing. It exits non-zero if
any box falls outside the 1080×1260 card or a template file is missing.

Note for anyone re-measuring templates: cards 4 and 5 in the stakeholder's original Dropbox set were
swapped, and picked up their (now-swapped) `card-4`/`card-5` ids only when they were renamed on
import into `src/assets/templates/`. Double-check against the actual artwork, not just the filename,
before trusting an id.

## Rate limiting

`POST /composite` stacks two independent limits — both must pass:

- **Per bearer token** (`RATE_LIMIT_PER_MINUTE`): keyed on a truncated SHA-256 hash of the bearer
  token (`rate_limit_key` in `app/main.py`). This is the budget that actually matters, but the token
  is unvalidated at this point, so it's rotatable by an attacker minting fresh tokens.
- **Per source IP** (`RATE_LIMIT_PER_IP_PER_MINUTE`): a backstop against exactly that rotation.
  The key is the **rightmost** entry of the `X-Forwarded-For` header (`client_ip_key` in
  `app/main.py`), falling back to the socket peer address when the header is absent. The rightmost
  entry is the one appended by the last hop before this service — trustworthy only when that hop is
  a proxy you control (e.g. Railway's edge) and the deployment is configured so a client cannot reach
  the app directly. The **leftmost** entry is whatever the client itself sent and must never be
  trusted for this purpose.

Both limiters' counters are per-process (in-memory) unless `RATE_LIMIT_STORAGE_URI` points at a
shared store (e.g. `redis://...`), in which case counts are shared across replicas.

Separately, `MAX_CONCURRENT_COMPOSITES` bounds how many background-removal inferences run at once
(an `anyio.CapacityLimiter`, since each ISNet inference needs roughly 1 GB RSS). Requests beyond that
concurrency queue rather than fail immediately, but once the queue depth reaches 4× the concurrency
limit the service sheds load with `503 Busy, retry shortly` instead of growing the queue further.

## Fonts and scripts

The name/constituency/state line is set in Poppins SemiBold (OFL-licensed), which is bundled at
`app/fonts/Poppins-SemiBold.ttf` and covers Devanagari as well as Latin. **That font file is not yet
vendored in this checkout** — it lands in a separate task. Until then, `pipeline._load_font` falls
back to Pillow's built-in default font so the pipeline and its tests keep working, just without the
intended typeface.

Correct shaping of Devanagari and other Indic scripts (conjunct consonants, matras positioned
correctly relative to the base glyph) requires HarfBuzz text shaping, which Pillow only gets through
`libraqm`. The Dockerfile installs `libraqm0`/`libfribidi0`/`libharfbuzz0b` and asserts
`PIL.features.check("raqm")` at build time — the image fails to build rather than silently rendering
misshapen text in production.

## Railway

Create a new Railway service from this repository:

- **Root Directory**: `server`
- **Builder**: Dockerfile (this repo's `server/Dockerfile`)
- **Health check path**: `/health`
- **Memory**: 2 GB (ISNet inference plus a couple of concurrent requests needs headroom beyond the
  ~1 GB per composite noted above)

The container drops to a non-root user (uid 10001) after the build steps, and its `CMD` is exec-form
with an explicit `exec`, so uvicorn runs as PID 1 and receives Railway's `SIGTERM` directly on
redeploy or shutdown rather than having it swallowed by a wrapper shell.

Environment variables to set on the Railway service. Everything down to `REMBG_MODEL` is read by
the app (`app/config.py`) or by boto3 directly (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`); the
last two are read by the container/image, not by `app/config.py`, and you should not need to set
them yourself:

| Variable                        | Purpose                                                                 |
| -------------------------------- | ------------------------------------------------------------------------ |
| `AWS_ACCESS_KEY_ID`               | S3 credentials                                                          |
| `AWS_SECRET_ACCESS_KEY`           | S3 credentials                                                          |
| `AWS_REGION`                      | Region the bucket lives in                                              |
| `S3_BUCKET`                       | Destination bucket; must be a lowercase, DNS-compatible name and must live in `AWS_REGION` |
| `S3_PREFIX`                       | Key prefix for uploaded cards (e.g. `ai-shubh`)                          |
| `S3_PUBLIC_READ_ACL`              | `true`/`false` — whether uploaded objects get a public-read ACL          |
| `ALLOWED_ORIGINS`                 | Comma-separated browser origins allowed to call this service            |
| `RATE_LIMIT_PER_MINUTE`           | Per-bearer-token limit for `POST /composite`                             |
| `RATE_LIMIT_PER_IP_PER_MINUTE`    | Per-source-IP limit; see "Rate limiting" above                          |
| `RATE_LIMIT_STORAGE_URI`          | Optional `redis://...` to share rate-limit counters across replicas      |
| `MAX_CONCURRENT_COMPOSITES`       | Concurrent background-removal jobs allowed                              |
| `JWT_VALIDATE_URL`                | Optional URL this service calls to validate the caller's bearer token    |
| `REMBG_MODEL`                     | rembg model name; `isnet-general-use` is the one baked into the image    |
| `PORT`                            | Set by Railway, not by you; the container listens on it (default `8000` if unset). Not read by `app/config.py`. |
| `U2NET_HOME`                      | Set in the Dockerfile to `/models`, where the ISNet weights are baked in at build time. Not read by `app/config.py` — it's how rembg finds the model without downloading it at runtime. Do not override. |

On the frontend, point the app at this deployment:

```
VITE_COMPOSITE_URL=https://<railway-app>.up.railway.app/composite
VITE_USE_MOCK_COMPOSITE=false
```

## Smoke test (real model)

The automated test suite always runs against a fake in-memory remover, so it never downloads or runs
the real ISNet model. To sanity-check the real model end to end, run this manually (not as part of
`pytest`, and not run by this README — it downloads ~170 MB of model weights on first use):

```python
from pathlib import Path

from app.pipeline import TextFields, compose
from app.placements import load_placements
from app.remover import make_remover

remover = make_remover("isnet-general-use")
placements = load_placements()
photo = Path("../src/assets/templates/pm-birthday-AI-Shubhkamna-card-4.jpg").read_bytes()
fields = TextFields(name="Test User", constituency="Patna", state="Bihar")

jpeg = compose(photo, placements["card-2"], fields, remover)

out = Path("check-output/smoke-real-model.jpg")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(jpeg)
```

Run from `server/` with the venv active, and inspect `check-output/smoke-real-model.jpg` afterwards
to confirm the subject was cut out cleanly and pasted into the card.
