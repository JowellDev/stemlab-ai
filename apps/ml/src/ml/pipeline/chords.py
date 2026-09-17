"""Estimation d'accords a partir d'un chromagramme.

Entierement pur et sans dependance a Essentia : la chaine prend un chromagramme
(12 bandes par trame) et rend une suite d'accords alignee sur la grille de temps.
Cela permet de tester la partie delicate — le lissage et l'alignement — sans audio.

La chaine comporte trois etages :

1. **Correspondance a des gabarits** : chaque trame est comparee par similarite
   cosinus a un gabarit par accord candidat.
2. **Lissage de Viterbi** : une matrice de transition qui favorise fortement le
   maintien de l'accord courant. Sans cela, la sortie papillonne d'une trame a
   l'autre et devient illisible.
3. **Alignement sur les temps** : chaque intervalle entre deux temps recoit
   l'accord majoritaire, puis les intervalles consecutifs identiques fusionnent.
   Un accord ne peut donc jamais commencer entre deux temps.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise

import numpy as np
import numpy.typing as npt

PITCH_CLASSES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")

#: Intervalles en demi-tons, par qualite d'accord. L'ordre fixe l'index des etats.
CHORD_QUALITIES: dict[str, tuple[int, ...]] = {
    "": (0, 4, 7),
    "m": (0, 3, 7),
    "7": (0, 4, 7, 10),
    "m7": (0, 3, 7, 10),
    "maj7": (0, 4, 7, 11),
    "dim": (0, 3, 6),
}

NO_CHORD_LABEL = "N"


@dataclass(frozen=True, slots=True)
class ChordState:
    """Un accord candidat : sa fondamentale, sa qualite et son libelle affiche."""

    root: int | None
    quality: str
    label: str


@dataclass(frozen=True, slots=True)
class ChordSegment:
    start: float
    end: float
    label: str
    root: int | None
    quality: str
    confidence: float


def build_states() -> list[ChordState]:
    """Tous les accords candidats, l'absence d'accord en premier."""
    states = [ChordState(root=None, quality="", label=NO_CHORD_LABEL)]
    for root in range(12):
        for quality in CHORD_QUALITIES:
            states.append(
                ChordState(root=root, quality=quality, label=f"{PITCH_CLASSES[root]}{quality}")
            )
    return states


def build_templates(
    states: list[ChordState], no_chord_level: float = 0.35
) -> npt.NDArray[np.float32]:
    """Gabarit binaire normalise par accord.

    Le gabarit « pas d'accord » est plat : il ne gagne que si l'energie est repartie
    uniformement sur les douze bandes, c'est-a-dire en l'absence de tonalite claire.
    Son niveau fixe le seuil a partir duquel on prefere ne rien annoncer.
    """
    templates = np.zeros((len(states), 12), dtype=np.float32)
    for index, state in enumerate(states):
        if state.root is None:
            templates[index, :] = no_chord_level
            continue
        for interval in CHORD_QUALITIES[state.quality]:
            templates[index, (state.root + interval) % 12] = 1.0

    norms = np.linalg.norm(templates, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return np.asarray(templates / norms, dtype=np.float32)


def score_frames(
    chroma: npt.NDArray[np.float32], templates: npt.NDArray[np.float32]
) -> npt.NDArray[np.float32]:
    """Similarite cosinus entre chaque trame et chaque gabarit, dans [0, 1]."""
    if chroma.ndim != 2 or chroma.shape[1] != 12:
        raise ValueError("le chromagramme doit avoir la forme (trames, 12)")

    norms = np.linalg.norm(chroma, axis=1, keepdims=True)
    # Une trame silencieuse n'a pas de direction : on la laisse a zero, ce qui
    # avantage mecaniquement le gabarit plat « pas d'accord ».
    norms[norms == 0] = 1.0
    normalized = chroma / norms
    scores: npt.NDArray[np.float32] = np.clip(normalized @ templates.T, 0.0, 1.0).astype(np.float32)
    return scores


#: Exposant applique aux scores d'emission avant le decodage.
#:
#: Les similarites cosinus sont mal calibrees comme vraisemblances : l'ecart entre
#: un accord juste (1,0) et un accord proche mais faux (0,87 pour un Fmaj7 la ou il
#: y a un Am) ne pese presque rien en logarithme, et le cout de transition ecrase
#: tout. Sans cet exposant, le lissage fusionne les accords partageant des notes —
#: une suite Am-F devient un unique Fmaj7. La valeur est calee sur un pas de trame
#: de ~46 ms : elle supprime le papillonnement d'une a deux trames tout en laissant
#: passer un changement d'accord d'une demi-seconde.
DEFAULT_SHARPNESS = 10.0


#: Cout, en nats, d'un changement d'accord entre deux observations consecutives.
#:
#: Ce n'est volontairement pas une probabilite de transition normalisee : diviser par
#: le nombre d'etats (73) donne un cout d'environ 6,8 nats par changement, ce qui
#: ecrase tout des que les observations sont peu nombreuses. Exprimee en cout, la
#: penalite a un sens direct : un changement est accepte s'il ameliore
#: l'ajustement d'au moins cette quantite.
#:
#: Deux valeurs, parce qu'une observation ne represente pas la meme chose selon le
#: mode : un temps entier en decodage synchrone, une tranche de 46 ms en repli.
BEAT_SWITCH_PENALTY = 2.5
FRAME_SWITCH_PENALTY = 12.0


def viterbi_smooth(
    scores: npt.NDArray[np.float32],
    switch_penalty: float = BEAT_SWITCH_PENALTY,
    sharpness: float = DEFAULT_SHARPNESS,
) -> npt.NDArray[np.int64]:
    """Suite d'accords de cout minimal a travers les observations.

    Le modele de transition est volontairement trivial : rester sur le meme accord
    est gratuit, tout changement coute `switch_penalty`, quel que soit l'accord
    d'arrivee. Une matrice apprise ferait mieux, mais demanderait un corpus annote ;
    ce reglage suffit a supprimer le papillonnement, qui est le vrai defaut d'un
    decodage observation par observation.
    """
    if switch_penalty < 0.0:
        raise ValueError("switch_penalty doit etre positif ou nul")
    if sharpness <= 0.0:
        raise ValueError("sharpness doit etre strictement positif")

    frames, states = scores.shape
    if frames == 0:
        return np.zeros(0, dtype=np.int64)

    # Travail en log : les produits de vraisemblances sur des milliers
    # d'observations deborderaient vers zero en arithmetique lineaire.
    epsilon = 1e-9
    log_emission = sharpness * np.log(scores + epsilon)
    log_stay = 0.0
    log_switch = -switch_penalty

    best = log_emission[0].copy()
    backpointers = np.zeros((frames, states), dtype=np.int64)

    for frame in range(1, frames):
        overall_best = int(np.argmax(best))
        # Toutes les transitions entrantes ayant le meme cout hors auto-transition,
        # le meilleur predecesseur est soit l'etat lui-meme, soit le meilleur global.
        from_switch = best[overall_best] + log_switch
        from_stay = best + log_stay

        stay_wins = from_stay >= from_switch
        backpointers[frame] = np.where(stay_wins, np.arange(states), overall_best)
        best = np.where(stay_wins, from_stay, from_switch) + log_emission[frame]

    path = np.zeros(frames, dtype=np.int64)
    path[-1] = int(np.argmax(best))
    for frame in range(frames - 1, 0, -1):
        path[frame - 1] = backpointers[frame, path[frame]]
    return path


def pool_by_beats(
    chroma: npt.NDArray[np.float32],
    frame_times: npt.NDArray[np.float64],
    boundaries: list[float],
) -> npt.NDArray[np.float32]:
    """Un vecteur de chroma par intervalle entre deux temps, par mediane.

    Le decodage se fait sur ces vecteurs plutot que sur les trames brutes. C'est la
    pratique courante en reconnaissance d'accords, pour deux raisons : la mediane
    ecarte les transitoires percussifs qui ne durent qu'une trame ou deux, et le cout
    de transition prend un sens musical — il s'exprime par temps et non par tranche
    de 46 ms, ou il ne voulait rien dire.
    """
    pooled = np.zeros((max(0, len(boundaries) - 1), 12), dtype=np.float32)
    for index, (start, end) in enumerate(pairwise(boundaries)):
        lo = int(np.searchsorted(frame_times, start, side="left"))
        hi = int(np.searchsorted(frame_times, end, side="left"))
        if hi > lo:
            pooled[index] = np.median(chroma[lo:hi], axis=0)
    return pooled


def beat_boundaries(beats: list[float], duration: float) -> list[float]:
    """Bornes des intervalles entre temps, completees jusqu'aux extremites."""
    usable = sorted(beat for beat in beats if 0.0 <= beat <= duration)
    if len(usable) < 2:
        return []
    boundaries = list(usable)
    if boundaries[0] > 0.0:
        boundaries.insert(0, 0.0)
    if duration > boundaries[-1]:
        boundaries.append(duration)
    return boundaries


