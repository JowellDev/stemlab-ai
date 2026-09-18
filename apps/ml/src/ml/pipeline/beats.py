"""Grille de mesures : signature rythmique et numerotation des temps.

Pur et sans dependance a Essentia : on part d'une liste d'instants de temps et on
en deduit le premier temps fort et la position de chaque temps dans la mesure.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt


@dataclass(frozen=True, slots=True)
class BeatGrid:
    numerator: int
    denominator: int
    first_beat_offset: float
    #: (instant, position dans la mesure, 1-indexee)
    beats: list[tuple[float, int]]


def build_grid(
    beat_times: list[float],
    loudness: npt.NDArray[np.float32] | None = None,
    numerator: int = 4,
    denominator: int = 4,
    chord_starts: list[float] | None = None,
) -> BeatGrid:
    """Numerote les temps dans la mesure.

    La phase — quel temps est le « un » — est choisie en maximisant l'energie sur
    les temps forts, quand une courbe d'energie par temps est fournie. Sans elle, on
    retombe sur la convention la plus courante : le premier temps detecte est un
    temps fort. C'est faux pour un morceau qui commence par une levee, mais c'est
    l'hypothese la moins couteuse a corriger a l'ecoute.

    L'heuristique n'est appliquee que si elle a de quoi decider : au moins deux
    mesures completes, et un ecart franc entre la meilleure phase et les autres.
    Sur quelques temps d'un signal regulier, les energies sont quasi identiques et
    `argmax` designerait une phase au hasard — ce qui decalerait toute la grille
    affichee pour rien.

    La signature 4/4 est imposee par defaut : la deduire de l'audio demanderait un
    modele dedie, et se tromper sur ce point desaligne toute la grille.
    """
    if numerator < 1:
        raise ValueError("le numerateur doit valoir au moins 1")

    ordered = sorted(float(beat) for beat in beat_times)
    if not ordered:
        return BeatGrid(numerator, denominator, 0.0, [])

    # Les changements d'accord priment sur l'energie : une harmonie change presque
    # toujours sur un temps fort, alors qu'une batterie reguliere donne la meme
    # energie a tous les temps et ne permet pas de trancher.
    phase = _choose_phase_from_chords(ordered, chord_starts, numerator)
    if phase is None:
        phase = _choose_phase(ordered, loudness, numerator)

    beats = [
        (round(time, 4), ((index - phase) % numerator) + 1) for index, time in enumerate(ordered)
    ]
    downbeats = [time for time, position in beats if position == 1]
    first = downbeats[0] if downbeats else ordered[0]

    return BeatGrid(
        numerator=numerator,
        denominator=denominator,
        first_beat_offset=round(first, 4),
        beats=beats,
    )


#: Ecart relatif minimal entre la meilleure phase et la moyenne des autres.
PHASE_MARGIN = 0.15

#: Avance minimale, en nombre de changements d'accord, pour retenir une phase.
CHORD_PHASE_MARGIN = 2

#: Tolerance d'alignement entre un changement d'accord et un temps, en fraction
#: de l'intervalle entre deux temps.
CHORD_SNAP_RATIO = 0.4


def _choose_phase_from_chords(
    ordered: list[float], chord_starts: list[float] | None, numerator: int
) -> int | None:
    """Phase qui place le plus de changements d'accord sur un temps fort.

    Renvoie `None` quand l'indice est trop faible pour trancher : trop peu de
    changements, ou plusieurs phases a egalite.
    """
    if not chord_starts or len(ordered) < numerator:
        return None

    beats = np.asarray(ordered, dtype=np.float64)
    spacing = float(np.median(np.diff(beats))) if beats.size > 1 else 0.0
    if spacing <= 0.0:
        return None
    tolerance = spacing * CHORD_SNAP_RATIO

    counts = np.zeros(numerator, dtype=np.int64)
    for start in chord_starts:
        index = int(np.argmin(np.abs(beats - start)))
        if abs(float(beats[index]) - start) > tolerance:
            continue
        counts[index % numerator] += 1

    best = int(np.argmax(counts))
    others = np.delete(counts, best)
    if counts[best] == 0 or counts[best] - int(np.max(others)) < CHORD_PHASE_MARGIN:
        return None
    return best


#: Nombre minimal de mesures completes avant de se fier a l'energie.
MIN_BARS_FOR_PHASE = 2


def _choose_phase(
    ordered: list[float], loudness: npt.NDArray[np.float32] | None, numerator: int
) -> int:
    """Index du temps fort, ou 0 si l'energie ne permet pas de trancher."""
    if loudness is None or loudness.size < len(ordered):
        return 0
    if len(ordered) < numerator * MIN_BARS_FOR_PHASE:
        return 0

    scores = np.array(
        [
            float(np.mean(loudness[candidate : len(ordered) : numerator]))
            for candidate in range(numerator)
        ]
    )
    best = int(np.argmax(scores))
    others = np.delete(scores, best)
    if others.size == 0:
        return 0

    reference = float(np.mean(others))
    if reference <= 0.0:
        return best if scores[best] > 0.0 else 0
    return best if (scores[best] - reference) / reference >= PHASE_MARGIN else 0


def beat_loudness(
    mono: npt.NDArray[np.float32], sample_rate: int, beat_times: list[float], window: float = 0.12
) -> npt.NDArray[np.float32]:
    """Energie efficace autour de chaque temps, pour departager les phases."""
    half = max(1, int(window * sample_rate / 2))
    values = np.zeros(len(beat_times), dtype=np.float32)
    for index, time in enumerate(sorted(beat_times)):
        center = int(time * sample_rate)
        lo = max(0, center - half)
        hi = min(mono.size, center + half)
        if hi > lo:
            values[index] = float(np.sqrt(np.mean(np.square(mono[lo:hi]))))
    return values
