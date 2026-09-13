import './AppBackground.css';

/**
 * Shared decorative background rendered behind every screen so the module has one consistent
 * backdrop (Figma round-2, item 10). It is a fixed, non-interactive layer: the beige base plus a
 * faint saffron→white→green wash and a low-opacity lotus watermark. Kept very light so caption and
 * body text stay readable on top. Drop the exact Figma raster into AppBackground.css
 * (`--app-bg-image`) later if a pixel-matched watermark is required.
 */
export function AppBackground() {
  return (
    <div className="app-bg" aria-hidden="true">
      <svg className="app-bg__mark" viewBox="0 0 120 120" width="360" height="360" preserveAspectRatio="xMidYMid meet">
        <g fill="none" stroke="#e08a1e" strokeWidth="1.4" strokeLinecap="round" opacity="0.9">
          <path d="M60 24c-6 10-6 22 0 34 6-12 6-24 0-34z" />
          <path d="M60 24c-6 10-6 22 0 34 6-12 6-24 0-34z" transform="rotate(40 60 46)" />
          <path d="M60 24c-6 10-6 22 0 34 6-12 6-24 0-34z" transform="rotate(-40 60 46)" />
          <path d="M60 24c-6 10-6 22 0 34 6-12 6-24 0-34z" transform="rotate(80 60 46)" />
          <path d="M60 24c-6 10-6 22 0 34 6-12 6-24 0-34z" transform="rotate(-80 60 46)" />
        </g>
      </svg>
    </div>
  );
}
