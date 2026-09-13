import { useRef, useState } from 'react';
import { TemplateCarousel } from '../components/TemplateCarousel';
import { AppBackground } from '../components/AppBackground';
import { NameEditDialog } from '../components/NameEditDialog';
import editIcon from '../assets/edit-icon.png';
import { templates } from '../data/templates';
import './Landing.css';

type Props = {
  name: string;
  onNameChange: (value: string) => void;
  selectedTemplateId: string;
  onSelectTemplate: (id: string) => void;
  onCapture: () => void;
  onFileSelected: (file: File) => void;
  onBack: () => void;
};

export function Landing({
  name,
  onNameChange,
  selectedTemplateId,
  onSelectTemplate,
  onCapture,
  onFileSelected,
  onBack,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingName, setEditingName] = useState(false);

  return (
    <div className="landing">
      <AppBackground />
      <header className="landing__header">
        <button type="button" aria-label="Back" onClick={onBack}>
          ←
        </button>
        <h1>AI Shubhkamna</h1>
      </header>

      <h2 className="landing__title">Join the nation in wishing PM Modi on his Birthday</h2>
      <p className="landing__subtitle">
        Craft your personalised card and make PM Modi&apos;s birthday a moment to remember!
      </p>

      <h3 className="landing__section-label">Choose a frame</h3>
      <TemplateCarousel templates={templates} selectedId={selectedTemplateId} onSelect={onSelectTemplate} />

      <label className="landing__name-label" htmlFor="display-name">
        Display name on the photo
      </label>
      <div className="landing__name-field">
        <input
          id="display-name"
          className="landing__name-input"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Enter your Name"
        />
        <button
          type="button"
          className="landing__name-edit"
          aria-label="Edit name"
          onClick={() => setEditingName(true)}
        >
          <img src={editIcon} alt="" width="18" height="18" />
        </button>
      </div>

      <div className="landing__actions">
        <button type="button" className="landing__upload" onClick={() => fileInputRef.current?.click()}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M12 16V4m0 0l-4 4m4-4l4 4M5 20h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          data-testid="landing-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onFileSelected(file);
            }
            event.target.value = '';
          }}
        />
        <button type="button" className="landing__capture" onClick={onCapture}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          Capture
        </button>
      </div>

      {editingName && (
        <NameEditDialog
          initialName={name}
          onSave={(value) => {
            onNameChange(value);
            setEditingName(false);
          }}
          onCancel={() => setEditingName(false)}
        />
      )}
    </div>
  );
}
