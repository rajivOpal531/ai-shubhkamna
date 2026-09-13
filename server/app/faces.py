"""Face detection via OpenCV's YuNet detector. The model is vendored under models/.

Used as a fast pre-check in the pipeline: zero faces -> NoFaceError, more than one ->
MultipleFacesError. The detector returns each face's box normalised to the image (x, y, w, h in
[0, 1]); the count is len(boxes) and the largest face's area fraction tells us whether the photo
is a close-up (a big face) rather than the "upper body in full" the poster wants.
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Callable

from PIL import Image

# RGB image in; list of (x, y, w, h) face boxes normalised to [0, 1] out.
FaceBox = tuple[float, float, float, float]
FaceDetector = Callable[[Image.Image], list[FaceBox]]

MODEL_PATH = Path(__file__).resolve().parent / "models" / "face_detection_yunet_2023mar.onnx"
# YuNet is trained around ~320px inputs; a 1024px longest edge keeps small/near faces detectable
# while capping the work on a 12 MP phone upload to a few tens of milliseconds.
DETECT_MAX_SIDE = 1024


def make_face_detector(
    model_path: Path = MODEL_PATH,
    score_threshold: float = 0.7,
    max_side: int = DETECT_MAX_SIDE,
) -> FaceDetector:
    """Build the YuNet-backed detector. Imported lazily so tests never touch OpenCV/ONNX."""
    import cv2  # noqa: WPS433 (lazy on purpose)
    import numpy as np  # noqa: WPS433

    if not model_path.is_file():
        raise FileNotFoundError(f"YuNet model missing: {model_path}")

    detector = cv2.FaceDetectorYN.create(str(model_path), "", (320, 320), score_threshold=score_threshold)
    # A single detector shared across worker threads is not documented thread-safe (setInputSize
    # mutates state), so serialise detect() with a lock. It runs in tens of ms, so this is cheap.
    lock = threading.Lock()

    def _detect(img: Image.Image) -> list[FaceBox]:
        rgb = img.convert("RGB")
        width, height = rgb.size
        scale = min(1.0, max_side / max(width, height))
        if scale < 1.0:
            rgb = rgb.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.BILINEAR)
        bgr = np.ascontiguousarray(np.asarray(rgb)[:, :, ::-1])  # PIL RGB -> OpenCV BGR
        det_h, det_w = bgr.shape[:2]
        with lock:
            detector.setInputSize((det_w, det_h))
            _, faces = detector.detect(bgr)
        if faces is None:
            return []
        return [(float(f[0]) / det_w, float(f[1]) / det_h, float(f[2]) / det_w, float(f[3]) / det_h) for f in faces]

    return _detect
