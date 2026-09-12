import { afterEach, describe, expect, it, vi } from 'vitest';
import { compositePhoto } from './composite';
import type { Profile } from '../types';

const PROFILE: Profile = {
  username: 'Rajiv Ranjan',
  email: '',
  mobileno: '',
  state: 'Uttar Pradesh',
  constituency: 'Gautam Buddha Nagar',
  district: 'Gautam Buddha Nagar',
};

const PARAMS = {
  photo: new Blob(['photo-bytes'], { type: 'image/jpeg' }),
  templateId: 'card-1',
  templateImageUrl: 'data:image/jpeg;base64,template',
  profile: PROFILE,
};

describe('compositePhoto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a composited image blob when useMock is true', async () => {
    const result = await compositePhoto(PARAMS, { useMock: true });
    expect(result.imageBlob).toBeInstanceOf(Blob);
    expect(result.imageUrl).toBeUndefined();
  });

  it('posts to the compositing endpoint and returns an image url when useMock is false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ imageUrl: 'https://cdn.narendramodi.in/shubhkamna2026/card.jpg' }),
      }),
    );

    const result = await compositePhoto(PARAMS, { useMock: false });

    expect(result.imageUrl).toBe('https://cdn.narendramodi.in/shubhkamna2026/card.jpg');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('throws when the compositing endpoint responds with a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));

    await expect(compositePhoto(PARAMS, { useMock: false })).rejects.toThrow(
      'Compositing failed with status 502',
    );
  });

  it('draws the photo at the expected offset and size on the mock canvas', async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);

    await compositePhoto(PARAMS, { useMock: true });

    expect(drawImage).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      1080 * 0.55,
      1260 * 0.45,
      1080 * 0.4,
      1260 * 0.5,
    );
  });
});
