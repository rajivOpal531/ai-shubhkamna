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
    photoSource: 'upload' as const,
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

  it('shows the passive hashtags inside the field', () => {
    renderPreview();
    expect(screen.getByText('#HappyBirthdayPMModi #HappyBirthdayModiJi')).toBeInTheDocument();
  });

  it('opens the Popular Messages sheet and applies a selected message', async () => {
    const onWishChange = vi.fn();
    renderPreview({ onWishChange });
    await userEvent.click(screen.getByRole('button', { name: /inspire me/i }));
    expect(screen.getByRole('dialog', { name: /popular messages/i })).toBeInTheDocument();
    const options = screen.getAllByRole('radio');
    expect(options.length).toBeGreaterThan(0);
    await userEvent.click(options[0]);
    expect(onWishChange).toHaveBeenCalledWith(expect.stringMatching(/birthday/i));
    expect(screen.queryByRole('dialog', { name: /popular messages/i })).not.toBeInTheDocument();
  });

  it('shows the character counter and the limit error at 200 chars', () => {
    renderPreview({ wish: 'a'.repeat(200) });
    expect(screen.getByText('200/200')).toBeInTheDocument();
    expect(screen.getByText(/maximum character limit exceeded/i)).toBeInTheDocument();
  });

  it('labels the secondary button by photo source', () => {
    const { unmount } = render(
      <Preview
        composited={{ imageUrl: 'x' }}
        wish=""
        onWishChange={vi.fn()}
        posting={false}
        postError={null}
        photoSource="upload"
        onRetake={vi.fn()}
        onPost={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /reupload/i })).toBeInTheDocument();
    unmount();
    render(
      <Preview
        composited={{ imageUrl: 'x' }}
        wish=""
        onWishChange={vi.fn()}
        posting={false}
        postError={null}
        photoSource="capture"
        onRetake={vi.fn()}
        onPost={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /retake/i })).toBeInTheDocument();
  });

  it('disables Post and the secondary button while posting, and shows a posting error', () => {
    renderPreview({ posting: true, postError: "We couldn't post your card. Please try again." });
    expect(screen.getByRole('button', { name: /posting/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reupload/i })).toBeDisabled();
    expect(screen.getByText(/couldn't post your card/i)).toBeInTheDocument();
  });

  it('calls onPost when Post is clicked', async () => {
    const onPost = vi.fn();
    renderPreview({ onPost });
    await userEvent.click(screen.getByRole('button', { name: /^post$/i }));
    expect(onPost).toHaveBeenCalled();
  });
});
