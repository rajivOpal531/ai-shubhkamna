import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppBackground } from '../components/AppBackground';
import type { CutoutResult, Rect, Template } from '../types';
import './Adjust.css';

type Props = {
  template: Template;
  cutout: CutoutResult;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onApply: (box: Rect) => void;
};

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;

// Fit `size` inside `box`, bottom-anchored and horizontally centred (mirrors the backend's
// fit_bottom_center so the initial placement matches the auto-composited one).
function fitBottomCenter(natW: number, natH: number, box: Rect): Rect {
  const scale = Math.min(box.w / natW, box.h / natH);
  const w = Math.max(1, Math.round(natW * scale));
  const h = Math.max(1, Math.round(natH * scale));
  return { x: box.x + (box.w - w) / 2, y: box.y + box.h - h, w, h };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * "Adjust photo" screen: the transparent cutout floats over the chosen template. A slider resizes
 * it and dragging repositions it; Apply composites at the chosen box. Everything is tracked in card
 * coordinates (cutout centre + a scale multiplier on the fitted size) and only scaled for display.
 */
export function Adjust({ template, cutout, busy = false, error, onCancel, onApply }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [dispW, setDispW] = useState(0);
  // Cutout centre (card px) + scale multiplier on the bottom-centre fitted size.
  const [pos, setPos] = useState<{ cx: number; cy: number; scale: number } | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; cx: number; cy: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(cutout.blob);
    setCutoutUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cutout.blob]);

  // Track the rendered stage width so we can map between display px and card px.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setDispW(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Once we know the cutout's natural size, seed the placement from the template's photo box.
  useEffect(() => {
    if (!natural) return;
    const fitted = fitBottomCenter(natural.w, natural.h, cutout.photoBox);
    setPos({ cx: fitted.x + fitted.w / 2, cy: fitted.y + fitted.h / 2, scale: 1 });
  }, [natural, cutout.photoBox]);

  const factor = dispW && cutout.cardWidth ? dispW / cutout.cardWidth : 0;
  const dispH = cutout.cardHeight * factor;

  const fitted = natural ? fitBottomCenter(natural.w, natural.h, cutout.photoBox) : null;

  function currentBox(): Rect | null {
    if (!pos || !fitted) return null;
    const w = fitted.w * pos.scale;
    const h = fitted.h * pos.scale;
    return { x: pos.cx - w / 2, y: pos.cy - h / 2, w, h };
  }

  const box = currentBox();

  function onPointerDown(event: React.PointerEvent) {
    if (!pos || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, cx: pos.cx, cy: pos.cy };
  }

  function onPointerMove(event: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId || !factor) return;
    const dx = (event.clientX - d.startX) / factor;
    const dy = (event.clientY - d.startY) / factor;
    setPos((prev) =>
      prev
        ? {
            ...prev,
            // Keep the centre on the card so the cutout can't be dragged entirely out of frame.
            cx: clamp(d.cx + dx, 0, cutout.cardWidth),
            cy: clamp(d.cy + dy, 0, cutout.cardHeight),
          }
        : prev,
    );
  }

  function endDrag(event: React.PointerEvent) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  }

  function apply() {
    if (box) onApply(box);
  }

  return (
    <div className="adjust">
      <AppBackground />
      <header className="adjust__header">
        <button type="button" className="adjust__back" aria-label="Back" onClick={onCancel} disabled={busy}>
          ←
        </button>
        <h1>Adjust photo</h1>
      </header>

      <p className="adjust__hint">Drag to reposition and use the slider to resize your photo.</p>

      <div className="adjust__stage" ref={stageRef} style={{ height: dispH || undefined }}>
        {/* Clean template (no avatar-placeholder silhouette), so only the user's photo shows over it. */}
        <img className="adjust__template" src={template.cleanImage} alt="" draggable={false} />
        {/* Caption keep-clear hint */}
        {factor > 0 && (
          <div
            className="adjust__textbox"
            style={{
              left: cutout.textBox.x * factor,
              top: cutout.textBox.y * factor,
              width: cutout.textBox.w * factor,
              height: cutout.textBox.h * factor,
            }}
          />
        )}
        {cutoutUrl && box && factor > 0 && (
          <img
            className="adjust__cutout"
            src={cutoutUrl}
            alt="Your photo"
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{
              left: box.x * factor,
              top: box.y * factor,
              width: box.w * factor,
              height: box.h * factor,
            }}
          />
        )}
        {/* Load the cutout even before the box is ready, to read its natural size. */}
        {cutoutUrl && !natural && (
          <img
            src={cutoutUrl}
            alt=""
            aria-hidden="true"
            style={{ display: 'none' }}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
        )}
      </div>

      <div className="adjust__slider">
        <span className="adjust__slider-icon adjust__slider-icon--sm" aria-hidden="true">A</span>
        <input
          type="range"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step={0.01}
          value={pos?.scale ?? 1}
          disabled={!pos || busy}
          aria-label="Resize photo"
          onChange={(e) => setPos((prev) => (prev ? { ...prev, scale: Number(e.target.value) } : prev))}
        />
        <span className="adjust__slider-icon adjust__slider-icon--lg" aria-hidden="true">A</span>
      </div>

      {error && (
        <p className="adjust__error" role="alert">
          {error}
        </p>
      )}

      <div className="adjust__actions">
        <button type="button" className="adjust__cancel" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="adjust__apply" onClick={apply} disabled={busy || !box}>
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </div>
  );
}
