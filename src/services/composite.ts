import { config } from '../config';
import type { CompositeResult, CutoutResult, Profile, Rect } from '../types';

export const COMPOSITE_TIMEOUT_MS = 60_000;

type CompositeParams = {
  photo: Blob;
  templateId: string;
  templateImageUrl: string;
  profile: Profile;
  jwt: string;
  signal?: AbortSignal;
};

function parseRect(raw: string | null): Rect | null {
  if (!raw) return null;
  const parts = raw.split(',').map((v) => Number(v));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = parts;
  return { x, y, w, h };
}

type Options = {
  useMock?: boolean;
};

export class CompositeError extends Error {
  readonly kind: 'http' | 'network' | 'config';

  constructor(
    message: string,
    readonly status: number | null,
    readonly requestId: string | null,
    kind?: 'http' | 'network' | 'config',
    // Machine-readable detail code from the server body for 4xx responses
    // (e.g. "no_face", "multiple_faces", "no_subject"); null when absent.
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'CompositeError';
    this.kind = kind ?? (typeof status === 'number' ? 'http' : 'network');
  }

  /**
   * A misconfiguration will fail again on retry, as will 400/401/413/415/422 (an unknown
   * template, an expired/invalid token, or the same photo, will fail identically); everything
   * else is worth a retry.
   */
  get retryable(): boolean {
    if (this.kind === 'config') return false;
    return this.status === null || ![400, 401, 413, 415, 422].includes(this.status);
  }
}

// Read the image bytes of a successful response. A 200 that isn't an image means a proxy/CDN masked an
// origin error as its SPA/HTML page (CloudFront serves index.html on origin errors); handing that to an
// <img> shows a broken card, so it becomes a retryable CompositeError instead.
async function readImageBody(response: Response, label: string): Promise<Blob> {
  const requestId = response.headers.get('X-Request-Id');
  if (!(response.headers.get('content-type') ?? '').includes('image/')) {
    throw new CompositeError(`${label} service returned an unexpected response`, response.status, requestId);
  }
  const blob = await response.blob();
  if (!blob.size) {
    throw new CompositeError(`${label} response was empty`, response.status, requestId);
  }
  return blob;
}

// Real endpoint: server/README.md ("API"). Multipart fields + bearer header; returns { imageUrl }.
export async function compositePhoto(
  params: CompositeParams,
  { useMock = config.useMockComposite }: Options = {},
): Promise<CompositeResult> {
  return useMock ? mockCompositePhoto(params) : realCompositePhoto(params);
}

async function realCompositePhoto({
  photo,
  templateId,
  profile,
  jwt,
  signal,
}: CompositeParams): Promise<CompositeResult> {
  if (!config.compositeUrl || config.compositeUrl.includes('<')) {
    throw new CompositeError(
      'VITE_COMPOSITE_URL is not configured (set it, or set VITE_USE_MOCK_COMPOSITE=true)',
      null,
      null,
      'config',
    );
  }

  const form = new FormData();
  form.append('template', templateId);
  form.append('photo', photo, 'photo.jpg');
  form.append('name', profile.username);
  form.append('constituency', profile.constituency);
  form.append('state', profile.state);

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), COMPOSITE_TIMEOUT_MS);
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  let response: Response | undefined;
  try {
    response = await fetch(config.compositeUrl, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${jwt}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      // Best-effort: the backend returns { detail: "<code>" } for 4xx so we can show a
      // specific message (no face / multiple faces / photo too large, etc.).
      let code: string | null = null;
      try {
        const body = (await response.clone().json()) as { detail?: unknown };
        if (typeof body?.detail === 'string') code = body.detail;
      } catch {
        // non-JSON body (e.g. a plain 413 from the proxy) -- leave code null
      }
      throw new CompositeError(
        `Compositing failed with status ${response.status}`,
        response.status,
        response.headers.get('X-Request-Id'),
        undefined,
        code,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = (await response.json()) as { imageUrl?: unknown };
      if (typeof data.imageUrl !== 'string' || !data.imageUrl) {
        throw new CompositeError(
          'Compositing response had no imageUrl',
          response.status,
          response.headers.get('X-Request-Id'),
        );
      }
      return { imageUrl: data.imageUrl, warning: response.headers.get('X-Poster-Warning') };
    }

    const blob = await readImageBody(response, 'Compositing');
    return { imageBlob: blob, warning: response.headers.get('X-Poster-Warning') };
  } catch (err) {
    if (err instanceof CompositeError) throw err;
    if (response) {
      throw new CompositeError(
        'Compositing response was not valid JSON',
        response.status,
        response.headers.get('X-Request-Id'),
      );
    }
    throw new CompositeError('Compositing request failed or timed out', null, null);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// --- Adjust-photo flow -----------------------------------------------------------------------

type FetchCutoutParams = {
  photo: Blob;
  templateId: string;
  jwt: string;
  signal?: AbortSignal;
};

// POST /cutout: background-remove the upload and return the transparent PNG plus the template's
// card/photo/text geometry, which the Adjust screen uses to place and constrain the cutout.
export async function fetchCutout({ photo, templateId, jwt, signal }: FetchCutoutParams): Promise<CutoutResult> {
  if (!config.cutoutUrl || config.cutoutUrl.includes('<')) {
    throw new CompositeError('VITE_COMPOSITE_URL is not configured', null, null, 'config');
  }

  const form = new FormData();
  form.append('template', templateId);
  form.append('photo', photo, 'photo.jpg');

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), COMPOSITE_TIMEOUT_MS);
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  let response: Response | undefined;
  try {
    response = await fetch(config.cutoutUrl, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${jwt}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      let code: string | null = null;
      try {
        const body = (await response.clone().json()) as { detail?: unknown };
        if (typeof body?.detail === 'string') code = body.detail;
      } catch {
        // non-JSON body -- leave code null
      }
      throw new CompositeError(
        `Cutout failed with status ${response.status}`,
        response.status,
        response.headers.get('X-Request-Id'),
        undefined,
        code,
      );
    }

    const cardParts = (response.headers.get('X-Card-Size') ?? '').split(',').map(Number);
    const photoBox = parseRect(response.headers.get('X-Photo-Box'));
    const textBox = parseRect(response.headers.get('X-Text-Box'));
    const blob = await readImageBody(response, 'Cutout');
    const cardValid = cardParts.length === 2 && cardParts.every((n) => Number.isFinite(n) && n > 0);
    if (!photoBox || !textBox || !cardValid) {
      throw new CompositeError('Cutout response was incomplete', response.status, response.headers.get('X-Request-Id'));
    }
    return {
      blob,
      cardWidth: cardParts[0],
      cardHeight: cardParts[1],
      photoBox,
      textBox,
      warning: response.headers.get('X-Poster-Warning'),
    };
  } catch (err) {
    if (err instanceof CompositeError) throw err;
    throw new CompositeError('Cutout request failed or timed out', null, null);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

type CompositeCutoutParams = {
  cutout: Blob;
  box: Rect;
  templateId: string;
  profile: Profile;
  jwt: string;
  signal?: AbortSignal;
};

// The /cutout PNG comes back at full processing resolution (up to ~2000px, several MB as lossless
// RGBA). A body that large gets rejected by a CDN/WAF/tunnel in front of the API (a 403 with no
// request id, unlike our own errors), while the small JPEG the camera path posts sails through. So
// re-encode the cutout to WebP -- it keeps the alpha channel the compositor needs but is a fraction
// of PNG's size -- at card scale. The backend decodes by content, not extension, so WebP is fine.
// Best-effort: any failure (no canvas / WebP unsupported) falls back to PNG, then to the original.
const CUTOUT_MAX_SIDE = 1080;

async function shrinkCutout(
  blob: Blob,
  maxSide: number = CUTOUT_MAX_SIDE,
): Promise<{ blob: Blob; filename: string }> {
  const asPng = { blob, filename: 'cutout.png' };
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return asPng;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return asPng;
  }
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return asPng;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (webp && webp.type === 'image/webp' && webp.size > 0) return { blob: webp, filename: 'cutout.webp' };
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return png ? { blob: png, filename: 'cutout.png' } : asPng;
  } catch {
    return asPng;
  } finally {
    bitmap.close?.();
  }
}

