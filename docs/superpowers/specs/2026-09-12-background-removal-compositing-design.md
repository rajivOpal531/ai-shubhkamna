# AI Shubhkamna — Background Removal & Compositing Service

## Purpose

Replace the client-side mock compositing with a real backend that removes the background from the
user's photo (gallery upload or camera capture), composites the cutout onto the clean
"without-vector" template, renders the user's name line, uploads the result to S3, and returns
the URL. The frontend flow is unchanged: Processing calls the service, Preview shows the result,
Post uses `createPostByImageUrl`.

This supersedes the "Photo compositing" item under *Open integrations* in
`2026-09-12-ai-shubhkamna-design.md`. Everything else in that spec still applies.

## Decisions (agreed 2026-09-12)

| Question | Decision |
|---|---|
| Where background removal runs | Backend service (not browser, not paid API) |
| Stack / hosting | Python 3.11, FastAPI, `rembg`, Pillow, boto3; deployed to Railway via Dockerfile |
| Code location | Same repo, `server/` folder; Railway root directory = `server/` |
| Return value | S3 URL (`{ imageUrl }`); bucket and IAM credentials already exist |
| Cutout placement | Auto-derived by diffing with-vector vs clean template; committed JSON |
| Name line | Render name + constituency + state in the caption placeholder position |
| Clean templates | Still contain "-Your name / constituency, State" text; service paints over it |
| Protection | CORS allowlist + per-IP rate limit; JWT required but not validated yet; validation hook via env |

## Repository layout

```
server/
  Dockerfile
  requirements.txt
  README.md
  .env.example
  app/
    main.py            # FastAPI app, routes, middleware
    config.py          # env parsing
    pipeline.py        # decode -> remove bg -> fit -> paste -> text -> encode
    placements.py      # loads placements.json, typed accessors
    storage.py         # S3 uploader (+ in-memory stub for tests)
    fonts/Outfit-*.ttf # bundled OFL font (or the design team's font if supplied)
  templates/
    clean/card-<n>.jpg # without-vector set, same ids as src/data/templates.ts
    placements.json    # generated + hand-edited, committed
  tools/
    derive_placements.py
  tests/
```

Frontend changes stay in `src/services/composite.ts`, `src/steps/Processing.tsx`, `src/types.ts`,
`.env.example`, and a new global stylesheet.

## API

### `POST /composite`

Multipart form fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `photo` | file | yes | `image/jpeg`, `image/png`, or `image/webp`; ≤ 10 MB |
| `template` | text | yes | one of the ids in `placements.json` (`card-1` … `card-15`) |
| `name` | text | no | display name; skipped if blank |
| `constituency` | text | no | skipped if blank |
| `state` | text | no | skipped if blank |

Headers: `Authorization: Bearer <jwt>` — must be present and non-empty.

Response `200`:

```json
{ "imageUrl": "https://<bucket>.s3.<region>.amazonaws.com/<prefix>/<uuid>.jpg" }
```

Errors (JSON body `{ "detail": "..." }`):

| Status | When |
|---|---|
| 400 | unknown template id, missing `photo` |
| 401 | missing/empty Authorization header, or `JWT_VALIDATE_URL` set and returned non-200 |
| 413 | body larger than 10 MB |
| 415 | unsupported or undecodable image |
| 422 | background removal found no subject in the photo |
| 429 | per-IP rate limit exceeded |
| 502 | S3 upload failed |
| 500 | anything else (logged with a request id) |

### `GET /health`

`{ "status": "ok", "model_loaded": true }`. Used by Railway's health check.

## Pipeline (`pipeline.py`)

Runs in order, all in memory, no temp files:

1. **Decode** with Pillow. Apply EXIF orientation (`ImageOps.exif_transpose`). If the longest side
   exceeds 2000 px, downscale with LANCZOS. Convert to RGB.
2. **Remove background** with `rembg.remove` using the `isnet-general-use` session created once at
   startup. Output is RGBA.
3. **Crop** the RGBA to the bounding box of pixels with alpha > 8. If the box is empty (no
   subject found), return 422 with detail "No person detected in photo".
4. **Fit** the cutout into `photo_box`: scale so it fits within the box preserving aspect ratio
   (contain), centre horizontally, anchor to the box's bottom edge.
5. **Paste** onto the clean template using the alpha channel as mask.
6. **Text**: fill `text_box` with `block_color`, then draw up to two lines inside it with the
   bundled font at `font_size`:
   - line 1: `-{name}` (only if `name` non-blank)
   - line 2: `{constituency}, {state}` — whichever parts are non-blank, joined with ", "
   Lines are left-aligned to the box, top-anchored, line height = 1.25 × font size. Text longer
   than the box width is truncated with "…". If both lines are blank the box is still filled, so
   the placeholder never leaks through.
7. **Encode** JPEG, quality 90, and hand the bytes to storage.

## Template data

### `placements.json`

Illustrative values only; real numbers come from the script and hand measurement.

```json
{
  "card-2": {
    "photo_box":  { "x": 640, "y": 530, "w": 380, "h": 730 },
    "text_box":   { "x": 115, "y": 1080, "w": 470, "h": 80 },
    "block_color": "#3D50B3",
    "text_color":  "#FFFFFF",
    "font_size":   28
  }
}
```

