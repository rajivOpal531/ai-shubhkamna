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

// Real endpoint is not available yet (docs/superpowers/specs/2026-09-12-ai-shubhkamna-design.md
// "Open integrations"). It must decrypt server-side - never ship the decrypt key to the browser.
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
