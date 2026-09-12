import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const compositePhotoMock = vi.fn();
vi.mock('../services/composite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/composite')>();
  return {
    ...actual,
    compositePhoto: (...args: unknown[]) => compositePhotoMock(...args),
  };
});

import { Processing } from './Processing';
import { CompositeError } from '../services/composite';
import type { Profile, Template } from '../types';

const TEMPLATE: Template = { id: 'card-1', image: 'data:image/jpeg;base64,x' };
const PROFILE: Profile = { username: '', email: '', mobileno: '', state: '', constituency: '', district: '' };
const PHOTO = new Blob(['bytes'], { type: 'image/jpeg' });

describe('Processing', () => {
  beforeEach(() => {
    compositePhotoMock.mockReset();
  });

  it('calls onComposited once compositing succeeds', async () => {
    compositePhotoMock.mockResolvedValue({ imageBlob: new Blob(['x']) });
    const onComposited = vi.fn();
    render(
      <Processing jwt="test-jwt" photo={PHOTO} template={TEMPLATE} profile={PROFILE} onComposited={onComposited} onError={vi.fn()} />,
    );

    await waitFor(() => expect(onComposited).toHaveBeenCalledWith({ imageBlob: expect.any(Blob) }));
    expect(compositePhotoMock).toHaveBeenCalledWith(expect.objectContaining({ jwt: 'test-jwt', templateId: 'card-1' }));
  });

  it('shows a retry/retake option when compositing fails, and retry calls compositePhoto again', async () => {
    compositePhotoMock.mockRejectedValue(new CompositeError('boom', 500, null));
    render(<Processing jwt="test-jwt" photo={PHOTO} template={TEMPLATE} profile={PROFILE} onComposited={vi.fn()} onError={vi.fn()} />);

    const retryButton = await screen.findByRole('button', { name: /retry/i });
    expect(compositePhotoMock).toHaveBeenCalledTimes(1);

    await userEvent.click(retryButton);
    await waitFor(() => expect(compositePhotoMock).toHaveBeenCalledTimes(2));
  });

  it('calls onError when Retake photo is clicked after a failure', async () => {
    compositePhotoMock.mockRejectedValue(new CompositeError('boom', 500, null));
    const onError = vi.fn();
    render(<Processing jwt="test-jwt" photo={PHOTO} template={TEMPLATE} profile={PROFILE} onComposited={vi.fn()} onError={onError} />);

    await userEvent.click(await screen.findByRole('button', { name: /retake photo/i }));
    expect(onError).toHaveBeenCalled();
  });

  it('shows the no-person message with no Retry button for a 422 failure', async () => {
    compositePhotoMock.mockRejectedValue(new CompositeError('no subject', 422, 'req1'));
    render(<Processing jwt="test-jwt" photo={PHOTO} template={TEMPLATE} profile={PROFILE} onComposited={vi.fn()} onError={vi.fn()} />);

    expect(
      await screen.findByText(/couldn't find a person in that photo/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    expect(screen.getByRole('button', { name: /retake photo/i })).toBeInTheDocument();
  });

  it('aborts the in-flight request on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    compositePhotoMock.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise(() => {
          capturedSignal = signal;
        }),
    );
    const { unmount } = render(
      <Processing jwt="test-jwt" photo={PHOTO} template={TEMPLATE} profile={PROFILE} onComposited={vi.fn()} onError={vi.fn()} />,
    );

    await waitFor(() => expect(capturedSignal).toBeDefined());
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('does not re-run compositing when only profile/onComposited identity changes', async () => {
    compositePhotoMock.mockResolvedValue({ imageBlob: new Blob(['x']) });
    const { rerender } = render(
      <Processing jwt="test-jwt" photo={PHOTO} template={TEMPLATE} profile={PROFILE} onComposited={vi.fn()} onError={vi.fn()} />,
    );
    await waitFor(() => expect(compositePhotoMock).toHaveBeenCalledTimes(1));

    rerender(
      <Processing jwt="test-jwt" photo={PHOTO} template={TEMPLATE} profile={{ ...PROFILE }} onComposited={vi.fn()} onError={vi.fn()} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(compositePhotoMock).toHaveBeenCalledTimes(1);
  });
});
