// Shrink a photo in the browser before uploading it. Phone photos are 3-12 MP (several MB); the card
// only ever uses a ~600px-wide cutout and the backend caps processing at 2000px anyway, so sending a
// smaller image cuts upload time, background-removal time, and the chance of a slow request being
// truncated ("corrupt" card) or timing out.
//
// Best-effort and non-destructive: any problem (unsupported format like HEIC in this browser, a canvas
// limit, no createImageBitmap) returns the ORIGINAL blob unchanged, so the flow never breaks and the
// backend still receives a valid photo (it handles HEIC and EXIF orientation itself).

const DEFAULT_MAX_SIDE = 1600;
const DEFAULT_QUALITY = 0.85;

export async function downscaleImage(
  file: Blob,
  maxSide: number = DEFAULT_MAX_SIDE,
  quality: number = DEFAULT_QUALITY,
): Promise<Blob> {
  // No createImageBitmap (older WebViews / jsdom) -> skip, let the backend handle the original.
  if (typeof createImageBitmap !== 'function') return file;

  let bitmap: ImageBitmap;
  try {
    // imageOrientation:'from-image' bakes in EXIF rotation so the re-encoded JPEG (which drops EXIF)
    // is upright. HEIC etc. that the browser can't decode throws here -> caught -> original returned.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= maxSide) return file; // already small enough; don't re-encode (avoid quality loss)

    const scale = maxSide / longest;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    // Only use the result if it actually came back smaller; otherwise keep the original.
    return blob && blob.size > 0 && blob.size < file.size ? blob : file;
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}
