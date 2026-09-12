import { config } from '../config';
import type { CreatePostResult } from '../types';

// Post failure is an expected, user-recoverable state per the design spec (inline error, retry)
// - return a result instead of throwing, unlike profile.ts/composite.ts. This includes network-
// level failures (offline, DNS, CORS): they're folded into the same {ok: false, status} shape
// (status: 0 as the network-failure sentinel) so callers never need their own try/catch.

type CreatePostByImageUrlParams = {
  jwt: string;
  text: string;
  imageUrl: string;
  templateId: string;
  lang?: string;
};

type CreatePostFileParams = {
  jwt: string;
  text: string;
  imageBlob: Blob;
};

export async function createPostByImageUrl({
  jwt,
  text,
  imageUrl,
  templateId,
  lang = 'en',
}: CreatePostByImageUrlParams): Promise<CreatePostResult> {
  const form = new FormData();
  form.append('text', text);
  form.append('image', imageUrl);
  form.append('template', templateId);
  form.append('moduleType', 'AI Shubh');
  form.append('lang', lang);

  try {
    const response = await fetch(config.createPostByUrlEndpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function createPostWithFile({ jwt, text, imageBlob }: CreatePostFileParams): Promise<CreatePostResult> {
  const form = new FormData();
  form.append('text', text);
  form.append('moduleType', 'AI Shubh');
  form.append('images', imageBlob, 'card.jpg');

  try {
    const response = await fetch(config.createPostFileEndpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
