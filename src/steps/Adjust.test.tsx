import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Adjust } from './Adjust';
import type { CutoutResult, Template } from '../types';

const TEMPLATE: Template = { id: 'card-2', image: 'data:image/jpeg;base64,tpl' };

const CUTOUT: CutoutResult = {
  blob: new Blob(['png'], { type: 'image/png' }),
  cardWidth: 1080,
  cardHeight: 1260,
  photoBox: { x: 540, y: 120, w: 480, h: 1000 },
  textBox: { x: 60, y: 900, w: 420, h: 220 },
  warning: null,
};

// jsdom has no layout engine or ResizeObserver, so stub the pieces the component reads.
let clientWidthSpy: ReturnType<typeof vi.spyOn>;
const naturalDescriptors: PropertyDescriptor[] = [];

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private cb: () => void) {}
      observe() {
        this.cb();
      }
      disconnect() {}
    },
  );
  clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(330);
  for (const prop of ['naturalWidth', 'naturalHeight'] as const) {
    naturalDescriptors.push(Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, prop) ?? { configurable: true });
  }
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => 600 });
});

afterEach(() => {
  clientWidthSpy.mockRestore();
  vi.unstubAllGlobals();
});

function loadCutoutImage() {
  // The hidden loader img reads the cutout's natural size; fire its load so placement is seeded.
  const imgs = document.querySelectorAll('img');
  for (const img of imgs) fireEvent.load(img);
}

describe('Adjust', () => {
  it('applies the bottom-centre fitted box when nothing is moved', () => {
    const onApply = vi.fn();
    render(<Adjust template={TEMPLATE} cutout={CUTOUT} onCancel={() => {}} onApply={onApply} />);

    loadCutoutImage();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    // fit 400x600 into 480x1000 -> scale 1.2 -> 480x720, bottom-centred in the photo box.
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toEqual({ x: 540, y: 400, w: 480, h: 720 });
  });

  it('grows the box around its centre when the slider scales up', () => {
    const onApply = vi.fn();
    render(<Adjust template={TEMPLATE} cutout={CUTOUT} onCancel={() => {}} onApply={onApply} />);
    loadCutoutImage();

    fireEvent.change(screen.getByLabelText('Resize photo'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    // scale 2 -> 960x1440, centred on the same point (780, 760).
    const box = onApply.mock.calls[0][0];
    expect(box.w).toBeCloseTo(960);
    expect(box.h).toBeCloseTo(1440);
    expect(box.x + box.w / 2).toBeCloseTo(780);
    expect(box.y + box.h / 2).toBeCloseTo(760);
  });

  it('calls onCancel from the back button', () => {
    const onCancel = vi.fn();
    render(<Adjust template={TEMPLATE} cutout={CUTOUT} onCancel={onCancel} onApply={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables the actions and shows a busy label while applying', () => {
    render(<Adjust template={TEMPLATE} cutout={CUTOUT} busy onCancel={() => {}} onApply={() => {}} />);
    loadCutoutImage();
    expect(screen.getByRole('button', { name: 'Applying…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('shows an error message', () => {
    render(
      <Adjust template={TEMPLATE} cutout={CUTOUT} error="It broke" onCancel={() => {}} onApply={() => {}} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('It broke');
  });
});
