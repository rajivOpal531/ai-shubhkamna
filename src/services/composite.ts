import { config } from '../config';
import type { CompositeResult, Profile } from '../types';

export const COMPOSITE_TIMEOUT_MS = 60_000;

type CompositeParams = {
  photo: Blob;
  templateId: string;
  templateImageUrl: string;
  profile: Profile;
  jwt: string;
  signal?: AbortSignal;
};

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
      throw new CompositeError(
        `Compositing failed with status ${response.status}`,
        response.status,
        response.headers.get('X-Request-Id'),
      );
    }

    const data = (await response.json()) as { imageUrl?: unknown };
    if (typeof data.imageUrl !== 'string' || !data.imageUrl) {
      throw new CompositeError(
        'Compositing response had no imageUrl',
        response.status,
        response.headers.get('X-Request-Id'),
      );
    }
    return { imageUrl: data.imageUrl };
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
