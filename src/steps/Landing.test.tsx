import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Landing } from './Landing';
import { templates } from '../data/templates';

function renderLanding(overrides: Partial<React.ComponentProps<typeof Landing>> = {}) {
  const props = {
    name: '',
    onNameChange: vi.fn(),
    selectedTemplateId: templates[0].id,
    onSelectTemplate: vi.fn(),
    onCapture: vi.fn(),
    onFileSelected: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
  render(<Landing {...props} />);
  return props;
}

describe('Landing', () => {
  it('shows the headline copy', () => {
    renderLanding();
    expect(screen.getByText(/join the nation in wishing pm modi/i)).toBeInTheDocument();
  });

  it('calls onNameChange when the name field is edited', async () => {
    const props = renderLanding();
    await userEvent.type(screen.getByLabelText(/display name on the photo/i), 'A');
    expect(props.onNameChange).toHaveBeenCalledWith('A');
  });

  it('calls onCapture when Capture is clicked', async () => {
    const props = renderLanding();
    await userEvent.click(screen.getByRole('button', { name: /capture/i }));
    expect(props.onCapture).toHaveBeenCalled();
  });

  it('calls onFileSelected with the chosen file', async () => {
    const props = renderLanding();
    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const input = screen.getByTestId('landing-file-input') as HTMLInputElement;
    await userEvent.upload(input, file);
    expect(props.onFileSelected).toHaveBeenCalledWith(file);
  });

  it('calls onBack when the back button is clicked', async () => {
    const props = renderLanding();
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(props.onBack).toHaveBeenCalled();
  });
});
