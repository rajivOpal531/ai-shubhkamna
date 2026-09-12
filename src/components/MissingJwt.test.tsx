import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MissingJwt } from './MissingJwt';

describe('MissingJwt', () => {
  it('shows a message explaining the page cannot be opened directly', () => {
    render(<MissingJwt />);
    expect(screen.getByText(/can't be opened directly/i)).toBeInTheDocument();
  });
});
