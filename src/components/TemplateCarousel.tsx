import type { Template } from '../types';
import './TemplateCarousel.css';

type Props = {
  templates: Template[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function TemplateCarousel({ templates, selectedId, onSelect }: Props) {
  return (
    <div className="template-carousel" role="listbox" aria-label="Choose a frame">
      {templates.map((template) => {
        const selected = template.id === selectedId;
        return (
          <button
            key={template.id}
            type="button"
            role="option"
            aria-selected={selected}
            className={`template-carousel__item${selected ? ' template-carousel__item--selected' : ''}`}
            onClick={() => onSelect(template.id)}
          >
            <img src={template.image} alt={`Template ${template.id}`} />
          </button>
        );
      })}
    </div>
  );
}
