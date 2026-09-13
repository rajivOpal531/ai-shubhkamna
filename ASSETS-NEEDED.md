# Figma assets to drop in

Everything in the round-2 correction list is implemented and working. Five visual spots
currently use hand-built stand-ins because the Figma MCP could not export the real rasters
(the account seat is View-only and hit its tool-call limit). Each stand-in is marked in code
and is a one-line swap once the real PNG/SVG is exported from Figma
(file `IlMPtxiBj9gSrFNhsy9N5x`, board node `1353:2411`).

Export each node from Figma as PNG (2x for crispness on retina phones) and place it at the
path below. No logic changes are required.

| # | Asset | What it is | Drop file at | Then change |
|---|-------|-----------|--------------|-------------|
| 1 | **App background** | The watermark/pattern behind every screen | `src/assets/app-bg.png` | In `src/components/AppBackground.css`, set `--app-bg-image: url('../assets/app-bg.png')` and add `background-image: var(--app-bg-image); background-size: cover;` to `.app-bg` (a placeholder rule is already there, commented). Then the inline `<svg class="app-bg__mark">` in `src/components/AppBackground.tsx` can be deleted. |
| 2 | **Tips cartoon** | The "hand holding a phone" illustration on the Tips screen | `src/assets/tips-illustration.png` | In `src/steps/Tips.tsx`, replace the inline `<svg>` inside `.tips__illustration` with `<img src={tipsIllustration} alt="" />` (add the import). |
| 3 | **No-face art** | Illustration for the "No face detected" screen | `src/assets/error-no-face.png` | In `src/steps/Processing.tsx`, swap the `<FaceErrorArt variant="none" />` render for an `<img>`. |
| 4 | **Multiple-faces art** | Illustration for the "Multiple faces detected" screen | `src/assets/error-multiple-faces.png` | Same file: swap `<FaceErrorArt variant="many" />` for an `<img>`. |
| 5 | **Generic error art** | Illustration for the other error screens (offline, busy, etc.) | `src/assets/error-generic.png` | Same file: swap `<GenericErrorArt />` for an `<img>`. |

Optional, if the Figma has a dedicated frame for it:

| Asset | What it is | Notes |
|-------|-----------|-------|
| **Hang-tight illustration** | Art on the "Hang tight!" waiting screen | Currently a spinner; if Figma shows a specific illustration, place it at `src/assets/hang-tight.png` and swap the spinner span in `Processing.tsx`. |

## Fastest path

- **Best:** upgrade the Figma seat to one that allows MCP export (or Dev Mode), tell me, and I will export every node and wire them in one pass.
- **Or:** export the five PNGs from Figma yourself, drop them in `src/assets/`, and I will do the wiring.
- **Or:** just paste the images into chat and I will save and wire them.

All five stand-ins are intentionally tasteful and on-brand, so the app is fully usable and demoable as-is until the real assets arrive.
