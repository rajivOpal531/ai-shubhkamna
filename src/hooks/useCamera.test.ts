import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCamera } from './useCamera';

function fakeStream() {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

describe('useCamera', () => {
  it('sets the stream once getUserMedia resolves', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    const { result } = renderHook(() => useCamera(getUserMedia));

    await waitFor(() => expect(result.current.stream).not.toBeNull());
    expect(result.current.error).toBeNull();
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' }, audio: false });
  });

  it('sets an error when getUserMedia rejects', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('Permission denied'));
    const { result } = renderHook(() => useCamera(getUserMedia));

    await waitFor(() => expect(result.current.error).toBe('Permission denied'));
    expect(result.current.stream).toBeNull();
  });
});
