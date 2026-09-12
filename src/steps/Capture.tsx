import { useEffect, useRef } from 'react';
import { useCamera } from '../hooks/useCamera';
import './Capture.css';

type Props = {
  onCaptured: (photo: Blob) => void;
  onBack: () => void;
  onUseUploadInstead: () => void;
};

export function Capture({ onCaptured, onBack, onUseUploadInstead }: Props) {
  const { stream, error } = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  function handleShutter() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1080;
    canvas.height = video.videoHeight || 1260;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
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
        <p>We couldn&apos;t access your camera. Please upload a photo instead.</p>
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
      <button type="button" aria-label="Close" onClick={onBack}>
        ×
      </button>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} autoPlay playsInline muted />
      <button type="button" aria-label="Shutter" onClick={handleShutter} />
    </div>
  );
}
