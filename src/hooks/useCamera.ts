import { useCallback, useEffect, useRef, useState } from 'react';

export type FacingMode = 'environment' | 'user';

type CameraState = {
  stream: MediaStream | null;
  error: string | null;
};

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;
type EnumerateDevices = () => Promise<MediaDeviceInfo[]>;

// Older WKWebViews and non-secure origins have no navigator.mediaDevices; reject so the
// caller shows the "Upload instead" fallback rather than crashing the render.
const defaultGetUserMedia: GetUserMedia = (constraints) =>
  navigator.mediaDevices?.getUserMedia
    ? navigator.mediaDevices.getUserMedia(constraints)
    : Promise.reject(new Error('Camera unavailable'));

// Some in-app WebViews expose getUserMedia but not enumerateDevices; treat that as "unknown".
const defaultEnumerateDevices: EnumerateDevices = () =>
  navigator.mediaDevices?.enumerateDevices
    ? navigator.mediaDevices.enumerateDevices()
    : Promise.reject(new Error('enumerateDevices unavailable'));

// Android WebViews can report NotReadableError if the new camera is requested while the old one
// is still being released by the OS; one delayed retry covers that.
const SWITCH_RETRY_DELAY_MS = 300;

// PermissionDeniedError is the pre-spec name still reported by some older Android WebViews.
const DENIED_ERROR_NAMES = new Set(['NotAllowedError', 'PermissionDeniedError']);

export function useCamera(
  getUserMedia: GetUserMedia = defaultGetUserMedia,
  enumerateDevices: EnumerateDevices = defaultEnumerateDevices,
) {
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');
  const [state, setState] = useState<CameraState>({ stream: null, error: null });
  const [canSwitch, setCanSwitch] = useState(false);
  // Mode of the camera currently streaming; null while none is open (so a switch is ignored).
  const openModeRef = useRef<FacingMode | null>(null);
  // Mode to fall back to if the camera being switched to will not open; null when not switching.
  const switchFromRef = useRef<FacingMode | null>(null);

  useEffect(() => {
    let cancelled = false;
    let activeStream: MediaStream | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const constraints = { video: { facingMode }, audio: false };

    const onStream = (stream: MediaStream) => {
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      activeStream = stream;
      openModeRef.current = facingMode;
      switchFromRef.current = null;
      setState({ stream, error: null });
      // Listed only after permission is granted: before that, browsers may hide or merge cameras.
      // If the list is unavailable or malformed, still offer the switch -- on a one-camera phone it
      // just reopens the same camera.
      Promise.resolve()
        .then(enumerateDevices)
        .then((devices) => {
          if (!cancelled) setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1);
        })
        .catch(() => {
          if (!cancelled) setCanSwitch(true);
        });
    };

    const onFatalError = (error: unknown) => {
      if (cancelled) return;
      const message = error instanceof Error ? error.message : 'Camera unavailable';
      setState({ stream: null, error: message });
    };

    getUserMedia(constraints).then(onStream, (error: unknown) => {
      if (cancelled) return;
      const previous = switchFromRef.current;
      if (previous === null) {
        onFatalError(error);
        return;
      }
      // Reopen the camera that was working; if that fails too, its own request shows the error.
      const revert = () => {
        switchFromRef.current = null;
        setFacingMode(previous);
      };
      // A denial will not change on retry, and in-app WebViews may show a permission dialog per request.
      if (DENIED_ERROR_NAMES.has((error as { name?: string } | null)?.name ?? '')) {
        revert();
        return;
      }
      retryTimer = setTimeout(() => {
        getUserMedia(constraints).then(onStream, () => {
          if (!cancelled) revert();
        });
      }, SWITCH_RETRY_DELAY_MS);
    });

    // Runs before the next facingMode's request, so the old camera is released first
    // (mobile Safari cannot open a second camera while one is live).
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      openModeRef.current = null;
      activeStream?.getTracks().forEach((track) => track.stop());
    };
  }, [getUserMedia, enumerateDevices, facingMode]);

  const switchCamera = useCallback(() => {
    const current = openModeRef.current;
    if (current === null) return;
    openModeRef.current = null;
    switchFromRef.current = current;
    setState({ stream: null, error: null });
    setFacingMode(current === 'environment' ? 'user' : 'environment');
  }, []);

  return { ...state, facingMode, canSwitch, switchCamera };
}
