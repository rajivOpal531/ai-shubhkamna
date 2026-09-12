import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const compositePhotoMock = vi.fn();
vi.mock('../services/composite', () => ({ compositePhoto: (...args: unknown[]) => compositePhotoMock(...args) }));

import { Processing } from './Processing';
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
      <Processing photo={PHOTO} template={TEMPLATE} profile={PROFILE} onComposited={onComposited} onError={vi.fn()} />,
    );

    await waitFor(() => expect(onComposited).toHaveBeenCalledWith({ imageBlob: expect.any(Blob) }));
  });

  it('shows a retry/retake option when compositing fails, and retry calls compositePhoto again', async () => {
    compositePhotoMock.mockRejectedValue(new Error('network error'));
    render(<Processing photo={PHOTO} template={TEMPLATE} profile={PROFILE} onComposited={vi.fn()} onError={vi.fn()} />);

    const retryButton = await screen.findByRole('button', { name: /retry/i });
    expect(compositePhotoMock).toHaveBeenCalledTimes(1);

    await userEvent.click(retryButton);
    await waitFor(() => expect(compositePhotoMock).toHaveBeenCalledTimes(2));
  });

  it('calls onError when Retake photo is clicked after a failure', async () => {
    compositePhotoMock.mockRejectedValue(new Error('network error'));
    const onError = vi.fn();
    render(<Processing photo={PHOTO} template={TEMPLATE} profile={PROFILE} onComposited={vi.fn()} onError={onError} />);

    await userEvent.click(await screen.findByRole('button', { name: /retake photo/i }));
    expect(onError).toHaveBeenCalled();
  });

  it('does not re-run compositing when only profile/onComposited identity changes', async () => {
    compositePhotoMock.mockResolvedValue({ imageBlob: new Blob(['x']) });
    const { rerender } = render(
      <Processing photo={PHOTO} template={TEMPLATE} profile={PROFILE} onComposited={vi.fn()} onError={vi.fn()} />,
    );
    await waitFor(() => expect(compositePhotoMock).toHaveBeenCalledTimes(1));

    rerender(
      <Processing photo={PHOTO} template={TEMPLATE} profile={{ ...PROFILE }} onComposited={vi.fn()} onError={vi.fn()} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(compositePhotoMock).toHaveBeenCalledTimes(1);
  });
});
