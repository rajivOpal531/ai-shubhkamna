import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useCameraMock = vi.fn();
vi.mock('../hooks/useCamera', () => ({ useCamera: () => useCameraMock() }));

import { Capture } from './Capture';

describe('Capture', () => {
  beforeEach(() => {
    useCameraMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a fallback and lets the user switch to Upload when the camera errors', async () => {
    useCameraMock.mockReturnValue({ stream: null, error: 'Permission denied' });
    const onUseUploadInstead = vi.fn();
    render(<Capture onCaptured={vi.fn()} onBack={vi.fn()} onUseUploadInstead={onUseUploadInstead} />);

    expect(screen.getByText(/couldn't access your camera/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /upload instead/i }));
    expect(onUseUploadInstead).toHaveBeenCalled();
  });

  it('captures a photo from the video feed when the shutter is pressed', async () => {
    // jsdom never actually loads media, so readyState stays at HAVE_NOTHING (0)
    // even once a stream is attached. Stub it to simulate a frame being available,
    // matching the real-browser state the production readiness guard checks for.
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(2);

    useCameraMock.mockReturnValue({ stream: {} as MediaStream, error: null });
    const onCaptured = vi.fn();
    render(<Capture onCaptured={onCaptured} onBack={vi.fn()} onUseUploadInstead={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /shutter/i }));
    expect(onCaptured).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('calls onBack when close is clicked', async () => {
    useCameraMock.mockReturnValue({ stream: {} as MediaStream, error: null });
    const onBack = vi.fn();
    render(<Capture onCaptured={vi.fn()} onBack={onBack} onUseUploadInstead={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('disables the shutter button while the camera has not resolved a stream yet', () => {
    useCameraMock.mockReturnValue({ stream: null, error: null });
    render(<Capture onCaptured={vi.fn()} onBack={vi.fn()} onUseUploadInstead={vi.fn()} />);

    expect(screen.getByRole('button', { name: /shutter/i })).toBeDisabled();
  });
});
