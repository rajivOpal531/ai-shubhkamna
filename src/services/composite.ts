import { config } from '../config';
import type { CompositeResult, Profile } from '../types';

type CompositeParams = {
  photo: Blob;
  templateId: string;
  templateImageUrl: string;
  profile: Profile;
};

type Options = {
  useMock?: boolean;
};

// Real endpoint is not available yet (docs/superpowers/specs/2026-09-12-ai-shubhkamna-design.md
// "Open integrations"). Field names below (`template`, `photo`, response `imageUrl`) are
// provisional pending the real contract - confirm against the actual endpoint once provided.
export async function compositePhoto(
  params: CompositeParams,
  { useMock = config.useMockComposite }: Options = {},
): Promise<CompositeResult> {
  return useMock ? mockCompositePhoto(params) : realCompositePhoto(params);
}

async function realCompositePhoto({ photo, templateId }: CompositeParams): Promise<CompositeResult> {
  const form = new FormData();
  form.append('template', templateId);
  form.append('photo', photo, 'photo.jpg');

  const response = await fetch(config.compositeUrl, { method: 'POST', body: form });
  if (!response.ok) {
    throw new Error(`Compositing failed with status ${response.status}`);
  }
  const data = (await response.json()) as { imageUrl: string };
  return { imageUrl: data.imageUrl };
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

  const [templateImg, photoImg] = await Promise.all([
    loadImage(templateImageUrl),
    loadImage(URL.createObjectURL(photo)),
  ]);

  ctx.drawImage(templateImg, 0, 0, canvas.width, canvas.height);
  ctx.drawImage(photoImg, canvas.width * 0.55, canvas.height * 0.45, canvas.width * 0.4, canvas.height * 0.5);

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve({ imageBlob: blob ?? photo }),
      'image/jpeg',
      0.92,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}
