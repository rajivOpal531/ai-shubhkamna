import { useEffect, useRef, useState } from 'react';
import './NameEditDialog.css';

const NAME_MAX_LENGTH = 40;

type Props = {
  initialName: string;
  onSave: (name: string) => void;
  onCancel: () => void;
};

export function NameEditDialog({ initialName, onSave, onCancel }: Props) {
  const [value, setValue] = useState(initialName.slice(0, NAME_MAX_LENGTH));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="name-edit" role="dialog" aria-modal="true" aria-label="Display name on the photo">
      <div className="name-edit__backdrop" onClick={onCancel} />
      <div className="name-edit__panel">
        <h2 className="name-edit__title">Display name on the photo</h2>
        <input
          ref={inputRef}
          className="name-edit__input"
          value={value}
          maxLength={NAME_MAX_LENGTH}
          placeholder="Enter your Name"
          onChange={(event) => setValue(event.target.value.slice(0, NAME_MAX_LENGTH))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSave(value.trim());
            if (event.key === 'Escape') onCancel();
          }}
        />
        <div className="name-edit__count">
          {value.length}/{NAME_MAX_LENGTH}
        </div>
        <div className="name-edit__actions">
          <button type="button" className="name-edit__back" onClick={onCancel}>
            Back
          </button>
          <button type="button" className="name-edit__confirm" onClick={() => onSave(value.trim())}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
