import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProfile } from './profile';

const EMPTY_PROFILE = {
  username: '',
  email: '',
  mobileno: '',
  state: '',
  constituency: '',
  district: '',
};

describe('getProfile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an empty profile and does not call fetch when useMock is true', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const profile = await getProfile('jwt-token', true);

    expect(profile).toEqual(EMPTY_PROFILE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches and returns the decrypted profile when useMock is false', async () => {
    const body = { ...EMPTY_PROFILE, username: 'Rajiv Ranjan', state: 'Uttar Pradesh' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }),
    );

    const profile = await getProfile('jwt-token', false);

    expect(profile).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Authorization: 'Bearer jwt-token' } }),
    );
  });

  it('throws when the profile endpoint responds with a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(getProfile('jwt-token', false)).rejects.toThrow('Profile lookup failed with status 500');
  });
});
