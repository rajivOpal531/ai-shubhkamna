import { useEffect, useState } from 'react';
import type { CompositeResult } from '../types';
import { InspireMeSheet } from '../components/InspireMeSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Toast } from '../components/Toast';
import { AppBackground } from '../components/AppBackground';
import { WISH_HASHTAGS, WISH_MAX_LENGTH } from '../data/wishes';
import './Preview.css';

type Props = {
  composited: CompositeResult;
  wish: string;
  onWishChange: (value: string) => void;
  posting: boolean;
  postError: string | null;
  photoSource: 'upload' | 'capture';
  onBack: () => void;
  showProcessedToast?: boolean;
  onDismissToast?: () => void;
  onRetake: () => void;
  onAdjust?: () => void;
  adjusting?: boolean;
  onPost: () => void;
};

export function Preview({
  composited,
  wish,
  onWishChange,
  posting,
  postError,
  photoSource,
  onBack,
  showProcessedToast = false,
  onDismissToast,
  onRetake,
  onAdjust,
  adjusting = false,
  onPost,
}: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);

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
  const atLimit = wish.length >= WISH_MAX_LENGTH;
  const retakeLabel = photoSource === 'capture' ? 'Retake' : 'Reupload';

  return (
    <div className="preview">
      <AppBackground />
      {showProcessedToast && (
        <Toast
          message="The last photo you uploaded has been processed successfully."
          onDismiss={onDismissToast ?? (() => undefined)}
        />
      )}
      <header className="preview__header">
        <button type="button" className="preview__back" aria-label="Back" onClick={onBack} disabled={posting}>
          ←
        </button>
        <h1>AI Shubhkamna</h1>
      </header>

      <img className="preview__card" src={previewSrc} alt="Your birthday card" />

      {onAdjust && (
        <button type="button" className="preview__adjust" onClick={onAdjust} disabled={posting || adjusting}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h11M4 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm12 10H5m11 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm0 0h4M8 7h12M4 17h1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {adjusting ? 'Preparing…' : 'Adjust photo'}
        </button>
      )}

      <h2 className="preview__title">Wishes for PM Modi</h2>

      <div className={`preview__field${atLimit ? ' preview__field--error' : ''}`}>
        <textarea
          value={wish}
          maxLength={WISH_MAX_LENGTH}
          onChange={(event) => onWishChange(event.target.value.slice(0, WISH_MAX_LENGTH))}
          placeholder="Write your birthday wish for PM Modi"
        />
        <div className="preview__field-footer">
          <span className="preview__hashtags">{WISH_HASHTAGS}</span>
          <button type="button" className="preview__inspire" onClick={() => setSheetOpen(true)}>
            Inspire me
          </button>
        </div>
      </div>

      <div className="preview__meta">
        {atLimit ? (
          <span className="preview__limit" role="alert">
            Maximum character limit exceeded
          </span>
        ) : (
          <span />
        )}
        <span className={`preview__count${atLimit ? ' preview__count--error' : ''}`}>
          {wish.length}/{WISH_MAX_LENGTH}
        </span>
      </div>

      {postError && (
        <p className="preview__error" role="alert">
          {postError}
        </p>
      )}

      <div className="preview__actions">
        <button type="button" className="preview__retake" onClick={() => setConfirmBack(true)} disabled={posting}>
          {retakeLabel}
        </button>
        <button type="button" className="preview__post" onClick={onPost} disabled={posting}>
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>

      {sheetOpen && (
        <InspireMeSheet
          selected={wish}
          onSelect={(message) => {
            onWishChange(message.slice(0, WISH_MAX_LENGTH));
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {confirmBack && (
        <ConfirmDialog
          message="All your progress will be lost, do you want to go back?"
          confirmLabel="Go back"
          cancelLabel="Cancel"
          onConfirm={onRetake}
          onCancel={() => setConfirmBack(false)}
        />
      )}
    </div>
  );
}
