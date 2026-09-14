import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemplateCarousel } from './TemplateCarousel';
import type { Template } from '../types';

const TEMPLATES: Template[] = [
  { id: 't1', image: 'data:image/png;base64,aaa', cleanImage: 'data:image/png;base64,aaa' },
  { id: 't2', image: 'data:image/png;base64,bbb', cleanImage: 'data:image/png;base64,bbb' },
  { id: 't3', image: 'data:image/png;base64,ccc', cleanImage: 'data:image/png;base64,ccc' },
];

describe('TemplateCarousel', () => {
  it('renders one option per template and marks the selected one', () => {
    render(<TemplateCarousel templates={TEMPLATES} selectedId="t1" onSelect={vi.fn()} />);
    const options = screen.getAllByRole('button');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('aria-pressed', 'true');
    expect(options[1]).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onSelect with the clicked template id', async () => {
    const onSelect = vi.fn();
    render(<TemplateCarousel templates={TEMPLATES} selectedId="t1" onSelect={onSelect} />);
    await userEvent.click(screen.getAllByRole('button')[1]);
    expect(onSelect).toHaveBeenCalledWith('t2');
  });
});
