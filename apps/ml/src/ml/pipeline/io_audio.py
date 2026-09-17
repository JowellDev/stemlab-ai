"""Entrees/sorties audio : normalisation a l'entree, encodage Opus a la sortie.

Tout passe par ffmpeg. C'est le seul module du pipeline qui lance des processus
externes ; les fonctions d'analyse, elles, ne voient que des tableaux numpy.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt
import soundfile as sf

TARGET_SAMPLE_RATE = 44_100


class FFmpegError(RuntimeError):
    """ffmpeg a echoue. Le message porte sa sortie d'erreur, tronquee."""


class UnsupportedAudioError(ValueError):
    """Le fichier n'a pas pu etre lu comme de l'audio exploitable."""


@dataclass(frozen=True, slots=True)
class DecodedAudio:
    """Audio decode, canaux en premier axe, echantillons en second."""

    samples: npt.NDArray[np.float32]
    sample_rate: int

    @property
    def channels(self) -> int:
        return int(self.samples.shape[0])

    @property
    def duration(self) -> float:
        return float(self.samples.shape[1]) / self.sample_rate

    def to_mono(self) -> npt.NDArray[np.float32]:
        """Reduction mono par moyenne : c'est ce qu'attendent les analyses."""
        if self.channels == 1:
            return np.asarray(self.samples[0], dtype=np.float32)
        return np.asarray(np.mean(self.samples, axis=0, dtype=np.float32), dtype=np.float32)


def require_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if path is None:
        raise FFmpegError("ffmpeg est introuvable dans le PATH")
    return path


def _run(args: list[str]) -> None:
    result = subprocess.run(args, capture_output=True, check=False)  # noqa: S603
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")[-2000:]
        raise FFmpegError(f"ffmpeg a echoue ({result.returncode}) : {stderr}")


def normalize_input(source: Path, destination: Path, *, mono: bool = False) -> Path:
    """Re-encode l'entree en WAV PCM 16 bits a 44,1 kHz.

    Normaliser avant toute chose evite que chaque etage doive gerer la diversite des
    formats d'entree : Demucs et Essentia recoivent toujours la meme chose.
    """
    ffmpeg = require_ffmpeg()
    destination.parent.mkdir(parents=True, exist_ok=True)
    channels = "1" if mono else "2"
    _run(
        [
            ffmpeg,
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-vn",  # une pochette embarquee serait vue comme un flux video
            "-map",
            "a:0",
            "-ac",
            channels,
            "-ar",
            str(TARGET_SAMPLE_RATE),
            "-c:a",
            "pcm_s16le",
            str(destination),
        ]
    )
    return destination


def read_audio(path: Path) -> DecodedAudio:
    """Lit un fichier audio deja normalise, en float32, canaux en premier axe."""
    try:
        data, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
    except Exception as error:  # soundfile leve des types varies selon le format
        raise UnsupportedAudioError(f"lecture impossible de {path.name}") from error

    if data.size == 0:
        raise UnsupportedAudioError(f"{path.name} ne contient aucun echantillon")

    # soundfile rend (echantillons, canaux) ; le reste du pipeline attend l'inverse.
    return DecodedAudio(samples=np.ascontiguousarray(data.T), sample_rate=int(sample_rate))


def write_wav(path: Path, samples: npt.NDArray[np.float32], sample_rate: int) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = samples if samples.ndim == 1 else samples.T
    sf.write(str(path), data, sample_rate)
    return path


def encode_opus(source: Path, destination: Path, bitrate: str = "96k") -> Path:
    """Encode en Opus. 96 kb/s suffit largement pour un stem isole."""
    ffmpeg = require_ffmpeg()
    destination.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            ffmpeg,
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-c:a",
            "libopus",
            "-b:a",
            bitrate,
            # `vbr on` et `application audio` : le defaut `voip` degraderait la
            # musique, en particulier les cymbales.
            "-vbr",
            "on",
            "-application",
            "audio",
            str(destination),
        ]
    )
    return destination


def probe_duration(path: Path) -> float:
    """Duree en secondes, via ffprobe. Sert a valider une entree avant traitement."""
    ffprobe = shutil.which("ffprobe")
    if ffprobe is None:
        raise FFmpegError("ffprobe est introuvable dans le PATH")

    result = subprocess.run(  # noqa: S603
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")[-500:]
        raise UnsupportedAudioError(f"duree illisible pour {path.name} : {stderr}")

    try:
        return float(result.stdout.decode().strip())
    except ValueError as error:
        raise UnsupportedAudioError(f"duree illisible pour {path.name}") from error
