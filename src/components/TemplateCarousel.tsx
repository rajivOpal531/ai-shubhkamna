import type { Template } from '../types';
import './TemplateCarousel.css';

type Props = {
  templates: Template[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function TemplateCarousel({ templates, selectedId, onSelect }: Props) {
  return (
    <div className="template-carousel">
      {templates.map((template) => {
        const selected = template.id === selectedId;
        return (
          <button
            key={template.id}
            type="button"
            aria-pressed={selected}
            className={`template-carousel__item${selected ? ' template-carousel__item--selected' : ''}`}
            onClick={() => onSelect(template.id)}
          >
            <img src={template.image} alt={`Template ${template.id}`} />
            {selected && (
              <span className="template-carousel__check" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path
                    d="M20 6L9 17l-5-5"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
