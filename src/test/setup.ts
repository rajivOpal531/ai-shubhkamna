import '@testing-library/jest-dom/vitest';

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  set src(value: string) {
    this._src = value;
    queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this._src;
  }
}
// @ts-expect-error test stub, not a full Image implementation
global.Image = FakeImage;

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  drawImage: vi.fn(),
})) as unknown as HTMLCanvasElement['getContext'];

HTMLCanvasElement.prototype.toBlob = vi.fn(function toBlob(callback: BlobCallback) {
  callback(new Blob(['fake-image-bytes'], { type: 'image/jpeg' }));
}) as unknown as HTMLCanvasElement['toBlob'];

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:fake-url');
}

if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
}
