import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({
  config: {
    compositeUrl: 'https://svc.example/composite',
    cutoutUrl: 'https://svc.example/cutout',
    useMockComposite: true,
  },
}));

import { fetchCutout, compositeCutout, CompositeError } from './composite';
import type { Profile } from '../types';

const PROFILE: Profile = {
  username: 'Rajiv Ranjan',
  email: '',
  mobileno: '',
  state: 'Bihar',
  constituency: 'Patna',
  district: 'Patna',
};

function fakeResponse(overrides: {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  blob?: Blob;
  json?: unknown;
}) {
  const headers = overrides.headers ?? {};
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    headers: { get: (key: string) => headers[key] ?? headers[key.toLowerCase()] ?? null },
    blob: async () => overrides.blob ?? new Blob(['png'], { type: 'image/png' }),
    json: async () => overrides.json,
    clone() {
      return this;
    },
  };
}

describe('fetchCutout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts template + photo with a bearer header and parses the geometry headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({
        headers: {
          'content-type': 'image/png',
          'X-Card-Size': '1080,1260',
          'X-Photo-Box': '540,120,480,1000',
          'X-Text-Box': '60,900,420,220',
          'X-Request-Id': 'abc12345',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchCutout({
      photo: new Blob(['x'], { type: 'image/jpeg' }),
      templateId: 'card-2',
      jwt: 'jwt-1',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://svc.example/cutout');
    expect(init.headers.Authorization).toBe('Bearer jwt-1');
    const body = init.body as FormData;
    expect(body.get('template')).toBe('card-2');
    expect(body.get('photo')).toBeInstanceOf(Blob);

    expect(result.cardWidth).toBe(1080);
    expect(result.cardHeight).toBe(1260);
    expect(result.photoBox).toEqual({ x: 540, y: 120, w: 480, h: 1000 });
    expect(result.textBox).toEqual({ x: 60, y: 900, w: 420, h: 220 });
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it('surfaces the detail code on a 422', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ ok: false, status: 422, json: { detail: 'no_face' } })),
    );
    await expect(
      fetchCutout({ photo: new Blob(['x']), templateId: 'card-2', jwt: 'j' }),
    ).rejects.toMatchObject({ status: 422, code: 'no_face' });
  });

  it('throws when a geometry header is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({ headers: { 'content-type': 'image/png', 'X-Card-Size': '1080,1260' } }),
      ),
    );
    await expect(
      fetchCutout({ photo: new Blob(['x']), templateId: 'card-2', jwt: 'j' }),
    ).rejects.toBeInstanceOf(CompositeError);
  });
});

describe('compositeCutout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts the cutout + rounded box and returns the image url in url mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({
        headers: { 'content-type': 'application/json', 'X-Request-Id': 'def45678', 'X-Poster-Warning': 'text-overlap' },
        json: { imageUrl: 'https://cdn.example/x.jpg' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await compositeCutout({
      cutout: new Blob(['png'], { type: 'image/png' }),
      box: { x: 120.4, y: 150.6, w: 400.2, h: 700.9 },
      templateId: 'card-2',
      profile: PROFILE,
      jwt: 'jwt-2',
    });

    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get('box')).toBe('120,151,400,701'); // rounded
    expect(body.get('cutout')).toBeInstanceOf(Blob);
    expect(body.get('name')).toBe('Rajiv Ranjan');
    expect(result.imageUrl).toBe('https://cdn.example/x.jpg');
    expect(result.warning).toBe('text-overlap');
  });

  it('returns an image blob in image mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({ headers: { 'content-type': 'image/jpeg' }, blob: new Blob(['jpeg'], { type: 'image/jpeg' }) }),
      ),
    );
    const result = await compositeCutout({
      cutout: new Blob(['png'], { type: 'image/png' }),
      box: { x: 0, y: 0, w: 100, h: 100 },
      templateId: 'card-2',
      profile: PROFILE,
      jwt: 'j',
    });
    expect(result.imageBlob).toBeInstanceOf(Blob);
    expect(result.imageUrl).toBeUndefined();
  });
});
