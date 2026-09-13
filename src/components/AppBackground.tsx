import './AppBackground.css';

/**
 * Shared decorative background rendered behind every screen so the module has one consistent
 * backdrop (Figma round-2, item 10). It is a fixed, non-interactive layer carrying the Figma
 * "development India" watermark (src/assets/app-bg.png), which fades to near-white down the
 * centre so caption and body text stay readable on top.
 */
export function AppBackground() {
  return <div className="app-bg" aria-hidden="true" />;
}
