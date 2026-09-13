"""Face counting via OpenCV's YuNet detector. The model is vendored under models/.

Used only as a fast pre-check in the pipeline: zero faces -> NoFaceError, more than one ->
MultipleFacesError, so the caller can show a specific "no face" / "multiple faces" message
instead of the generic "no person" one. Detection runs on a downscaled copy of the upload
(the campaign photos are head-to-waist portraits, so a face is large relative to the frame).
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Callable

from PIL import Image

FaceDetector = Callable[[Image.Image], int]  # RGB image in, face count out

MODEL_PATH = Path(__file__).resolve().parent / "models" / "face_detection_yunet_2023mar.onnx"
# YuNet is trained around ~320px inputs; a 1024px longest edge keeps small/near faces detectable
# while capping the work on a 12 MP phone upload to a few tens of milliseconds.
DETECT_MAX_SIDE = 1024


def make_face_detector(
    model_path: Path = MODEL_PATH,
    score_threshold: float = 0.7,
    max_side: int = DETECT_MAX_SIDE,
) -> FaceDetector:
    """Build the YuNet-backed counter. Imported lazily so tests never touch OpenCV/ONNX."""
    import cv2  # noqa: WPS433 (lazy on purpose)
    import numpy as np  # noqa: WPS433

    if not model_path.is_file():
        raise FileNotFoundError(f"YuNet model missing: {model_path}")

    detector = cv2.FaceDetectorYN.create(str(model_path), "", (320, 320), score_threshold=score_threshold)
    # A single detector shared across worker threads is not documented thread-safe (setInputSize
    # mutates state), so serialise detect() with a lock. It runs in tens of ms, so this is cheap.
    lock = threading.Lock()

    def _count(img: Image.Image) -> int:
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
        return 0 if faces is None else len(faces)

    return _count
