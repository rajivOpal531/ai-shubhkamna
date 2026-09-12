import { useEffect, useState } from 'react';

type CameraState = {
  stream: MediaStream | null;
  error: string | null;
};

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

export function useCamera(getUserMedia: GetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)) {
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
      .catch((error: Error) => {
        if (!cancelled) {
          setState({ stream: null, error: error.message || 'Camera unavailable' });
        }
      });

    return () => {
      cancelled = true;
      activeStream?.getTracks().forEach((track) => track.stop());
    };
  }, [getUserMedia]);

  return state;
}
