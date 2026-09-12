import { config } from '../config';
import type { CreatePostResult } from '../types';

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

  const response = await fetch(config.createPostByUrlEndpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });

  return { ok: response.ok, status: response.status };
}

export async function createPostWithFile({ jwt, text, imageBlob }: CreatePostFileParams): Promise<CreatePostResult> {
  const form = new FormData();
  form.append('text', text);
  form.append('moduleType', 'AI Shubh');
  form.append('images', imageBlob, 'card.jpg');

  const response = await fetch(config.createPostFileEndpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });

  return { ok: response.ok, status: response.status };
}
