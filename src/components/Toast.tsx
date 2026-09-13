import { useEffect, useState } from 'react';
import './Toast.css';

type Props = {
  message: string;
  duration?: number;
  onDismiss: () => void;
};

export function Toast({ message, duration = 3000, onDismiss }: Props) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const hold = setTimeout(() => setLeaving(true), duration);
    return () => clearTimeout(hold);
  }, [duration]);

  useEffect(() => {
    if (!leaving) return;
    const gone = setTimeout(onDismiss, 300); // matches the slide-out animation
    return () => clearTimeout(gone);
  }, [leaving, onDismiss]);

  return (
    <div className={`toast${leaving ? ' toast--leaving' : ''}`} role="status">
      <span className="toast__dot" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path d="M20 6L9 17l-5-5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="toast__text">{message}</span>
      <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => setLeaving(true)}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="#6b6b6b" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
