import { afterEach, describe, expect, it, vi } from 'vitest';
import { downscaleImage } from './downscaleImage';

function fakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('downscaleImage', () => {
  it('returns the original when createImageBitmap is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const original = new Blob(['x'.repeat(5000)], { type: 'image/jpeg' });
    expect(await downscaleImage(original)).toBe(original);
  });

  it('returns the original (no re-encode) when the image is already small', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(fakeBitmap(1000, 800)));
    const original = new Blob(['x'.repeat(5000)], { type: 'image/jpeg' });
    expect(await downscaleImage(original, 1600)).toBe(original);
  });

  it('downscales a large image to a smaller JPEG', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(fakeBitmap(4000, 3000)));
    // canvas.toBlob is stubbed in test setup to return a small fake blob; capture the dimensions.
    let toBlobCanvas: HTMLCanvasElement | null = null;
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'canvas') toBlobCanvas = el as HTMLCanvasElement;
      return el;
    });

    const big = new Blob(['x'.repeat(500000)], { type: 'image/jpeg' }); // 500KB "original"
    const out = await downscaleImage(big, 1600, 0.85);

    expect(out).not.toBe(big); // was re-encoded
    expect(out.size).toBeLessThan(big.size); // and smaller
    // 4000x3000 scaled to longest edge 1600 -> 1600x1200
    expect(toBlobCanvas!.width).toBe(1600);
    expect(toBlobCanvas!.height).toBe(1200);
  });

  it('returns the original when decoding throws (e.g. HEIC the browser cannot read)', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
    const original = new Blob(['heic-bytes'], { type: 'image/heic' });
    expect(await downscaleImage(original)).toBe(original);
  });
});
