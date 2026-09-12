import { useEffect, useRef } from 'react';
import './ExitConfirm.css';

type Props = {
  onConfirm: () => void;
  onCancel: () => void;
};

export function ExitConfirm({ onConfirm, onCancel }: Props) {
  const noButtonRef = useRef<HTMLButtonElement>(null);
  const yesButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement;
    noButtonRef.current?.focus();

    return () => {
      if (previouslyFocusedRef.current instanceof HTMLElement) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;

    if (event.shiftKey && document.activeElement === noButtonRef.current) {
      event.preventDefault();
      yesButtonRef.current?.focus();
    } else if (!event.shiftKey && document.activeElement === yesButtonRef.current) {
      event.preventDefault();
      noButtonRef.current?.focus();
    }
  }

  return (
    <div className="exit-confirm" role="dialog" aria-label="Exit confirmation" onKeyDown={handleKeyDown}>
      <div className="exit-confirm__panel">
        <p>Are you sure you want to Exit?</p>
        <div>
          <button type="button" ref={noButtonRef} onClick={onCancel}>
            No
          </button>
          <button type="button" ref={yesButtonRef} onClick={onConfirm}>
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
