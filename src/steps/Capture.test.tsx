import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useCameraMock = vi.fn();
vi.mock('../hooks/useCamera', () => ({ useCamera: () => useCameraMock() }));

import { Capture } from './Capture';

function cameraState(overrides: Record<string, unknown> = {}) {
  return {
    stream: {} as MediaStream,
    error: null,
    facingMode: 'environment',
    canSwitch: false,
    switchCamera: vi.fn(),
    ...overrides,
  };
}

describe('Capture', () => {
  beforeEach(() => {
    useCameraMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a fallback and lets the user switch to Upload when the camera errors', async () => {
    useCameraMock.mockReturnValue(cameraState({ stream: null, error: 'Permission denied' }));
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

    useCameraMock.mockReturnValue(cameraState());
    const onCaptured = vi.fn();
    render(<Capture onCaptured={onCaptured} onBack={vi.fn()} onUseUploadInstead={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /shutter/i }));
    expect(onCaptured).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('calls onBack when close is clicked', async () => {
    useCameraMock.mockReturnValue(cameraState());
    const onBack = vi.fn();
    render(<Capture onCaptured={vi.fn()} onBack={onBack} onUseUploadInstead={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('disables the shutter button while the camera has not resolved a stream yet', () => {
    useCameraMock.mockReturnValue(cameraState({ stream: null }));
    render(<Capture onCaptured={vi.fn()} onBack={vi.fn()} onUseUploadInstead={vi.fn()} />);

    expect(screen.getByRole('button', { name: /shutter/i })).toBeDisabled();
  });

  it('switches camera when the switch button is pressed on a multi-camera device', async () => {
    const switchCamera = vi.fn();
    useCameraMock.mockReturnValue(cameraState({ canSwitch: true, switchCamera }));
    render(<Capture onCaptured={vi.fn()} onBack={vi.fn()} onUseUploadInstead={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /switch camera/i }));
    expect(switchCamera).toHaveBeenCalledTimes(1);
  });

  it('disables the switch button while the other camera is opening', () => {
    useCameraMock.mockReturnValue(cameraState({ stream: null, canSwitch: true }));
    render(<Capture onCaptured={vi.fn()} onBack={vi.fn()} onUseUploadInstead={vi.fn()} />);

    expect(screen.getByRole('button', { name: /switch camera/i })).toBeDisabled();
  });

  it('hides the switch button on a single-camera device', () => {
    useCameraMock.mockReturnValue(cameraState({ canSwitch: false }));
    render(<Capture onCaptured={vi.fn()} onBack={vi.fn()} onUseUploadInstead={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /switch camera/i })).not.toBeInTheDocument();
  });

  it('detaches the stopped camera from the preview while the other camera opens', () => {
    const stream = {} as MediaStream;
    useCameraMock.mockReturnValue(cameraState({ stream }));
    const { container, rerender } = render(
      <Capture onCaptured={vi.fn()} onBack={vi.fn()} onUseUploadInstead={vi.fn()} />,
    );
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video.srcObject).toBe(stream);

    useCameraMock.mockReturnValue(cameraState({ stream: null, canSwitch: true }));
    rerender(<Capture onCaptured={vi.fn()} onBack={vi.fn()} onUseUploadInstead={vi.fn()} />);
    expect(video.srcObject).toBeNull();
  });

  it('mirrors the live preview for the front camera only', () => {
    useCameraMock.mockReturnValue(cameraState({ facingMode: 'user' }));
    const { container, rerender } = render(
      <Capture onCaptured={vi.fn()} onBack={vi.fn()} onUseUploadInstead={vi.fn()} />,
    );
    expect(container.querySelector('video')).toHaveStyle({ transform: 'scaleX(-1)' });

    useCameraMock.mockReturnValue(cameraState({ facingMode: 'environment' }));
    rerender(<Capture onCaptured={vi.fn()} onBack={vi.fn()} onUseUploadInstead={vi.fn()} />);
    expect(container.querySelector('video')).not.toHaveStyle({ transform: 'scaleX(-1)' });
  });
});
