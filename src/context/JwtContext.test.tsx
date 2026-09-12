import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JwtProvider, readJwtFromLocation, useJwt } from './JwtContext';

describe('readJwtFromLocation', () => {
  it('extracts jwt from a query string', () => {
    expect(readJwtFromLocation('?jwt=abc123')).toBe('abc123');
  });

  it('returns null when jwt is missing', () => {
    expect(readJwtFromLocation('?other=1')).toBeNull();
    expect(readJwtFromLocation('')).toBeNull();
  });
});

function Child() {
  const jwt = useJwt();
  return <div>token: {jwt}</div>;
}

describe('JwtProvider', () => {
  it('renders children when jwt is present', () => {
    render(
      <JwtProvider search="?jwt=abc123" missingJwtFallback={<div>missing</div>}>
        <Child />
      </JwtProvider>,
    );
    expect(screen.getByText('token: abc123')).toBeInTheDocument();
  });

  it('renders the fallback when jwt is missing', () => {
    render(
      <JwtProvider search="" missingJwtFallback={<div>missing</div>}>
        <Child />
      </JwtProvider>,
    );
    expect(screen.getByText('missing')).toBeInTheDocument();
  });
});
