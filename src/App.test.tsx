import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./services/profile', () => ({
  getProfile: vi.fn().mockResolvedValue({
    username: 'Rajiv Ranjan',
    email: '',
    mobileno: '',
    state: 'Uttar Pradesh',
    constituency: 'Gautam Buddha Nagar',
    district: 'Gautam Buddha Nagar',
  }),
}));
vi.mock('./services/composite', () => ({
  compositePhoto: vi.fn().mockResolvedValue({ imageUrl: 'https://cdn.narendramodi.in/shubhkamna2026/card.jpg' }),
}));
vi.mock('./services/createPost', () => ({
  createPostByImageUrl: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  createPostWithFile: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
}));
// homeUrl/mediaWallUrl fall back to '' when no .env is present, and `new URL('')` throws -
// stub them with valid placeholder URLs so redirectWithJwt has a real base to build against.
vi.mock('./config', () => ({
  config: {
    homeUrl: 'https://example.test/home',
    mediaWallUrl: 'https://example.test/media-wall',
  },
}));

import { App } from './App';
import { createPostByImageUrl } from './services/createPost';

function stubLocationReplace() {
  const replace = vi.fn();
  Object.defineProperty(window, 'location', { value: { ...window.location, replace }, writable: true });
  return replace;
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the missing-jwt screen when no jwt is present', () => {
    render(<App search="" />);
    expect(screen.getByText(/can't be opened directly/i)).toBeInTheDocument();
  });

  it('runs the full upload -> preview -> post -> redirect flow', async () => {
    const replace = stubLocationReplace();
    render(<App search="?jwt=test-token" />);

    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByTestId('landing-file-input'), file);

    await screen.findByAltText(/your birthday card/i);
    await userEvent.type(screen.getByPlaceholderText(/write your birthday wish/i), 'Happy Birthday!');
    await userEvent.click(screen.getByRole('button', { name: /^post$/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringContaining('jwt=test-token')));
    expect(createPostByImageUrl).toHaveBeenCalledWith(
      expect.objectContaining({ jwt: 'test-token', text: 'Happy Birthday!' }),
    );
  });

  it('redirects home when exit is confirmed', async () => {
    const replace = stubLocationReplace();
    render(<App search="?jwt=test-token" />);

    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes/i }));

    expect(replace).toHaveBeenCalledWith(expect.stringContaining('jwt=test-token'));
  });
});
