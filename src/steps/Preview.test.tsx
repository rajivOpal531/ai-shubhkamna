import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Preview } from './Preview';

function renderPreview(overrides: Partial<React.ComponentProps<typeof Preview>> = {}) {
  const props = {
    composited: { imageUrl: 'https://cdn.narendramodi.in/shubhkamna2026/card.jpg' },
    wish: '',
    onWishChange: vi.fn(),
    posting: false,
    postError: null,
    onRetake: vi.fn(),
    onPost: vi.fn(),
    ...overrides,
  };
  render(<Preview {...props} />);
  return props;
}

describe('Preview', () => {
  it('shows the composited image from imageUrl', () => {
    renderPreview();
    expect(screen.getByAltText(/your birthday card/i)).toHaveAttribute(
      'src',
      'https://cdn.narendramodi.in/shubhkamna2026/card.jpg',
    );
  });

  it('truncates wish text at 200 characters', async () => {
    const onWishChange = vi.fn();
    renderPreview({ onWishChange });
    const longText = 'a'.repeat(210);
    await userEvent.type(screen.getByPlaceholderText(/write your birthday wish/i), longText);
    const lastCall = onWishChange.mock.calls.at(-1)?.[0] as string;
    expect(lastCall.length).toBeLessThanOrEqual(200);
  });

  it('fills the wish field with a preset message when Inspire me is clicked', async () => {
    const onWishChange = vi.fn();
    renderPreview({ onWishChange });
    await userEvent.click(screen.getByRole('button', { name: /inspire me/i }));
    expect(onWishChange).toHaveBeenCalledWith(expect.stringMatching(/\w+/));
  });

  it('disables Post and Retake while posting, and shows a posting error', () => {
    renderPreview({ posting: true, postError: "We couldn't post your card. Please try again." });
    expect(screen.getByRole('button', { name: /posting/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /retake/i })).toBeDisabled();
    expect(screen.getByText(/couldn't post your card/i)).toBeInTheDocument();
  });

  it('calls onPost when Post is clicked', async () => {
    const onPost = vi.fn();
    renderPreview({ onPost });
    await userEvent.click(screen.getByRole('button', { name: /^post$/i }));
    expect(onPost).toHaveBeenCalled();
  });
});
