"""make_remover never loads the real model here: a fake `rembg` module is injected instead."""
import logging
import sys
import types

import pytest

from app import remover


class _Inner:
    def __init__(self, providers):
        self._providers = providers

    def get_providers(self):
        return self._providers


def _install_fake_rembg(monkeypatch, providers):
    session = types.SimpleNamespace(inner_session=_Inner(providers))
    fake = types.ModuleType("rembg")
    fake.new_session = lambda model_name: session
    fake.remove = lambda img, session=None: img
    monkeypatch.setitem(sys.modules, "rembg", fake)


def test_cpu_session_is_fine_by_default(monkeypatch, caplog):
    _install_fake_rembg(monkeypatch, ["CPUExecutionProvider"])
    with caplog.at_level(logging.INFO, logger="app.remover"):
        fn = remover.make_remover("isnet-general-use")
    assert callable(fn)
    assert "providers=['CPUExecutionProvider']" in caplog.text


def test_require_gpu_rejects_cpu_session(monkeypatch):
    _install_fake_rembg(monkeypatch, ["CPUExecutionProvider"])
    with pytest.raises(RuntimeError, match="REQUIRE_GPU"):
        remover.make_remover("isnet-general-use", require_gpu=True)


def test_require_gpu_accepts_cuda_session(monkeypatch):
    _install_fake_rembg(monkeypatch, ["CUDAExecutionProvider", "CPUExecutionProvider"])
    assert callable(remover.make_remover("isnet-general-use", require_gpu=True))


def test_warns_when_cuda_is_compiled_in_but_unused(monkeypatch, caplog):
    _install_fake_rembg(monkeypatch, ["CPUExecutionProvider"])
    monkeypatch.setattr(
        "onnxruntime.get_available_providers", lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"]
    )
    with caplog.at_level(logging.WARNING, logger="app.remover"):
        remover.make_remover("isnet-general-use")
    assert "GPU is not reachable" in caplog.text
