import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tips } from './Tips';

describe('Tips', () => {
  it('lists all six photo tips', () => {
    render(<Tips onProceed={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
  });

  it('calls onProceed when Proceed is clicked', async () => {
    const onProceed = vi.fn();
    render(<Tips onProceed={onProceed} onBack={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /proceed/i }));
    expect(onProceed).toHaveBeenCalled();
  });
});
