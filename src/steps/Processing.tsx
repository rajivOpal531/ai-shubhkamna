import { useEffect, useRef, useState } from 'react';
import { compositePhoto, CompositeError } from '../services/composite';
import type { CompositeResult, Profile, Template } from '../types';
import './Processing.css';

type Props = {
  jwt: string;
  photo: Blob;
  template: Template;
  profile: Profile;
  onComposited: (result: CompositeResult) => void;
  onError: () => void;
};

// Minimum times each animated stage is shown so the tick/loader sequence is legible
// even when the real compositing call returns very quickly.
const UPLOAD_MS = 700;
const FINISH_MS = 1100;

function errorMessage(failure: CompositeError): string {
  if (failure.kind === 'config') {
    return "This feature isn't set up correctly yet. Please try again later.";
  }
  if (failure.kind === 'network') {
    return "We couldn't reach the card service. Please check your connection and try again.";
  }
  switch (failure.status) {
    case 422:
      return "We couldn't find a person in that photo. Please try a clearer photo with just you in the frame.";
    case 413:
      return 'That photo is too large. Please choose a smaller one.';
    case 415:
      return "We couldn't read that photo. Please choose a JPEG or PNG.";
    case 401:
      return 'Your session has expired. Please go back to the app and open this page again.';
    case 429:
    case 503:
      return 'The service is busy right now. Please wait a moment and try again.';
    default:
      return 'Something went wrong while creating your card.';
  }
}

function Step({ label, state }: { label: string; state: 'pending' | 'active' | 'done' }) {
  return (
    <div className={`processing__step processing__step--${state}`}>
      <span className="processing__step-icon" aria-hidden="true">
        {state === 'done' ? (
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path d="M20 6L9 17l-5-5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : state === 'active' ? (
          <span className="processing__spinner" />
        ) : null}
      </span>
      <span className="processing__step-label">{label}</span>
    </div>
  );
}

export function Processing({ jwt, photo, template, profile, onComposited, onError }: Props) {
  const [failure, setFailure] = useState<CompositeError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [uploadDone, setUploadDone] = useState(false);
  const [result, setResult] = useState<CompositeResult | null>(null);
  const latest = useRef({ profile, onComposited, jwt });
  latest.current = { profile, onComposited, jwt };

  // Compositing request (unchanged behaviour); on success we hold the result and let the
  // staged animation below finish before advancing to the preview.
  useEffect(() => {
    let cancelled = false;
    setFailure(null);
    setUploadDone(false);
    setResult(null);
    const controller = new AbortController();
    const uploadTimer = setTimeout(() => {
      if (!cancelled) setUploadDone(true);
    }, UPLOAD_MS);

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
      clearTimeout(uploadTimer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, photo, template.id, template.image]);

  useEffect(() => {
    if (failure) {
      console.error('compositing failed', failure.kind, failure.status, failure.requestId);
    }
  }, [failure]);

  // Once the card is ready and the upload stage has shown, hold the "Hang tight" finish, then advance.
  const finishing = uploadDone && result !== null;
  useEffect(() => {
    if (!finishing || !result) return;
    const timer = setTimeout(() => latest.current.onComposited(result), FINISH_MS);
    return () => clearTimeout(timer);
  }, [finishing, result]);

  if (failure) {
    return (
      <div className="processing processing--error" role="alert">
        <p>{errorMessage(failure)}</p>
        {failure.retryable && (
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </button>
        )}
        <button type="button" onClick={onError}>
          Retake photo
        </button>
      </div>
    );
  }

  const processDone = result !== null;

  return (
    <div className="processing">
      {finishing ? (
        <div className="processing__finish">
          <span className="processing__finish-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path d="M20 6L9 17l-5-5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h2 className="processing__finish-title">Hang tight!</h2>
          <p className="processing__finish-text">Creating your perfect photo with PM Modi. It is worth the wait!</p>
        </div>
      ) : (
        <div className="processing__steps" aria-live="polite">
          <h2 className="processing__heading">Creating your card</h2>
          <Step label="Photo uploaded" state={uploadDone ? 'done' : 'active'} />
          <Step
            label="Processing with PM Modi"
            state={processDone ? 'done' : uploadDone ? 'active' : 'pending'}
          />
        </div>
      )}
    </div>
  );
}