// POST /composite with a pre-made cutout + explicit box (the user-adjusted placement). Shares the
// response handling shape with realCompositePhoto: JSON { imageUrl } in url mode, JPEG bytes otherwise.
export async function compositeCutout({
  cutout,
  box,
  templateId,
  profile,
  jwt,
  signal,
}: CompositeCutoutParams): Promise<CompositeResult> {
  if (!config.compositeUrl || config.compositeUrl.includes('<')) {
    throw new CompositeError('VITE_COMPOSITE_URL is not configured', null, null, 'config');
  }

  const cutoutToSend = await shrinkCutout(cutout);

  const form = new FormData();
  form.append('template', templateId);
  form.append('cutout', cutoutToSend.blob, cutoutToSend.filename);
  form.append('box', `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.w)},${Math.round(box.h)}`);
  form.append('name', profile.username);
  form.append('constituency', profile.constituency);
  form.append('state', profile.state);

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), COMPOSITE_TIMEOUT_MS);
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  let response: Response | undefined;
  try {
    response = await fetch(config.compositeUrl, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${jwt}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      let code: string | null = null;
      try {
        const body = (await response.clone().json()) as { detail?: unknown };
        if (typeof body?.detail === 'string') code = body.detail;
      } catch {
        // non-JSON body -- leave code null
      }
      throw new CompositeError(
        `Compositing failed with status ${response.status}`,
        response.status,
        response.headers.get('X-Request-Id'),
        undefined,
        code,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = (await response.json()) as { imageUrl?: unknown };
      if (typeof data.imageUrl !== 'string' || !data.imageUrl) {
        throw new CompositeError('Compositing response had no imageUrl', response.status, response.headers.get('X-Request-Id'));
      }
      return { imageUrl: data.imageUrl, warning: response.headers.get('X-Poster-Warning') };
    }

    const blob = await readImageBody(response, 'Compositing');
    return { imageBlob: blob, warning: response.headers.get('X-Poster-Warning') };
  } catch (err) {
    if (err instanceof CompositeError) throw err;
    throw new CompositeError('Compositing request failed or timed out', null, null);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// Visual stand-in only: overlays the user's photo onto the chosen template so the flow is
// demoable before the real compositing endpoint exists. Placement is an approximation, not
// pixel-matched per template.
async function mockCompositePhoto({ photo, templateImageUrl }: CompositeParams): Promise<CompositeResult> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1260;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { imageBlob: photo };
  }

  const photoObjectUrl = URL.createObjectURL(photo);
  try {
    const [templateImg, photoImg] = await Promise.all([
      loadImage(templateImageUrl),
      loadImage(photoObjectUrl),
    ]);

    ctx.drawImage(templateImg, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(photoImg, canvas.width * 0.55, canvas.height * 0.45, canvas.width * 0.4, canvas.height * 0.5);

    return await new Promise((resolve) => {
      canvas.toBlob(
        (blob) => resolve({ imageBlob: blob ?? photo }),
        'image/jpeg',
        0.92,
      );
    });
  } finally {
    URL.revokeObjectURL(photoObjectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}
