import { useEffect, useRef } from 'react';
import { useCamera } from '../hooks/useCamera';
import './Capture.css';

type Props = {
  onCaptured: (photo: Blob) => void;
  onBack: () => void;
  onUseUploadInstead: () => void;
};

export function Capture({ onCaptured, onBack, onUseUploadInstead }: Props) {
  const { stream, error, facingMode, canSwitch, switchCamera } = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Also clears it (null) during a camera switch, so the stopped camera's last frame is not shown.
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  function handleShutter() {
    const video = videoRef.current;
    if (!video || video.readyState < video.HAVE_CURRENT_DATA) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1080;
    canvas.height = video.videoHeight || 1260;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Draws the raw frame, so a front-camera photo is NOT mirrored even though its preview is.
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCaptured(blob);
        }
      },
      'image/jpeg',
      0.92,
    );
  }

  if (error) {
    return (
      <div className="capture capture--error">
        <p role="alert">We couldn&apos;t access your camera. Please upload a photo instead.</p>
        <button type="button" onClick={onUseUploadInstead}>
          Upload instead
        </button>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="capture">
      <button type="button" className="capture__close" aria-label="Close" onClick={onBack}>
        ×
      </button>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        // Mirror the front-camera preview so it behaves like a mirror, as users expect from selfies.
        style={facingMode === 'user' ? { transform: 'scaleX(-1)' } : undefined}
      />
      <button
        type="button"
        className="capture__shutter"
        aria-label="Shutter"
        onClick={handleShutter}
        disabled={!stream}
      />
      {canSwitch && (
        <button
          type="button"
          className="capture__switch"
          aria-label="Switch camera"
          onClick={switchCamera}
          disabled={!stream}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M20 11a8 8 0 0 0-14.3-4.9M4 5v4h4M4 13a8 8 0 0 0 14.3 4.9M20 19v-4h-4"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
