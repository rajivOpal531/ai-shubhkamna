import { useRef } from 'react';
import { TemplateCarousel } from '../components/TemplateCarousel';
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

  return (
    <div className="landing">
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
      <input
        id="display-name"
        className="landing__name-input"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder="Your name"
      />

      <div className="landing__actions">
        <button type="button" onClick={() => fileInputRef.current?.click()}>
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
        <button type="button" onClick={onCapture}>
          Capture
        </button>
      </div>
    </div>
  );
}
