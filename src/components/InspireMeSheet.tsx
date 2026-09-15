import { useEffect } from 'react';
import { POPULAR_MESSAGES } from '../data/wishes';
import type { TrackFn } from '../services/analytics';
import './InspireMeSheet.css';

type Props = {
  selected: string | null;
  onSelect: (message: string) => void;
  onClose: () => void;
  track?: TrackFn;
};

export function InspireMeSheet({ selected, onSelect, onClose, track }: Props) {
  useEffect(() => {
    track?.('pageload');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dismissing the sheet (backdrop, close button, or Escape) is the "cross" action.
  const close = () => {
    track?.('cross');
    onClose();
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="inspire-sheet" role="dialog" aria-modal="true" aria-label="Popular Messages">
      <div className="inspire-sheet__backdrop" onClick={close} />
      <div className="inspire-sheet__panel">
        <header className="inspire-sheet__header">
          <h2>Popular Messages</h2>
          <button type="button" className="inspire-sheet__close" aria-label="Close" onClick={close}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <ul className="inspire-sheet__list">
          {POPULAR_MESSAGES.map((message) => {
            const isSelected = message === selected;
            return (
              <li key={message}>
                <button
                  type="button"
                  className="inspire-sheet__item"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => {
                    track?.('select_option', { caption: message });
                    onSelect(message);
                  }}
                >
                  <span className="inspire-sheet__text">{message}</span>
                  <span
                    className={`inspire-sheet__radio${isSelected ? ' inspire-sheet__radio--on' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
