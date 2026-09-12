import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExitConfirm } from './ExitConfirm';

describe('ExitConfirm', () => {
  it('calls onConfirm when Yes is clicked', async () => {
    const onConfirm = vi.fn();
    render(<ExitConfirm onConfirm={onConfirm} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /yes/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when No is clicked', async () => {
    const onCancel = vi.fn();
    render(<ExitConfirm onConfirm={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: /no/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
