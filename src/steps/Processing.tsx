import { useEffect, useRef, useState } from 'react';
import { compositePhoto, CompositeError } from '../services/composite';
import { AppBackground } from '../components/AppBackground';
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
};

// Staged timing: the "Photo uploaded" tick appears quickly, the "Processing" loader shows for a
// beat, then we hand off to the "Hang tight" waiting screen, which stays until the real composited
// image is ready (however long the AI takes).
const UPLOAD_MS = 700;
const HANDOFF_MS = 2700;

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

function FaceErrorArt({ variant }: { variant: 'none' | 'many' }) {
  return (
    <svg className="processing__art" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
      <circle cx="48" cy="48" r="46" fill="#efe7fb" />
      {variant === 'none' ? (
        <>
          <circle cx="48" cy="42" r="16" fill="none" stroke="#4c3fbb" strokeWidth="3" />
          <path d="M28 74c2-11 10-17 20-17s18 6 20 17" fill="none" stroke="#4c3fbb" strokeWidth="3" strokeLinecap="round" />
          <path d="M20 20L76 76" stroke="#e0483c" strokeWidth="4" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="38" cy="42" r="13" fill="none" stroke="#4c3fbb" strokeWidth="3" />
          <circle cx="62" cy="42" r="13" fill="none" stroke="#4c3fbb" strokeWidth="3" />
          <path d="M24 76c1-8 7-13 14-13s13 5 14 13" fill="none" stroke="#4c3fbb" strokeWidth="3" strokeLinecap="round" />
          <path d="M44 76c1-8 7-13 14-13s13 5 14 13" fill="none" stroke="#4c3fbb" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function GenericErrorArt() {
  return (
    <svg className="processing__art" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
      <circle cx="48" cy="48" r="46" fill="#fdeceb" />
      <path d="M48 26v30" stroke="#e0483c" strokeWidth="6" strokeLinecap="round" />
      <circle cx="48" cy="68" r="4" fill="#e0483c" />
    </svg>
  );
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

export function Processing({
  jwt,
  photo,
  template,
  profile,
  photoSource = 'upload',
  onComposited,
  onError,
  onHome,
}: Props) {
  const [failure, setFailure] = useState<CompositeError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [uploadDone, setUploadDone] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const [result, setResult] = useState<CompositeResult | null>(null);
  const latest = useRef({ profile, onComposited, jwt });
  latest.current = { profile, onComposited, jwt };

  const retakeLabel = photoSource === 'capture' ? 'Retake' : 'Reupload';

  // Compositing request; on success we hold the result and let the staged animation finish first.
  useEffect(() => {
    let cancelled = false;
    setFailure(null);
    setUploadDone(false);
    setHandedOff(false);
    setResult(null);
    const controller = new AbortController();
    const uploadTimer = setTimeout(() => {
      if (!cancelled) setUploadDone(true);
    }, UPLOAD_MS);
    const handoffTimer = setTimeout(() => {
      if (!cancelled) setHandedOff(true);
    }, HANDOFF_MS);

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
      clearTimeout(handoffTimer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, photo, template.id, template.image]);

  useEffect(() => {
    if (failure) {
      console.error('compositing failed', failure.kind, failure.status, failure.code, failure.requestId);
    }
  }, [failure]);

  // Advance to the preview only once we are on the "Hang tight" screen AND the image is ready.
  useEffect(() => {
    if (handedOff && result) {
      latest.current.onComposited(result);
    }
  }, [handedOff, result]);

  if (failure) {
    const view = errorView(failure);
    const faceVariant = failure.code === 'no_face' ? 'none' : failure.code === 'multiple_faces' ? 'many' : null;
    return (
      <div className="processing processing--error" role="alert">
        <AppBackground />
        {faceVariant ? <FaceErrorArt variant={faceVariant} /> : <GenericErrorArt />}
        <h2 className="processing__error-title">{view.title}</h2>
        <p className="processing__error-body">{view.body}</p>
        <div className="processing__error-actions">
          {failure.retryable && (
            <button
              type="button"
              className="processing__btn processing__btn--primary"
              onClick={() => setAttempt((v) => v + 1)}
            >
              Try again
            </button>
          )}
          <button type="button" className="processing__btn processing__btn--primary" onClick={onError}>
            {retakeLabel}
          </button>
          {onHome && (
            <button type="button" className="processing__btn processing__btn--ghost" onClick={onHome}>
              Home
            </button>
          )}
        </div>
      </div>
    );
  }

  const processDone = result !== null;

  return (
    <div className="processing">
      <AppBackground />
      {handedOff ? (
        <div className="processing__finish">
          <span className="processing__finish-badge" aria-hidden="true">
            <span className="processing__spinner processing__spinner--lg" />
          </span>
          <h2 className="processing__finish-title">Hang tight!</h2>
          <p className="processing__finish-text">
            Our AI is working its magic to bring you something special. Check back in a little while!
          </p>
          <div className="processing__error-actions">
            <button type="button" className="processing__btn processing__btn--ghost" onClick={onHome ?? onError}>
              Go Back
            </button>
            <button type="button" className="processing__btn processing__btn--ghost" onClick={onError}>
              Restart
            </button>
          </div>
        </div>
      ) : (
        <div className="processing__steps" aria-live="polite">
          <h2 className="processing__heading">Creating your card</h2>
          <Step label="Photo uploaded" state={uploadDone ? 'done' : 'active'} />
          <Step label="Processing" state={processDone ? 'done' : uploadDone ? 'active' : 'pending'} />
        </div>
      )}
    </div>
  );
}
