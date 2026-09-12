import { config } from '../config';
import type { CompositeResult, Profile } from '../types';

type CompositeParams = {
  photo: Blob;
  templateId: string;
  templateImageUrl: string;
  profile: Profile;
  jwt: string;
};

type Options = {
  useMock?: boolean;
};

// Real endpoint: server/README.md ("API"). Multipart fields + bearer header; returns { imageUrl }.
export async function compositePhoto(
  params: CompositeParams,
  { useMock = config.useMockComposite }: Options = {},
): Promise<CompositeResult> {
  return useMock ? mockCompositePhoto(params) : realCompositePhoto(params);
}

async function realCompositePhoto({ photo, templateId, profile, jwt }: CompositeParams): Promise<CompositeResult> {
  const form = new FormData();
  form.append('template', templateId);
  form.append('photo', photo, 'photo.jpg');
  form.append('name', profile.username);
  form.append('constituency', profile.constituency);
  form.append('state', profile.state);

  const response = await fetch(config.compositeUrl, {
    method: 'POST',
    body: form,
    headers: { Authorization: `Bearer ${jwt}` },
  });
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
