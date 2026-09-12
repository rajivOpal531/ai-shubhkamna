import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { createPostByImageUrl, createPostWithFile } from './createPost';

describe('createPostByImageUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the expected form fields with the Bearer auth header', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await createPostByImageUrl({
      jwt: 'tok',
      text: 'Happy Birthday!',
      imageUrl: 'https://cdn.narendramodi.in/shubhkamna2026/card.jpg',
      templateId: 'card-1',
    });

    expect(result).toEqual({ ok: true, status: 200 });
    const [url, requestInit] = fetchSpy.mock.calls[0];
    expect(url).toBe(config.createPostByUrlEndpoint);
    expect(requestInit.method).toBe('POST');
    expect(requestInit.headers).toEqual({ Authorization: 'Bearer tok' });

    const form = requestInit.body as FormData;
    expect(form.get('text')).toBe('Happy Birthday!');
    expect(form.get('image')).toBe('https://cdn.narendramodi.in/shubhkamna2026/card.jpg');
    expect(form.get('template')).toBe('card-1');
    expect(form.get('moduleType')).toBe('AI Shubh');
    expect(form.get('lang')).toBe('en');
  });

  it('returns ok:false without throwing on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    const result = await createPostByImageUrl({
      jwt: 'tok',
      text: 'x',
      imageUrl: 'https://cdn.narendramodi.in/shubhkamna2026/card.jpg',
      templateId: 'card-1',
    });

    expect(result).toEqual({ ok: false, status: 400 });
  });

  it('returns ok:false with status 0 when fetch itself rejects (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const result = await createPostByImageUrl({
      jwt: 'tok',
      text: 'x',
      imageUrl: 'https://cdn.narendramodi.in/shubhkamna2026/card.jpg',
      templateId: 'card-1',
    });

    expect(result).toEqual({ ok: false, status: 0 });
  });
});

describe('createPostWithFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the image as a file field named "images"', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);
    const imageBlob = new Blob(['bytes'], { type: 'image/jpeg' });

    const result = await createPostWithFile({ jwt: 'tok', text: 'Happy Birthday!', imageBlob });

    expect(result).toEqual({ ok: true, status: 200 });
    const [url, requestInit] = fetchSpy.mock.calls[0];
    expect(url).toBe(config.createPostFileEndpoint);
    const form = requestInit.body as FormData;
    expect(form.get('text')).toBe('Happy Birthday!');
    expect(form.get('moduleType')).toBe('AI Shubh');
    expect(form.get('images')).toBeInstanceOf(File);
  });

  it('returns ok:false without throwing on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const imageBlob = new Blob(['bytes'], { type: 'image/jpeg' });

    const result = await createPostWithFile({ jwt: 'tok', text: 'x', imageBlob });

    expect(result).toEqual({ ok: false, status: 400 });
  });

  it('returns ok:false with status 0 when fetch itself rejects (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const imageBlob = new Blob(['bytes'], { type: 'image/jpeg' });

    const result = await createPostWithFile({ jwt: 'tok', text: 'x', imageBlob });

    expect(result).toEqual({ ok: false, status: 0 });
  });
});
