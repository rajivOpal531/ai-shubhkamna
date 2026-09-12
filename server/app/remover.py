"""Background-removal backend. Imported lazily so tests never load the ONNX model."""
from __future__ import annotations

from typing import Callable

from PIL import Image

Remover = Callable[[Image.Image], Image.Image]  # RGB in, RGBA out


def make_remover(model_name: str) -> Remover:
    """Build the real rembg remover for `model_name` (e.g. "isnet-general-use")."""
    from rembg import new_session, remove  # noqa: WPS433 (lazy on purpose)

    session = new_session(model_name)

    # The rembg/ONNX session is shared across threads; InferenceSession.run is documented thread-safe.
    def _remove(img: Image.Image) -> Image.Image:
        return remove(img, session=session).convert("RGBA")

    return _remove
