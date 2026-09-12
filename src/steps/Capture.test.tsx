import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useCameraMock = vi.fn();
vi.mock('../hooks/useCamera', () => ({ useCamera: () => useCameraMock() }));

import { Capture } from './Capture';

describe('Capture', () => {
  beforeEach(() => {
    useCameraMock.mockReset();
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
});
