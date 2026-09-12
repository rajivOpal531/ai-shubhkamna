import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../types';

// This file exercises the "misconfigured VITE_COMPOSITE_URL" guard in realCompositePhoto.
// It needs a different config.compositeUrl per test (empty, then a placeholder host), so
// unlike composite.test.ts (which mocks ../config once for the whole file) this uses
// vi.doMock + a dynamic import of ./composite inside each test, resetting the module
// registry first so each test gets its own fresh mock of ../config.

const PROFILE: Profile = {
  username: 'Rajiv Ranjan',
  email: '',
  mobileno: '',
  state: 'Uttar Pradesh',
  constituency: 'Gautam Buddha Nagar',
  district: 'Gautam Buddha Nagar',
};

const PARAMS = {
  photo: new Blob(['photo-bytes'], { type: 'image/jpeg' }),
  templateId: 'card-1',
  templateImageUrl: 'data:image/jpeg;base64,template',
  profile: PROFILE,
  jwt: 'test-jwt',
};

describe('compositePhoto misconfiguration guard', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rejects with a CompositeError mentioning VITE_COMPOSITE_URL when the URL is empty', async () => {
    vi.doMock('../config', () => ({
      config: { compositeUrl: '', useMockComposite: false },
    }));

    const { compositePhoto, CompositeError } = await import('./composite');
    const error = await compositePhoto(PARAMS, { useMock: false }).catch((err) => err);

    expect(error).toBeInstanceOf(CompositeError);
    expect((error as InstanceType<typeof CompositeError>).message).toContain('VITE_COMPOSITE_URL');
    expect((error as InstanceType<typeof CompositeError>).status).toBeNull();
    expect((error as InstanceType<typeof CompositeError>).kind).toBe('config');
    expect((error as InstanceType<typeof CompositeError>).retryable).toBe(false);
  });

  it('rejects with a CompositeError mentioning VITE_COMPOSITE_URL when the URL still has the <railway-app> placeholder', async () => {
    vi.doMock('../config', () => ({
      config: { compositeUrl: 'https://<railway-app>.up.railway.app/composite', useMockComposite: false },
    }));

    const { compositePhoto, CompositeError } = await import('./composite');
    const error = await compositePhoto(PARAMS, { useMock: false }).catch((err) => err);

    expect(error).toBeInstanceOf(CompositeError);
    expect((error as InstanceType<typeof CompositeError>).message).toContain('VITE_COMPOSITE_URL');
    expect((error as InstanceType<typeof CompositeError>).kind).toBe('config');
    expect((error as InstanceType<typeof CompositeError>).retryable).toBe(false);
  });
});
