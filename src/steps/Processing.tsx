import { useEffect, useState } from 'react';
import { compositePhoto } from '../services/composite';
import type { CompositeResult, Profile, Template } from '../types';
import './Processing.css';

type Props = {
  photo: Blob;
  template: Template;
  profile: Profile;
  onComposited: (result: CompositeResult) => void;
  onError: () => void;
};

export function Processing({ photo, template, profile, onComposited, onError }: Props) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    compositePhoto({ photo, templateId: template.id, templateImageUrl: template.image, profile })
      .then((result) => {
        if (!cancelled) onComposited(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, photo, template, profile, onComposited]);

  if (failed) {
    return (
      <div className="processing processing--error">
        <p>Something went wrong while creating your card.</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry
        </button>
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
