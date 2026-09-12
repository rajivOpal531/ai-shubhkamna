import { afterEach, describe, expect, it, vi } from 'vitest';

// `config` reads import.meta.env at module load time, so under vitest it would otherwise
// resolve compositeUrl to '' (no VITE_COMPOSITE_URL set). Mock it here so the real-path
// tests below exercise a configured URL; the "unconfigured" guard itself is covered
// separately in composite.config.test.ts, which mocks this same module with an empty/
// placeholder URL per test.
vi.mock('../config', () => ({
  config: {
    compositeUrl: 'https://svc.example/composite',
    useMockComposite: true,
  },
}));

import { compositePhoto, CompositeError } from './composite';
import { config } from '../config';
import type { Profile } from '../types';

const hasAbortSignalTimeout = typeof AbortSignal.timeout === 'function';

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
    expect((form.get('photo') as File).name).toBe('photo.jpg');
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    if (hasAbortSignalTimeout) {
      expect(init.signal).toBeDefined();
    }
  });

  it('throws a CompositeError with status and request id when the compositing endpoint responds with a non-ok status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        headers: { get: (key: string) => (key === 'X-Request-Id' ? 'abc12345' : null) },
      }),
    );

    const error = await compositePhoto(PARAMS, { useMock: false }).catch((err) => err);
    expect(error).toBeInstanceOf(CompositeError);
    expect((error as CompositeError).status).toBe(502);
    expect((error as CompositeError).requestId).toBe('abc12345');
    expect((error as CompositeError).retryable).toBe(true);
  });

  it('marks 422 responses as not retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        headers: { get: () => null },
      }),
    );

    const error = await compositePhoto(PARAMS, { useMock: false }).catch((err) => err);
    expect(error).toBeInstanceOf(CompositeError);
    expect((error as CompositeError).retryable).toBe(false);
  });

  it('rejects with a CompositeError when the response body has no imageUrl', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
      }),
    );

    const error = await compositePhoto(PARAMS, { useMock: false }).catch((err) => err);
    expect(error).toBeInstanceOf(CompositeError);
    expect((error as CompositeError).message).toContain('imageUrl');
  });

  it('wraps an aborted fetch into a retryable CompositeError with no status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));

    const error = await compositePhoto(PARAMS, { useMock: false }).catch((err) => err);
    expect(error).toBeInstanceOf(CompositeError);
    expect((error as CompositeError).status).toBeNull();
    expect((error as CompositeError).retryable).toBe(true);
  });

  it('passes a supplied signal through to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ imageUrl: 'https://example.com/x.jpg' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await compositePhoto({ ...PARAMS, signal: controller.signal }, { useMock: false });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
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
