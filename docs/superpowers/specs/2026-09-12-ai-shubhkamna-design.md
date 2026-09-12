# AI Shubhkamna — Frontend Design

## Purpose

A mobile webview module, launched from the NaMo app's Birthday engagement homepage, that lets a
user craft a personalised "Happy Birthday PM Modi" card: pick a template, capture or upload a
photo, get it AI-composited alongside PM Modi, add a wish, and post it to the Media Wall.

This spec covers the **card-creation flow only**. The Media Wall itself is a separate module we
redirect into after a successful post — out of scope here.

Source design: Figma prototype "Birthday Module 2026" (node 138:5853).
Integration contract: `INTEGRATION-DRAFT 1.html` (shared by stakeholder), summarised in
[Integration contract](#integration-contract) below.

## Stack

- Vite + React + TypeScript, mobile-first hand-rolled CSS (no UI framework — the design doesn't
  need one, and keeping the webview bundle small matters).
- No router library — this is a linear wizard, not a multi-route app. An internal step enum
  drives which screen renders.
- Deployed build output points to `http://Shubhkamnauat.narendramodi.in` (the entry URL shared
  by the integration team for the engagement homepage to link to).

## Screens & flow

```
Landing ─┬─ Upload ──────────────┐
         └─ Capture → Tips → getUserMedia capture ─┘
                                                     ▼
                                                Processing (compositing)
                                                     ▼
                                          Preview / Wishes ─┬─ Retake → back to Capture/Upload
                                                             └─ Post → Create Post API
                                                                        ├─ 200 → redirect to Media Wall + jwt
                                                                        └─ error → inline banner, stay on page
Landing "back" → confirm dialog → Yes → redirect to Engagement Home + jwt
```

1. **Landing** — headline/subhead copy, swipeable template carousel (11 templates, one
   selected), editable display-name field (prefilled from the profile service — see
   [Open integrations](#open-integrations)), Upload / Capture buttons.
2. **Tips** — static photo-guidance panel (back camera, head-to-waist, portrait orientation,
   plain background, solo, no filters). "Proceed" opens the camera.
3. **Capture** — `getUserMedia` camera view: shutter, flash toggle (if supported), front/back
   flip. **Upload** skips this entirely and uses a plain `<input type="file" accept="image/*">`
   — that already *is* the native gallery picker on mobile; the Figma gallery mock is just
   illustrating the OS picker, not a custom UI to build.
4. **Processing** — shown while the compositing call is in flight ("Creating your perfect photo
   with PM Modi").
5. **Preview / Wishes** — composited card preview, wish textarea (200 char limit, hashtag hint
   text `#HappyBirthdayPMModi #HappyBirthdayModiJi`), "Inspire me" fills a random preset message,
   Retake (back to Capture/Upload) / Post.
6. **Exit** — back arrow → "Are you sure you want to exit?" confirm dialog → Yes redirects to
   Engagement Home URL + jwt (via `location.replace`, no history entry); No dismisses.

No standalone "view wall" link is included — the Figma design doesn't have one, and it's out of
scope per stakeholder confirmation.

## Templates

11 approved templates (Dropbox "Graphics b" folder), IDs derived from filename suffix:
`card-1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 15` (7/12/13/14 don't exist — gap is expected, not a bug).

- **With-vector set** (has a silhouette placeholder where the user's photo goes) — bundled as
  static assets in this repo, used for the landing carousel thumbnails.
- **Without-vector set** — stays server-side; only the compositing backend needs these. The
  frontend never fetches or references them, it only sends the template ID.

## Integration contract

(Full detail in the shared integration doc; summarised here for what the frontend must do.)

- Entry: JWT arrives as `?jwt=<token>` on initial load. Read once, keep in memory for the
  session (never persisted to storage, never logged).
- Every API call sends `Authorization: Bearer <jwt>`.
- Exit and post-success both redirect via `window.location.replace()` (not `href`, not an anchor
  — no history entry) with `?jwt=<token>` appended:
  - Exit → Engagement Home URL
  - Post success → Media Wall URL
- Create Post — two APIs, pick based on what the compositing step returns:
  - `POST /mediawall/bday2024/createPostByImageUrl` (multipart form: `text`, `image` [S3 URL,
    **text field not a file**], `template`, `moduleType`, `lang`) — used if compositing returns
    an S3 URL.
  - `POST /mediawall/bday2024/createPost` (multipart form: `text`, `moduleType`, `images` [file])
    — used if we're holding the composited image as a file.
  - `moduleType` must be exactly `AI Shubh` on both.
  - On non-200: show inline error, stay on page, do not redirect.
- All endpoint URLs (home, media wall, create-post) live in env config so PROD swap-over needs
  no code change (PROD values not yet available — UAT only for now).

## Open integrations (TBD — built behind swappable service interfaces)

Two backend pieces don't exist yet. Both get a typed service interface
(`services/profile.ts`, `services/composite.ts`) with a mock implementation behind an env flag,
so the full flow is demoable today and swapping in real endpoints later is a config change, not
a UI change:

- **Profile lookup** — `GET` endpoint, `Authorization: Bearer <jwt>`, returns
  `{ username, email, mobileno, state, constituency, district }` (matches the fields shown in
  the stakeholder's reference screenshot). Frontend uses `username` to prefill the editable
  display-name field. Mock returns an empty string (field starts blank, user types it) until the
  real URL is provided.
- **Photo compositing** — takes the captured/uploaded photo + selected template ID, returns
  either an S3 URL or an image blob for the Create Post call. Mock does a client-side canvas
  overlay of the photo onto the "with-vector" template as a visual stand-in, purely so the
  Preview screen has something to show during development.

### Explicit security decisions (do not revisit without discussion)

- **No AWS credentials in this repo, ever.** S3 writes happen server-side wherever the
  compositing endpoint lives; the frontend never talks to AWS directly.
- **No JWT decrypt/decode logic in this repo.** The stakeholder's `decryptStaticValue` uses a
  static key shared by every user — shipping it client-side would let any user decrypt any other
  user's profile data. Profile data comes only from the `GET /profile` endpoint above, decrypted
  server-side.
- The sample UAT JWT (for local testing only) lives in a gitignored `.env.local`, never
  hardcoded in source.

## Error handling

- Missing `jwt` on load → blocking "can't load" screen (nothing works without it, no point
  showing the rest of the UI).
- Camera permission denied/unavailable → fall back to the Upload path with a short explanation.
- Compositing failure → error state on the Processing screen with Retry / Retake.
- Create Post non-200 → inline error banner on Preview screen, Post button re-enabled, no
  redirect.
- Network failure on any call → generic inline error, action retryable.

## Testing

Manual verification in a mobile-emulated browser viewport, exercising: Landing → Capture path →
Preview → mocked Post → redirect; Landing → Upload path → Preview → mocked Post; Retake; Exit
confirm (Yes and No); missing-jwt state. No backend exists to hit for compositing/profile yet, so
those stay on mocks until real endpoints are provided — automated tests cover the parts that are
fully specified (Create Post request shape, JWT propagation, redirect URL construction).
