import { useEffect, useState } from 'react';
import type { CompositeResult } from '../types';
import './Preview.css';

const INSPIRE_MESSAGES = [
  "Happy Birthday to PM Shri Narendra Modi! Your visionary leadership and dedication to our nation's growth and development continue to inspire us all. Wish you many more years of service to the country.",
  'Wishing our PM a very Happy Birthday! Thank you for your tireless service to the nation.',
  'Happy Birthday PM Modi Ji! May you continue to lead India towards new heights.',
];

const WISH_MAX_LENGTH = 200;

type Props = {
  composited: CompositeResult;
  wish: string;
  onWishChange: (value: string) => void;
  posting: boolean;
  postError: string | null;
  onRetake: () => void;
  onPost: () => void;
};

export function Preview({ composited, wish, onWishChange, posting, postError, onRetake, onPost }: Props) {
  const [inspireIndex, setInspireIndex] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!composited.imageBlob) {
      setBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(composited.imageBlob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [composited.imageBlob]);

  const previewSrc = composited.imageUrl ?? blobUrl ?? '';

  function handleInspireMe() {
    const message = INSPIRE_MESSAGES[inspireIndex % INSPIRE_MESSAGES.length];
    const nextIndex = inspireIndex + 1;
    const isUserEditedText = wish.length > 0 && !INSPIRE_MESSAGES.includes(wish);
    if (!isUserEditedText) {
      onWishChange(message.slice(0, WISH_MAX_LENGTH));
    }
    setInspireIndex(nextIndex);
  }

  return (
    <div className="preview">
      <img className="preview__card" src={previewSrc} alt="Your birthday card" />

      <h3>Wishes for PM Modi</h3>
      <textarea
        value={wish}
        onChange={(event) => onWishChange(event.target.value.slice(0, WISH_MAX_LENGTH))}
        placeholder="Write your birthday wish for PM Modi"
      />
      <p>
        #HappyBirthdayPMModi #HappyBirthdayModiJi{' '}
        <button type="button" onClick={handleInspireMe}>
          Inspire me
        </button>
      </p>
      <p>
        {wish.length}/{WISH_MAX_LENGTH}
      </p>

      {postError && (
        <p className="preview__error" role="alert">
          {postError}
        </p>
      )}

      <div className="preview__actions">
        <button type="button" onClick={onRetake} disabled={posting}>
          Retake
        </button>
        <button type="button" onClick={onPost} disabled={posting}>
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}
