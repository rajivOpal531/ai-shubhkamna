import { useEffect, useRef, useState } from 'react';
import './NameEditDialog.css';

type Props = {
  initialName: string;
  onSave: (name: string) => void;
  onCancel: () => void;
};

export function NameEditDialog({ initialName, onSave, onCancel }: Props) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="name-edit" role="dialog" aria-modal="true" aria-label="Edit display name">
      <div className="name-edit__backdrop" onClick={onCancel} />
      <div className="name-edit__panel">
        <h2 className="name-edit__title">Edit your name</h2>
        <input
          ref={inputRef}
          className="name-edit__input"
          value={value}
          maxLength={40}
          placeholder="Enter your name"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSave(value.trim());
            if (event.key === 'Escape') onCancel();
          }}
        />
        <div className="name-edit__actions">
          <button type="button" className="name-edit__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="name-edit__save" onClick={() => onSave(value.trim())}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