def segments_from_path(
    path: npt.NDArray[np.int64],
    scores: npt.NDArray[np.float32],
    boundaries: list[float],
    states: list[ChordState],
) -> list[ChordSegment]:
    """Transforme un chemin d'etats en segments, puis fusionne les repetitions."""
    segments = [
        ChordSegment(
            start=round(boundaries[index], 4),
            end=round(boundaries[index + 1], 4),
            label=states[int(state)].label,
            root=states[int(state)].root,
            quality=states[int(state)].quality,
            confidence=round(float(scores[index, int(state)]), 4),
        )
        for index, state in enumerate(path)
    ]
    return _merge(segments)


def _merge(segments: list[ChordSegment]) -> list[ChordSegment]:
    """Fusionne les intervalles consecutifs portant le meme accord."""
    merged: list[ChordSegment] = []
    for segment in segments:
        previous = merged[-1] if merged else None
        if previous is not None and previous.label == segment.label:
            total = (previous.end - previous.start) + (segment.end - segment.start)
            weight = (segment.end - segment.start) / total if total > 0 else 0.5
            merged[-1] = ChordSegment(
                start=previous.start,
                end=segment.end,
                label=previous.label,
                root=previous.root,
                quality=previous.quality,
                confidence=round(
                    previous.confidence * (1 - weight) + segment.confidence * weight, 4
                ),
            )
            continue
        merged.append(segment)
    return merged


