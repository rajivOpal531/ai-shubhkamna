import { useEffect, useRef, useState } from 'react';
import { compositePhoto, CompositeError } from '../services/composite';
import gearsArt from '../assets/processing-gears.png';
import hangTightArt from '../assets/hang-tight.png';
import faceScanArt from '../assets/error-face-scan.png';
import genericErrorArt from '../assets/error-generic.png';
import type { CompositeResult, Profile, Template } from '../types';
import './Processing.css';

type Props = {
  jwt: string;
  photo: Blob;
  template: Template;
  profile: Profile;
  photoSource?: 'upload' | 'capture';
  onComposited: (result: CompositeResult) => void;
  onError: () => void;
  onHome?: () => void;
  onRestart?: () => void;
};

// The "Processing" screen is shown while compositing. If it runs longer than this, we switch to
// the "Hang tight" screen (with Go Back / Restart) so a slow request never looks stuck.
const SLOW_AFTER_MS = 60_000;

type ErrorView = { title: string; body: string };

function errorView(failure: CompositeError): ErrorView {
  if (failure.kind === 'config') {
    return { title: 'Not available yet', body: "This feature isn't set up correctly yet. Please try again later." };
  }
  if (failure.kind === 'network') {
    return {
      title: 'Connection problem',
      body: "We couldn't reach the card service. Please check your connection and try again.",
    };
  }
  switch (failure.code) {
    case 'no_face':
      return {
        title: 'No face detected',
        body: "We couldn't find a face in your photo. Please use a clear, front-facing photo with your face visible.",
      };
    case 'multiple_faces':
      return {
        title: 'Multiple faces detected',
        body: 'We found more than one person in the photo. Please use a photo with only you in the frame.',
      };
  }
  switch (failure.status) {
    case 422:
      return {
        title: "We couldn't find you",
        body: "We couldn't find a person in that photo. Please try a clearer photo with just you in the frame.",
      };
    case 413:
      return { title: 'Photo too large', body: 'That photo is too large. Please choose a smaller one.' };
    case 415:
      return { title: 'Unsupported photo', body: "We couldn't read that photo. Please choose a JPEG or PNG." };
    case 401:
      return {
        title: 'Session expired',
        body: 'Your session has expired. Please go back to the app and open this page again.',
      };
    case 429:
    case 503:
      return { title: 'Service busy', body: 'The service is busy right now. Please wait a moment and try again.' };
    default:
      return { title: 'Something went wrong', body: 'Something went wrong while creating your card.' };
  }
}

const BackIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const RestartIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d="M4 12a8 8 0 1 1 2.3 5.6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M4 20v-4h4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function Processing({
  jwt,
  photo,
  template,
  profile,
  photoSource = 'upload',
  onComposited,
  onError,
  onHome,
  onRestart,
}: Props) {
  const [failure, setFailure] = useState<CompositeError | null>(null);
  const [result, setResult] = useState<CompositeResult | null>(null);
  const [slow, setSlow] = useState(false);
  const latest = useRef({ profile, onComposited, jwt });
  latest.current = { profile, onComposited, jwt };

  const retakeLabel = photoSource === 'capture' ? 'Retake' : 'Reupload';

  useEffect(() => {
    let cancelled = false;
    setFailure(null);
    setResult(null);
    setSlow(false);
    const controller = new AbortController();
    const slowTimer = setTimeout(() => {
      if (!cancelled) setSlow(true);
    }, SLOW_AFTER_MS);

    compositePhoto({
      photo,
      templateId: template.id,
      templateImageUrl: template.image,
      profile: latest.current.profile,
      jwt: latest.current.jwt,
      signal: controller.signal,
    })
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) return;
        setFailure(error instanceof CompositeError ? error : new CompositeError(String(error), null, null));
      });

    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, template.id, template.image]);

  useEffect(() => {
    if (failure) {
      console.error('compositing failed', failure.kind, failure.status, failure.code, failure.requestId);
    }
  }, [failure]);

  // Advance to the preview as soon as the composited image is ready.
  useEffect(() => {
    if (result) {
      latest.current.onComposited(result);
    }
  }, [result]);

  if (failure) {
    const view = errorView(failure);
    const faceVariant = failure.code === 'no_face' ? 'none' : failure.code === 'multiple_faces' ? 'many' : null;
    return (
      <div className="processing processing--error" role="alert">
        <div className="processing__sheet">
          <img className="processing__sheet-art" src={faceVariant ? faceScanArt : genericErrorArt} alt="" />
          <h2 className="processing__sheet-title">{view.title}</h2>
          {!faceVariant && view.body && <p className="processing__sheet-body">{view.body}</p>}
          <div className="processing__sheet-actions">
            {onHome && (
              <button type="button" className="processing__sheet-home" onClick={onHome}>
                Home
              </button>
            )}
            <button type="button" className="processing__sheet-retake" onClick={onError}>
              {retakeLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="processing processing--loading" aria-live="polite">
      {slow ? (
        <div className="processing__finish">
          <img className="processing__finish-art" src={hangTightArt} alt="" aria-hidden="true" />
          <h2 className="processing__finish-title">Hang tight!</h2>
          <p className="processing__finish-text">Our AI is working its magic to bring you something special.</p>
          <p className="processing__finish-text processing__finish-text--muted">Check back in a little while!</p>
          <div className="processing__ht-actions">
            <button type="button" className="processing__ht-btn processing__ht-btn--back" onClick={onHome ?? onError}>
              <BackIcon />
              Go Back
            </button>
            <button
              type="button"
              className="processing__ht-btn processing__ht-btn--restart"
              onClick={onRestart ?? onError}
            >
              <RestartIcon />
              Restart
            </button>
          </div>
        </div>
      ) : (
        <div className="processing__finish">
          <img className="processing__gears" src={gearsArt} alt="" aria-hidden="true" />
          <h2 className="processing__proc-title">Processing</h2>
          <p className="processing__finish-text">Creating your perfect photo with PM Modi</p>
          <p className="processing__finish-text processing__finish-text--muted">It is worth the wait!</p>
        </div>
      )}
    </div>
  );
}
