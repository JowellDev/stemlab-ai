"""Fixtures partagees : generation d'audio de test via ffmpeg."""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest

ffmpeg_required = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg absent du PATH")


def _module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


#: Les dependances lourdes vivent derriere l'extra `ml` du pyproject : sans elles,
#: les tests d'integration sont ignores plutot que d'echouer.
essentia_required = pytest.mark.skipif(
    not _module_available("essentia"), reason="essentia absent (installer l'extra `ml`)"
)

demucs_required = pytest.mark.skipif(
    not _module_available("demucs"), reason="demucs absent (installer l'extra `ml`)"
)


@pytest.fixture
def make_tone(tmp_path: Path) -> Callable[..., Path]:
    """Cree un fichier audio de test : une sinusoide, dans le format demande."""

    def factory(
        name: str = "tone.wav",
        frequency: int = 440,
        seconds: float = 1.0,
        channels: int = 2,
        sample_rate: int = 48_000,
    ) -> Path:
        destination = tmp_path / name
        subprocess.run(  # noqa: S603
            [
                shutil.which("ffmpeg") or "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                f"sine=frequency={frequency}:duration={seconds}:sample_rate={sample_rate}",
                "-ac",
                str(channels),
                str(destination),
            ],
            check=True,
        )
        return destination

    return factory
