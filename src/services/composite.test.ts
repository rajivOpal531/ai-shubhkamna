import { afterEach, describe, expect, it, vi } from 'vitest';
import { compositePhoto } from './composite';
import { config } from '../config';
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
  jwt: 'test-jwt',
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

  it('posts multipart fields with a bearer header and returns the image url when useMock is false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ imageUrl: 'https://cards.s3.ap-south-1.amazonaws.com/ai-shubh/abc.jpg' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await compositePhoto(PARAMS, { useMock: false });

    expect(result.imageUrl).toBe('https://cards.s3.ap-south-1.amazonaws.com/ai-shubh/abc.jpg');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(config.compositeUrl);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-jwt');
    const form = init.body as FormData;
    expect(form.get('template')).toBe('card-1');
    expect(form.get('name')).toBe('Rajiv Ranjan');
    expect(form.get('constituency')).toBe('Gautam Buddha Nagar');
    expect(form.get('state')).toBe('Uttar Pradesh');
    expect(form.get('photo')).toBeInstanceOf(Blob);
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