def estimate_chords(
    chroma: npt.NDArray[np.float32],
    frame_times: npt.NDArray[np.float64],
    beats: list[float],
    sharpness: float = DEFAULT_SHARPNESS,
) -> list[ChordSegment]:
    """Chaine complete : chroma synchrone aux temps, gabarits, lissage de Viterbi.

    Sans grille de temps exploitable, on retombe sur un decodage trame par trame :
    la sortie est plus bruitee, mais il vaut mieux des accords approximatifs que
    pas d'accords du tout.
    """
    if chroma.shape[0] == 0 or frame_times.size == 0:
        return []

    states = build_states()
    templates = build_templates(states)
    duration = float(frame_times[-1])

    boundaries = beat_boundaries(beats, duration)
    if len(boundaries) < 2:
        boundaries = [float(time) for time in frame_times] + [duration]
        pooled = chroma
        penalty = FRAME_SWITCH_PENALTY
    else:
        pooled = pool_by_beats(chroma, frame_times, boundaries)
        penalty = BEAT_SWITCH_PENALTY

    scores = score_frames(pooled, templates)
    path = viterbi_smooth(scores, penalty, sharpness)
    return segments_from_path(path, scores, boundaries, states)


#: Qualites d'accord qui portent chacun des deux modes.
MAJOR_QUALITIES = ("", "maj7", "7")
MINOR_QUALITIES = ("m", "m7")

#: Avance requise, en proportion, pour preferer le relatif a la reponse d'Essentia.
RELATIVE_KEY_MARGIN = 1.2

#: Poids accorde au premier et au dernier accord dans le calcul du soutien.
#:
#: En musique tonale, une piece commence et se termine massivement sur sa tonique :
#: c'est l'indice le plus fiable dont on dispose, et le seul qui separe reellement
#: une suite comme F#m-D-A-E (fa diese mineur) de la meme suite lue en la majeur.
#: Sans lui, seule la duree cumulee compte, et les deux lectures s'equilibrent.
EDGE_CHORD_WEIGHT = 3.0


def refine_key_with_chords(key: str, mode: str, segments: list[ChordSegment]) -> tuple[str, str]:
    """Tranche entre une tonalite et son relatif a partir des accords joues.

    Les estimateurs de tonalite confondent regulierement une tonalite mineure et son
    relatif majeur : les deux partagent exactement la meme armure, donc le meme
    profil de hauteurs. Seul l'usage les separe — et l'indice le plus simple est
    l'accord de tonique, qui est presque toujours le plus joue.

    On ne bascule qu'avec une marge franche : en cas d'egalite, la reponse de
    l'estimateur est conservee, faute de raison de la contredire.
    """
    if key not in PITCH_CLASSES or not segments:
        return key, mode

    tonic = PITCH_CLASSES.index(key)
    # Le relatif mineur est trois demi-tons sous la tonique majeure, et inversement.
    relative_root = (tonic - 3) % 12 if mode == "major" else (tonic + 3) % 12
    relative_mode = "minor" if mode == "major" else "major"

    current = _tonic_support(segments, tonic, mode)
    alternative = _tonic_support(segments, relative_root, relative_mode)

    if alternative > current * RELATIVE_KEY_MARGIN:
        return PITCH_CLASSES[relative_root], relative_mode
    return key, mode


def _tonic_support(segments: list[ChordSegment], root: int, mode: str) -> float:
    """Duree cumulee de l'accord de tonique, premier et dernier accords surponderes."""
    qualities = MAJOR_QUALITIES if mode == "major" else MINOR_QUALITIES
    last = len(segments) - 1
    return sum(
        (segment.end - segment.start) * (EDGE_CHORD_WEIGHT if index in (0, last) else 1.0)
        for index, segment in enumerate(segments)
        if segment.root == root and segment.quality in qualities
    )