- `photo_box` is written by `tools/derive_placements.py`: for each id, load the with-vector card
  from `../src/assets/templates/` and the clean card from `templates/clean/`, assert same size,
  compute per-pixel absolute difference (max over RGB), threshold at 24, take the bounding box of
  differing pixels. Refuses to run if the box is empty (identical images) or covers more than
  60 % of the card (wrong pairing).
- `text_box`, `block_color`, `text_color`, `font_size` are hand-measured per template and
  preserved by the script on re-run (it only overwrites `photo_box`).
- Template ids and the set of files must match `src/data/templates.ts` exactly; a test asserts
  this.

### Clean templates

Supplied by the stakeholder (not yet in hand as of this spec). Must be the same pixel dimensions
as the with-vector set. Committed under `server/templates/clean/` with the same file naming.

## Security and limits

- **CORS**: `ALLOWED_ORIGINS` (comma-separated). Only these origins pass preflight. No wildcard.
- **Rate limit**: `slowapi`, key = client IP (respecting `X-Forwarded-For` behind Railway's
  proxy), default `RATE_LIMIT_PER_MINUTE=10`.
- **JWT**: required header. Not decoded. A 12-char SHA-256 prefix of the token is logged per
  request. If `JWT_VALIDATE_URL` is set, the service performs `GET JWT_VALIDATE_URL` with the same
  bearer before processing and rejects with 401 on any non-200 (5 s timeout → 401 as well).
- **Body limit**: 10 MB, enforced before reading the file into memory.
- **Secrets**: only via environment. `server/.env.example` lists names with empty values. No AWS
  keys, no JWT decode logic in the repo (carried over from the base spec).
- **S3 objects**: key `<S3_PREFIX>/<uuid4>.jpg`, `ContentType: image/jpeg`. Public readability
  comes from the bucket policy; the service does not set an ACL unless `S3_PUBLIC_READ_ACL=true`.

## Frontend changes

- `types.ts`: `CompositeParams` gains `jwt: string`. `Profile` unchanged.
- `composite.ts` real path: send `template`, `photo`, `name`, `constituency`, `state` as
  multipart; set `Authorization: Bearer <jwt>`; read `imageUrl`. Replace the "provisional
  contract" comment with a pointer to `server/README.md`. Mock path unchanged.
- `Processing.tsx`: read `jwt` via `useJwt()` and pass it into `compositePhoto`.
- `.env.example`: `VITE_COMPOSITE_URL=https://<railway-app>.up.railway.app/composite`,
  `VITE_USE_MOCK_COMPOSITE=false`, with a comment that setting it back to `true` restores the
  local canvas mock.
- Global font: new `src/index.css` imported from `main.tsx`, setting the system sans-serif stack
  on `body`; remove the duplicate from `Landing.css`.

No screen or flow changes. Preview already renders `imageUrl`; `App.tsx` already routes URL
results to `createPostByImageUrl`.

## Deployment (Railway)

- New service from this repo, **Root Directory** `server`, builder = Dockerfile.
- Dockerfile: `python:3.11-slim`, install requirements, copy app + templates + fonts, run a
  one-line Python step that instantiates the `isnet-general-use` session so the model weights are
  baked into the image, `CMD uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- Health check path `/health`.
- Environment variables:

| Name | Required | Example |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | yes | — |
| `AWS_SECRET_ACCESS_KEY` | yes | — |
| `AWS_REGION` | yes | `ap-south-1` |
| `S3_BUCKET` | yes | — |
| `S3_PREFIX` | no | `ai-shubh` (default) |
| `S3_PUBLIC_READ_ACL` | no | `false` (default) |
| `ALLOWED_ORIGINS` | yes | `https://shubhkamnauat.narendramodi.in` |
| `RATE_LIMIT_PER_MINUTE` | no | `10` (default) |
| `JWT_VALIDATE_URL` | no | empty = skip validation |

Memory: rembg with ISNet needs roughly 1 GB RSS; the Railway service should be sized at 2 GB.

## Testing

All backend tests run without AWS or the real model:

- `tests/test_derive_placements.py`: synthetic pairs → correct bbox; identical images → error;
  oversized diff → error.
- `tests/test_pipeline.py`: `rembg.remove` monkeypatched to return a fixed RGBA figure; asserts
  fit/anchor maths, text drawn inside `text_box`, blank fields skipped, placeholder region
  covered.
- `tests/test_api.py`: TestClient with a stub uploader; happy path returns `imageUrl`; 401 on
  missing JWT; 400 bad template; 413 oversize; 415 non-image; 429 after limit.
- `tests/test_templates_match_frontend.py`: ids in `placements.json` == ids in
  `src/data/templates.ts` == files in `templates/clean/`.

Frontend: `composite.test.ts` gains a real-path case asserting form fields and the
Authorization header.

Manual: one end-to-end run from the mobile viewport against the deployed Railway URL with a real
UAT JWT: Landing → Upload → Preview shows the S3 image → Post → Media Wall redirect.

## Out of scope

- JWT validation itself (hook only).
- Per-template manual override of `photo_box` (decided against; regenerate via the script).
- Face/pose-aware placement; the fit is a plain contain + bottom anchor.
- Storing or listing generated cards; S3 is write-only from this service.

## Open items

1. Clean template files from the stakeholder → `server/templates/clean/`.
2. Brand font file from design; until provided, Outfit (OFL) is bundled.
3. Hand-measure `text_box`/colours for all 11 templates once the clean files are in hand.
