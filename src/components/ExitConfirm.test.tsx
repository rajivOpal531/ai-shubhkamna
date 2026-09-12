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

  it('focuses the No button on mount', () => {
    render(<ExitConfirm onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /no/i })).toHaveFocus();
  });

  it('calls onCancel when Escape is pressed', async () => {
    const onCancel = vi.fn();
    render(<ExitConfirm onConfirm={vi.fn()} onCancel={onCancel} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('wraps Tab from Yes back to No', async () => {
    render(<ExitConfirm onConfirm={vi.fn()} onCancel={vi.fn()} />);
    screen.getByRole('button', { name: /yes/i }).focus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: /no/i })).toHaveFocus();
  });

  it('wraps Shift+Tab from No back to Yes', async () => {
    render(<ExitConfirm onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /no/i })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: /yes/i })).toHaveFocus();
  });

  it('restores focus to the previously focused element on unmount', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(<ExitConfirm onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(trigger).not.toHaveFocus();
    unmount();
    expect(trigger).toHaveFocus();

    document.body.removeChild(trigger);
  });
});
