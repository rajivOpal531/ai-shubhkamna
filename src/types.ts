export type Profile = {
  username: string;
  email: string;
  mobileno: string;
  state: string;
  constituency: string;
  district: string;
};

export type Template = {
  id: string;
  image: string;
};

export type CompositeResult = {
  imageUrl?: string;
  imageBlob?: Blob;
  warning?: string | null;
};

export type Rect = { x: number; y: number; w: number; h: number };

// Result of POST /cutout: the transparent PNG plus the template geometry (card coordinates) the
// "adjust photo" screen needs to position it.
export type CutoutResult = {
  blob: Blob;
  cardWidth: number;
  cardHeight: number;
  photoBox: Rect;
  textBox: Rect;
  warning?: string | null;
};

export type CreatePostResult = {
  ok: boolean;
  status: number;
};

export type Step = 'landing' | 'tips' | 'capture' | 'processing' | 'preview' | 'adjust';
