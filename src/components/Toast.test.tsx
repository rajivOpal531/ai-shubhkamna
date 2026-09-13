import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Toast } from './Toast';

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the message and auto-dismisses after the duration + slide-out', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Processed successfully" duration={3000} onDismiss={onDismiss} />);
    expect(screen.getByText('Processed successfully')).toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(3000));
    expect(onDismiss).not.toHaveBeenCalled(); // slide-out in progress
    act(() => vi.advanceTimersByTime(300));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('dismisses when the close button is clicked', () => {
    const onDismiss = vi.fn();
    render(<Toast message="x" onDismiss={onDismiss} />);
    act(() => screen.getByRole('button', { name: /dismiss/i }).click());
    act(() => vi.advanceTimersByTime(300));
    expect(onDismiss).toHaveBeenCalled();
  });
});
