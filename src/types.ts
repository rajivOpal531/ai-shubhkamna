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
};

export type CreatePostResult = {
  ok: boolean;
  status: number;
};

export type Step = 'landing' | 'tips' | 'capture' | 'processing' | 'preview';
