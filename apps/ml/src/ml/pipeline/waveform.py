"""Calcul des peaks de forme d'onde."""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

DEFAULT_POINTS_PER_SECOND = 512


def compute_peaks(
    samples: npt.NDArray[np.float32],
    sample_rate: int,
    points_per_second: int = DEFAULT_POINTS_PER_SECOND,
) -> list[float]:
    """Amplitude crete absolue par fenetre, normalisee dans [0, 1].

    On prend le maximum et non la moyenne : une moyenne lisserait les transitoires
    et ferait disparaitre les attaques de batterie, qui sont precisement ce qu'on
    veut voir sur une forme d'onde.

    `samples` peut etre mono (1-D) ou multicanal (2-D, canaux en premier axe) ;
    dans ce cas les canaux sont reduits par maximum, pas par moyenne, pour la
    meme raison.
    """
    if points_per_second <= 0:
        raise ValueError("points_per_second doit etre strictement positif")
    if sample_rate <= 0:
        raise ValueError("sample_rate doit etre strictement positif")

    mono = np.abs(samples if samples.ndim == 1 else np.max(np.abs(samples), axis=0))
    if mono.size == 0:
        return []

    window = max(1, round(sample_rate / points_per_second))
    count = int(np.ceil(mono.size / window))
    padded = np.zeros(count * window, dtype=np.float32)
    padded[: mono.size] = mono

    peaks = padded.reshape(count, window).max(axis=1)
    peaks = np.clip(peaks, 0.0, 1.0)
    return [round(float(value), 4) for value in peaks]
