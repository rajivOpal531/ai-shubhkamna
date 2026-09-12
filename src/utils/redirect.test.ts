import { describe, expect, it, vi } from 'vitest';
import { buildRedirectUrl, redirectWithJwt } from './redirect';

describe('buildRedirectUrl', () => {
  it('appends jwt as a query param to a bare url', () => {
    expect(buildRedirectUrl('https://example.com/', 'abc.def-ghi')).toBe(
      'https://example.com/?jwt=abc.def-ghi',
    );
  });

  it('preserves existing query params on the base url', () => {
    expect(buildRedirectUrl('https://example.com/page?x=1', 'tok')).toBe(
      'https://example.com/page?x=1&jwt=tok',
    );
  });
});

describe('redirectWithJwt', () => {
  it('calls window.location.replace with the built url', () => {
    const replace = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, replace },
      writable: true,
    });

    redirectWithJwt('https://example.com/', 'tok');

    expect(replace).toHaveBeenCalledWith('https://example.com/?jwt=tok');
  });
});
