"""Analyse musicale : tonalite, tempo, grille de temps, chromagramme.

Essentia est importe paresseusement. Deux raisons : le chargement de la
bibliotheque native coute une seconde, et surtout, cela isole la seule dependance
AGPL du projet derriere une frontiere nette — remplacer cet etage ne demande que de
reimplementer les trois fonctions ci-dessous.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt

from ml.pipeline.chords import PITCH_CLASSES

#: Classe de hauteur du premier bin du HPCP d'Essentia.
#:
#: La frequence de reference par defaut est 440 Hz : le bin 0 est donc un la, pas un
#: do. Ce n'est pas deductible de la documentation sans ambiguite — la valeur a ete
#: mesuree en passant les douze notes chromatiques dans l'extracteur, et le test
#: `test_le_premier_bin_du_hpcp_est_un_la` la reverifie.
HPCP_FIRST_PITCH_CLASS = "A"

#: Rotation a appliquer pour ramener le bin 0 sur do.
HPCP_ROLL_TO_C = (12 - PITCH_CLASSES.index(HPCP_FIRST_PITCH_CLASS)) % 12

#: Bande de frequences retenue pour le chromagramme.
#:
#: La borne basse ecarte le fondamental de la grosse caisse, qui balaie typiquement
#: 40 a 130 Hz : une descente en frequence n'a pas de hauteur definie et etale son
#: energie sur les douze bandes, ce qui brouille la detection d'accords. 55 Hz (la1)
#: reste sous la plus basse note jouable par une basse a quatre cordes (mi1, 41 Hz —
#: dont la fondamentale est de toute facon plus faible que son premier harmonique).
#:
#: La borne haute est fixee a 2 kHz : au-dela, il n'y a plus que des harmoniques,
#: que le HPCP replie deja via son parametre `harmonics`.
CHROMA_MIN_HZ = 55.0
CHROMA_MAX_HZ = 2000.0

#: Taille de trame et pas d'avance du chromagramme. 4096/2048 a 44,1 kHz donne une
#: trame toutes les ~46 ms : assez fin pour suivre un changement d'accord, assez
#: large pour que la basse (jusqu'a ~40 Hz) soit resolue.
FRAME_SIZE = 4096
HOP_SIZE = 2048


@dataclass(frozen=True, slots=True)
class KeyEstimate:
    key: str
    mode: str
    confidence: float


@dataclass(frozen=True, slots=True)
class RhythmEstimate:
    bpm: float
    beats: list[float]
    confidence: float


def _essentia() -> Any:
    import essentia.standard as es

    return es


def estimate_key(mono: npt.NDArray[np.float32]) -> KeyEstimate:
    """Tonalite et mode, via le profil `temperley` d'Essentia.

    `temperley` est retenu plutot que le profil par defaut `bgate` : il se comporte
    nettement mieux sur de la musique populaire, ou la tierce est souvent portee par
    la voix plutot que par l'harmonie.
    """
    es = _essentia()
    key, scale, strength = es.KeyExtractor(profileType="temperley")(np.ascontiguousarray(mono))
    return KeyEstimate(
        key=_normalize_pitch_class(str(key)),
        mode="minor" if str(scale).lower().startswith("min") else "major",
        confidence=round(float(strength), 4),
    )


def estimate_rhythm(mono: npt.NDArray[np.float32]) -> RhythmEstimate:
    """Tempo et positions des temps, via `RhythmExtractor2013` (methode multifeature)."""
    es = _essentia()
    bpm, ticks, confidence, _estimates, _intervals = es.RhythmExtractor2013(method="multifeature")(
        np.ascontiguousarray(mono)
    )
    return RhythmEstimate(
        bpm=round(float(bpm), 2),
        beats=[round(float(tick), 4) for tick in ticks],
        # La confiance de RhythmExtractor2013 va de 0 a 5,32 : on la ramene dans [0, 1].
        confidence=round(min(float(confidence) / 5.32, 1.0), 4),
    )


def compute_chroma(
    mono: npt.NDArray[np.float32], sample_rate: int
) -> tuple[npt.NDArray[np.float32], npt.NDArray[np.float64]]:
    """Chromagramme HPCP et instant central de chaque trame.

    Le HPCP est calcule apres detection de pics spectraux plutot que directement sur
    le spectre : cela ecarte une bonne partie du bruit percussif, qui sinon etale de
    l'energie sur les douze bandes et brouille la detection d'accords.
    """
    es = _essentia()
    window = es.Windowing(type="blackmanharris62", size=FRAME_SIZE)
    spectrum = es.Spectrum(size=FRAME_SIZE)
    peaks = es.SpectralPeaks(
        sampleRate=sample_rate,
        magnitudeThreshold=1e-5,
        minFrequency=CHROMA_MIN_HZ,
        maxFrequency=CHROMA_MAX_HZ,
    )
    hpcp = es.HPCP(sampleRate=sample_rate, size=12, harmonics=8, weightType="cosine")

    frames: list[npt.NDArray[np.float32]] = []
    signal = np.ascontiguousarray(mono)
    for frame in es.FrameGenerator(
        signal, frameSize=FRAME_SIZE, hopSize=HOP_SIZE, startFromZero=True
    ):
        frequencies, magnitudes = peaks(spectrum(window(frame)))
        frames.append(np.asarray(hpcp(frequencies, magnitudes), dtype=np.float32))

    if not frames:
        return np.zeros((0, 12), dtype=np.float32), np.zeros(0, dtype=np.float64)

    chroma = np.vstack(frames)
    chroma = np.roll(chroma, shift=-HPCP_ROLL_TO_C, axis=1)

    times = (np.arange(chroma.shape[0]) * HOP_SIZE + FRAME_SIZE / 2) / sample_rate
    return chroma, times.astype(np.float64)


def _normalize_pitch_class(name: str) -> str:
    """Essentia rend parfois des bemols ; le reste du systeme raisonne en dieses."""
    flats = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B", "Fb": "E"}
    normalized = flats.get(name, name)
    if normalized not in PITCH_CLASSES:
        raise ValueError(f"classe de hauteur inconnue : {name}")
    return normalized
