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

function errorMessage(failure: CompositeError): string {
  if (failure.kind === 'config') {
    return "This feature isn't set up correctly yet. Please try again later.";
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

export function Processing({ jwt, photo, template, profile, onComposited, onError }: Props) {
  const [failure, setFailure] = useState<CompositeError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ profile, onComposited, jwt });
  // Deliberate render-phase mutation: keeps `latest` current for the effect below without
  // retriggering it; idempotent since it always assigns the same shape from this render's props.
  latest.current = { profile, onComposited, jwt };

  useEffect(() => {
    let cancelled = false;
    setFailure(null);
    const controller = new AbortController();

    compositePhoto({
      photo,
      templateId: template.id,
      templateImageUrl: template.image,
      profile: latest.current.profile,
      jwt: latest.current.jwt,
      signal: controller.signal,
    })
      .then((result) => {
        if (!cancelled) latest.current.onComposited(result);
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) return;
        setFailure(error instanceof CompositeError ? error : new CompositeError(String(error), null, null));
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, photo, template.id, template.image]);

  useEffect(() => {
    if (failure) {
      console.error('compositing failed', failure.kind, failure.status, failure.requestId);
    }
  }, [failure]);

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

  return (
    <div className="processing">
      <p>Uploading</p>
      <p>Processing</p>
      <p>Creating your perfect photo with PM Modi</p>
      <p>It is worth the wait!</p>
    </div>
  );
}
