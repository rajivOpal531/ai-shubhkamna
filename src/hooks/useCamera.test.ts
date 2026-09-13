import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCamera } from './useCamera';

function fakeStream() {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

function device(kind: MediaDeviceKind, deviceId: string) {
  return { kind, deviceId, groupId: '', label: '', toJSON: () => ({}) } as MediaDeviceInfo;
}

// Each call pops the next outcome; records which camera was asked for.
function scriptedGetUserMedia(outcomes: Array<'ok' | 'fail' | 'denied'>) {
  const requested: string[] = [];
  const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
    requested.push(String((constraints.video as MediaTrackConstraints).facingMode));
    const outcome = outcomes[requested.length - 1];
    if (outcome === 'ok') return Promise.resolve(fakeStream());
    if (outcome === 'denied') {
      return Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    }
    return Promise.reject(new Error('Could not start video source'));
  });
  return { getUserMedia, requested };
}

describe('useCamera', () => {
  it('does not retry a switch the user denied, and returns to the previous camera', async () => {
    // A retry would re-prompt: in-app WebViews may show their own permission dialog on every request.
    const { getUserMedia, requested } = scriptedGetUserMedia(['ok', 'denied', 'ok']);
    const { result } = renderHook(() => useCamera(getUserMedia));
    await waitFor(() => expect(result.current.stream).not.toBeNull());

    act(() => result.current.switchCamera());

    await waitFor(() => expect(requested).toHaveLength(3));
    await waitFor(() => expect(result.current.stream).not.toBeNull());
    expect(requested).toEqual(['environment', 'user', 'environment']);
    expect(result.current.facingMode).toBe('environment');
    expect(result.current.error).toBeNull();
  });

  it('cancels a pending switch retry when the camera screen closes', async () => {
    const { getUserMedia, requested } = scriptedGetUserMedia(['ok', 'fail', 'ok']);
    const { result, unmount } = renderHook(() => useCamera(getUserMedia));
    await waitFor(() => expect(result.current.stream).not.toBeNull());

    act(() => result.current.switchCamera());
    await waitFor(() => expect(requested).toHaveLength(2));
    await act(async () => {});
    unmount();
    await new Promise((r) => setTimeout(r, 400));

    expect(requested).toEqual(['environment', 'user']);
  });

  it('sets the stream once getUserMedia resolves', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    const { result } = renderHook(() => useCamera(getUserMedia));

    await waitFor(() => expect(result.current.stream).not.toBeNull());
    expect(result.current.error).toBeNull();
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' }, audio: false });
  });

  it('sets an error without retrying when the first camera request rejects', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('Permission denied'));
    const { result } = renderHook(() => useCamera(getUserMedia));

    await waitFor(() => expect(result.current.error).toBe('Permission denied'));
    expect(result.current.stream).toBeNull();
    await new Promise((r) => setTimeout(r, 400));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('reports an error instead of crashing when the browser has no camera API', async () => {
    // Older WKWebViews and non-secure origins expose no navigator.mediaDevices at all.
    const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    try {
      const { result } = renderHook(() => useCamera());

      await waitFor(() => expect(result.current.error).toBe('Camera unavailable'));
      expect(result.current.stream).toBeNull();
    } finally {
      if (original) {
        Object.defineProperty(navigator, 'mediaDevices', original);
      } else {
        Reflect.deleteProperty(navigator, 'mediaDevices');
      }
    }
  });

  it('stops tracks if unmounted before getUserMedia resolves', async () => {
    let resolve!: (s: MediaStream) => void;
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((r) => (resolve = r)));
    const { unmount } = renderHook(() => useCamera(getUserMedia));

    unmount();
    resolve(stream);
    await Promise.resolve();

    expect(track.stop).toHaveBeenCalled();
  });

  it('toggles between the back and front camera on each switchCamera call', async () => {
    const getUserMedia = vi.fn((_constraints: MediaStreamConstraints) => Promise.resolve(fakeStream()));
    const { result } = renderHook(() => useCamera(getUserMedia));
    await waitFor(() => expect(result.current.stream).not.toBeNull());
    expect(result.current.facingMode).toBe('environment');

    act(() => result.current.switchCamera());
    await waitFor(() => expect(result.current.stream).not.toBeNull());
    expect(result.current.facingMode).toBe('user');
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: { facingMode: 'user' }, audio: false });

    act(() => result.current.switchCamera());
    await waitFor(() => expect(result.current.stream).not.toBeNull());
    expect(result.current.facingMode).toBe('environment');
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: { facingMode: 'environment' }, audio: false });
    expect(getUserMedia).toHaveBeenCalledTimes(3);
  });

  it('releases the back camera and clears the stream before requesting the front camera', async () => {
    // Mobile Safari cannot open a second camera while the first is still live, so order matters.
    const events: string[] = [];
    const backStream = {
      getTracks: () => [{ stop: () => events.push('stop back') }],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn((constraints: MediaStreamConstraints) => {
      events.push(`request ${(constraints.video as MediaTrackConstraints).facingMode}`);
      return events.length === 1 ? Promise.resolve(backStream) : new Promise<MediaStream>(() => {});
    });
    const { result } = renderHook(() => useCamera(getUserMedia));
    await waitFor(() => expect(result.current.stream).toBe(backStream));

    act(() => result.current.switchCamera());

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(events).toEqual(['request environment', 'stop back', 'request user']);
    expect(result.current.stream).toBeNull();
  });

  it('ignores a second switchCamera call made before the first switch has opened a camera', async () => {
    const getUserMedia = vi.fn((_constraints: MediaStreamConstraints) => Promise.resolve(fakeStream()));
    const { result } = renderHook(() => useCamera(getUserMedia));
    await waitFor(() => expect(result.current.stream).not.toBeNull());

    act(() => {
      result.current.switchCamera();
      result.current.switchCamera();
    });

    await waitFor(() => expect(result.current.stream).not.toBeNull());
    expect(result.current.facingMode).toBe('user');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('retries a failed switch once and keeps the new camera when the retry succeeds', async () => {
    // Some Android WebViews report NotReadableError while the previous camera is still being released.
    const { getUserMedia, requested } = scriptedGetUserMedia(['ok', 'fail', 'ok']);
    const { result } = renderHook(() => useCamera(getUserMedia));
    await waitFor(() => expect(result.current.stream).not.toBeNull());

    act(() => result.current.switchCamera());

    await waitFor(() => expect(requested).toHaveLength(3));
    await waitFor(() => expect(result.current.stream).not.toBeNull());
    expect(requested).toEqual(['environment', 'user', 'user']);
    expect(result.current.facingMode).toBe('user');
    expect(result.current.error).toBeNull();
  });

  it('returns to the previous camera when the switch fails twice', async () => {
    const { getUserMedia, requested } = scriptedGetUserMedia(['ok', 'fail', 'fail', 'ok']);
    const { result } = renderHook(() => useCamera(getUserMedia));
    await waitFor(() => expect(result.current.stream).not.toBeNull());

    act(() => result.current.switchCamera());

    await waitFor(() => expect(requested).toHaveLength(4));
    await waitFor(() => expect(result.current.stream).not.toBeNull());
    expect(requested).toEqual(['environment', 'user', 'user', 'environment']);
    expect(result.current.facingMode).toBe('environment');
    expect(result.current.error).toBeNull();
  });

  it('shows the error, without looping between cameras, when the previous camera cannot reopen either', async () => {
    const { getUserMedia, requested } = scriptedGetUserMedia(['ok', 'fail', 'fail', 'fail', 'ok']);
    const { result } = renderHook(() => useCamera(getUserMedia));
    await waitFor(() => expect(result.current.stream).not.toBeNull());

    act(() => result.current.switchCamera());

    await waitFor(() => expect(result.current.error).toBe('Could not start video source'));
    await new Promise((r) => setTimeout(r, 400));
    expect(requested).toEqual(['environment', 'user', 'user', 'environment']);
    expect(result.current.stream).toBeNull();
  });

  it.each([
    { name: 'two video inputs', devices: [device('videoinput', 'back'), device('videoinput', 'front')], want: true },
    {
      name: 'one video input plus a microphone',
      devices: [device('videoinput', 'back'), device('audioinput', 'mic')],
      want: false,
    },
  ])('reports canSwitch=$want for $name', async ({ devices, want }) => {
    const getUserMedia = vi.fn(() => Promise.resolve(fakeStream()));
    const enumerateDevices = vi.fn().mockResolvedValue(devices);
    const { result } = renderHook(() => useCamera(getUserMedia, enumerateDevices));

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalled());
    await act(async () => {});

    expect(result.current.canSwitch).toBe(want);
  });

  it('offers switching when the browser cannot list devices, without surfacing an error', async () => {
    // Some in-app WebViews reject enumerateDevices; hiding the button there would strand selfie-takers,
    // while a needless switch on a one-camera phone just reopens the same camera.
    const getUserMedia = vi.fn(() => Promise.resolve(fakeStream()));
    const enumerateDevices = vi.fn().mockRejectedValue(new Error('not supported'));
    const { result } = renderHook(() => useCamera(getUserMedia, enumerateDevices));

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalled());
    await act(async () => {});

    expect(result.current.canSwitch).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('keeps the camera running when a WebView returns a malformed device list', async () => {
    const getUserMedia = vi.fn(() => Promise.resolve(fakeStream()));
    const enumerateDevices = vi.fn().mockResolvedValue({} as unknown as MediaDeviceInfo[]);
    const { result } = renderHook(() => useCamera(getUserMedia, enumerateDevices));

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalled());
    await act(async () => {});

    expect(result.current.error).toBeNull();
    expect(result.current.stream).not.toBeNull();
    expect(result.current.canSwitch).toBe(true);
  });
});
