import { config } from '../config';
import type { Profile } from '../types';

const EMPTY_PROFILE: Profile = {
  username: '',
  email: '',
  mobileno: '',
  state: '',
  constituency: '',
  district: '',
};

// The stakeholder's static-key decrypt would let any user decrypt any other user's
// profile data if it ran client-side (same key for everyone) - decryption must stay
// server-side behind the real GET /profile endpoint. Do not add decrypt logic here.
export async function getProfile(jwt: string, useMock: boolean = config.useMockProfile): Promise<Profile> {
  if (useMock) {
    return EMPTY_PROFILE;
  }

  const response = await fetch(config.profileUrl, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!response.ok) {
    throw new Error(`Profile lookup failed with status ${response.status}`);
  }

  return (await response.json()) as Profile;
}
