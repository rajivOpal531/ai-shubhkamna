"""Background-removal backend. Imported lazily so tests never load the ONNX model."""
from __future__ import annotations

import logging
from typing import Callable

from PIL import Image

log = logging.getLogger(__name__)

Remover = Callable[[Image.Image], Image.Image]  # RGB in, RGBA out

CUDA = "CUDAExecutionProvider"


def make_remover(model_name: str, *, require_gpu: bool = False) -> Remover:
    """Build the real rembg remover for `model_name` (e.g. "isnet-general-use").

    rembg picks the CUDA provider whenever the installed onnxruntime has one, and falls back to
    CPU silently when the GPU is unreachable. With `require_gpu` that fallback is a startup error
    instead, so a misconfigured GPU host never quietly serves on CPU (the rollout script then keeps
    the old container running).
    """
    from rembg import new_session, remove  # noqa: WPS433 (lazy on purpose)

    session = new_session(model_name)
    active, available = _providers(session)
    log.info("rembg model=%s providers=%s available=%s", model_name, active, available)
    if CUDA in available and CUDA not in active:
        log.warning(
            "onnxruntime has a CUDA provider but the session runs on %s: the GPU is not reachable "
            "(driver / CUDA version mismatch, missing NVIDIA Container Toolkit, or no GPU "
            "reservation in compose)",
            active,
        )
    if require_gpu and CUDA not in active:
        raise RuntimeError(
            f"REQUIRE_GPU is set but the rembg session runs on {active} (available: {available})"
        )

    # The rembg/ONNX session is shared across threads; InferenceSession.run is documented thread-safe.
    def _remove(img: Image.Image) -> Image.Image:
        return remove(img, session=session).convert("RGBA")

    return _remove


def _providers(session: object) -> tuple[list[str], list[str]]:
    """(providers the session actually runs on, providers compiled into onnxruntime)."""
    import onnxruntime as ort  # noqa: WPS433

    inner = getattr(session, "inner_session", None)
    active = list(inner.get_providers()) if inner is not None else []
    return active, list(ort.get_available_providers())
