"""Tests d'integration avec Essentia.

Ils tournent sur quelques secondes de signal synthetique : c'est assez pour verifier
le cablage — notamment l'alignement du chromagramme, qui est silencieux quand il est
faux et fausse alors *tous* les accords.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt
import pytest

from ml.pipeline.analysis import compute_chroma, estimate_key, estimate_rhythm
from ml.pipeline.chords import PITCH_CLASSES
from tests.conftest import essentia_required

pytestmark = essentia_required

SAMPLE_RATE = 44_100
C4 = 261.63


def sine(frequency: float, seconds: float = 2.0) -> npt.NDArray[np.float32]:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return np.ascontiguousarray(np.sin(2 * np.pi * frequency * t).astype(np.float32))


def chord(semitones: tuple[int, ...], seconds: float = 2.0) -> npt.NDArray[np.float32]:
    total = np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)
    for semitone in semitones:
        total += sine(C4 * 2 ** (semitone / 12), seconds)
    return np.ascontiguousarray(total / len(semitones), dtype=np.float32)


@pytest.mark.parametrize(("name", "semitone"), list(zip(PITCH_CLASSES, range(12), strict=True)))
def test_le_chromagramme_est_aligne_sur_do(name: str, semitone: int) -> None:
    """Le bin 0 doit etre un do, pas le la de la frequence de reference d'Essentia."""
    chroma, _times = compute_chroma(sine(C4 * 2 ** (semitone / 12)), SAMPLE_RATE)
    dominant = int(np.argmax(chroma.mean(axis=0)))
    assert PITCH_CLASSES[dominant] == name


def test_le_chromagramme_rend_un_instant_par_trame() -> None:
    chroma, times = compute_chroma(sine(C4, seconds=3.0), SAMPLE_RATE)
    assert chroma.shape[0] == times.size
    assert chroma.shape[1] == 12
    assert np.all(np.diff(times) > 0)
    assert times[-1] == pytest.approx(3.0, abs=0.2)


def test_le_chromagramme_d_un_accord_fait_ressortir_ses_notes() -> None:
    # Do majeur : do, mi, sol.
    chroma, _times = compute_chroma(chord((0, 4, 7)), SAMPLE_RATE)
    averaged = chroma.mean(axis=0)
    trois_plus_fortes = set(np.argsort(averaged)[-3:].tolist())
    assert trois_plus_fortes == {0, 4, 7}


def test_signal_vide() -> None:
    chroma, times = compute_chroma(np.zeros(0, dtype=np.float32), SAMPLE_RATE)
    assert chroma.shape == (0, 12)
    assert times.size == 0


def test_estime_une_tonalite() -> None:
    estimate = estimate_key(chord((0, 4, 7), seconds=4.0))
    assert estimate.key in PITCH_CLASSES
    assert estimate.mode in {"major", "minor"}
    assert 0.0 <= estimate.confidence <= 1.0


def test_estime_un_tempo_sur_une_pulsation_reguliere() -> None:
    # Une impulsion toutes les 0,5 s : 120 BPM.
    signal = np.zeros(int(8 * SAMPLE_RATE), dtype=np.float32)
    for index in range(16):
        start = int(index * 0.5 * SAMPLE_RATE)
        burst = np.exp(-np.arange(2205) / 400.0).astype(np.float32)
        signal[start : start + burst.size] += burst

    estimate = estimate_rhythm(np.ascontiguousarray(signal))
    # Les extracteurs de tempo confondent souvent une pulsation avec son double ou
    # sa moitie : on accepte les trois lectures.
    assert any(abs(estimate.bpm - candidate) < 6 for candidate in (60.0, 120.0, 240.0))
    assert len(estimate.beats) > 4
    assert estimate.beats == sorted(estimate.beats)
    assert 0.0 <= estimate.confidence <= 1.0
