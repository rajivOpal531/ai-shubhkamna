import { useEffect, useState } from 'react';

type CameraState = {
  stream: MediaStream | null;
  error: string | null;
};

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

const defaultGetUserMedia: GetUserMedia = (constraints) =>
  navigator.mediaDevices.getUserMedia(constraints);

export function useCamera(getUserMedia: GetUserMedia = defaultGetUserMedia) {
  const [state, setState] = useState<CameraState>({ stream: null, error: null });

  useEffect(() => {
    let cancelled = false;
    let activeStream: MediaStream | null = null;

    getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        activeStream = stream;
        setState({ stream, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Camera unavailable';
          setState({ stream: null, error: message });
        }
      });

    return () => {
      cancelled = true;
      activeStream?.getTracks().forEach((track) => track.stop());
    };
  }, [getUserMedia]);

  return state;
}
