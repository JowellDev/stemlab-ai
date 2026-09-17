from itertools import pairwise

import numpy as np
import numpy.typing as npt
import pytest

from ml.pipeline.chords import (
    CHORD_QUALITIES,
    FRAME_SWITCH_PENALTY,
    NO_CHORD_LABEL,
    PITCH_CLASSES,
    ChordSegment,
    beat_boundaries,
    build_states,
    build_templates,
    estimate_chords,
    pool_by_beats,
    refine_key_with_chords,
    score_frames,
    segments_from_path,
    viterbi_smooth,
)


def chroma_for(*pitch_classes: int, frames: int = 1, noise: float = 0.0) -> npt.NDArray[np.float32]:
    """Chromagramme synthetique : energie sur les classes donnees."""
    single = np.full(12, noise, dtype=np.float32)
    for pitch_class in pitch_classes:
        single[pitch_class] = 1.0
    return np.tile(single, (frames, 1))


class TestEtats:
    def test_comprend_tous_les_accords_et_le_silence(self) -> None:
        states = build_states()
        assert len(states) == 1 + 12 * len(CHORD_QUALITIES)
        assert states[0].label == NO_CHORD_LABEL
        assert states[0].root is None

    def test_les_libelles_suivent_la_convention_usuelle(self) -> None:
        labels = {state.label for state in build_states()}
        assert {"C", "Am", "G7", "Dm7", "Fmaj7", "Bdim"} <= labels

    def test_utilise_des_dieses(self) -> None:
        labels = {state.label for state in build_states()}
        assert "C#" in labels
        assert not any("b" in label[:2] for label in labels if label != NO_CHORD_LABEL)


class TestGabarits:
    def test_sont_normalises(self) -> None:
        templates = build_templates(build_states())
        assert np.allclose(np.linalg.norm(templates, axis=1), 1.0)

    def test_le_gabarit_sans_accord_est_plat(self) -> None:
        templates = build_templates(build_states())
        assert np.allclose(templates[0], templates[0][0])


class TestScores:
    def test_un_accord_parfait_gagne_sur_son_propre_gabarit(self) -> None:
        states = build_states()
        templates = build_templates(states)
        # Do majeur : do, mi, sol.
        scores = score_frames(chroma_for(0, 4, 7), templates)
        assert states[int(np.argmax(scores[0]))].label == "C"

    def test_distingue_majeur_et_mineur(self) -> None:
        states = build_states()
        templates = build_templates(states)
        # La mineur : la, do, mi.
        scores = score_frames(chroma_for(9, 0, 4), templates)
        assert states[int(np.argmax(scores[0]))].label == "Am"

    def test_une_trame_silencieuse_favorise_l_absence_d_accord(self) -> None:
        states = build_states()
        templates = build_templates(states)
        scores = score_frames(np.zeros((1, 12), dtype=np.float32), templates)
        assert states[int(np.argmax(scores[0]))].label == NO_CHORD_LABEL

    def test_rejette_un_chromagramme_mal_forme(self) -> None:
        with pytest.raises(ValueError):
            score_frames(np.zeros((4, 7), dtype=np.float32), build_templates(build_states()))


class TestViterbi:
    def test_supprime_le_papillonnement(self) -> None:
        states = build_states()
        templates = build_templates(states)
        # Neuf trames de do majeur avec une trame parasite de sol au milieu.
        frames = [chroma_for(0, 4, 7) for _ in range(9)]
        frames[4] = chroma_for(7, 11, 2)
        scores = score_frames(np.vstack(frames), templates)

        raw = [states[int(index)].label for index in np.argmax(scores, axis=1)]
        smoothed = [
            states[int(index)].label for index in viterbi_smooth(scores, FRAME_SWITCH_PENALTY)
        ]

        assert raw[4] == "G"  # le decodage trame par trame suit le parasite
        assert set(smoothed) == {"C"}  # le lissage le rejette

    def test_suit_un_vrai_changement_d_accord(self) -> None:
        states = build_states()
        templates = build_templates(states)
        frames = [chroma_for(0, 4, 7) for _ in range(20)] + [chroma_for(5, 9, 0) for _ in range(20)]
        path = viterbi_smooth(score_frames(np.vstack(frames), templates), FRAME_SWITCH_PENALTY)
        labels = [states[int(index)].label for index in path]
        assert labels[0] == "C"
        assert labels[-1] == "F"

    def test_chemin_vide_pour_une_entree_vide(self) -> None:
        assert viterbi_smooth(np.zeros((0, 73), dtype=np.float32)).size == 0

    def test_rejette_une_penalite_negative(self) -> None:
        with pytest.raises(ValueError):
            viterbi_smooth(np.ones((3, 4), dtype=np.float32), switch_penalty=-1.0)

    @pytest.mark.parametrize("value", [0.0, -1.0])
    def test_rejette_une_nettete_non_positive(self, value: float) -> None:
        with pytest.raises(ValueError):
            viterbi_smooth(np.ones((3, 4), dtype=np.float32), sharpness=value)

    def test_une_penalite_nulle_laisse_passer_le_papillonnement(self) -> None:
        states = build_states()
        templates = build_templates(states)
        frames = [chroma_for(0, 4, 7) for _ in range(5)]
        frames[2] = chroma_for(7, 11, 2)
        scores = score_frames(np.vstack(frames), templates)
        labels = [states[int(i)].label for i in viterbi_smooth(scores, switch_penalty=0.0)]
        assert labels[2] == "G"


class TestAlignement:
    def test_les_accords_commencent_sur_un_temps(self) -> None:
        frames = [chroma_for(0, 4, 7) for _ in range(10)] + [chroma_for(5, 9, 0) for _ in range(10)]
        chroma = np.vstack(frames)
        times = np.arange(20, dtype=np.float64) * 0.1
        segments = estimate_chords(chroma, times, [0.0, 0.5, 1.0, 1.5])

        assert segments
        for segment in segments:
            assert segment.start in {0.0, 0.5, 1.0, 1.5}

    def test_pool_par_temps_rend_un_vecteur_par_intervalle(self) -> None:
        chroma = chroma_for(0, 4, 7, frames=40)
        times = np.arange(40, dtype=np.float64) * 0.05
        boundaries = beat_boundaries([0.0, 0.5, 1.0, 1.5], duration=1.95)
        assert pool_by_beats(chroma, times, boundaries).shape == (len(boundaries) - 1, 12)

    def test_pool_par_temps_ecarte_un_transitoire_isole(self) -> None:
        frames = [chroma_for(0, 4, 7) for _ in range(10)]
        frames[3] = chroma_for(1, 5, 8)  # une trame parasite
        chroma = np.vstack(frames)
        times = np.arange(10, dtype=np.float64) * 0.1
        pooled = pool_by_beats(chroma, times, [0.0, 1.0])
        # La mediane ignore le parasite minoritaire.
        assert sorted(np.argsort(pooled[0])[-3:].tolist()) == [0, 4, 7]

    def test_les_bornes_completent_les_extremites(self) -> None:
        assert beat_boundaries([0.5, 1.0], duration=2.0) == [0.0, 0.5, 1.0, 2.0]
        assert beat_boundaries([0.0, 1.0], duration=1.0) == [0.0, 1.0]

    def test_les_bornes_ignorent_une_grille_trop_courte(self) -> None:
        assert beat_boundaries([], duration=5.0) == []
        assert beat_boundaries([1.0], duration=5.0) == []

    def test_segments_depuis_un_chemin(self) -> None:
        states = build_states()
        scores = np.zeros((2, len(states)), dtype=np.float32)
        scores[:, 1] = 0.9
        segments = segments_from_path(
            np.array([1, 1], dtype=np.int64), scores, [0.0, 1.0, 2.0], states
        )
        # Deux intervalles portant le meme accord : un seul segment.
        assert len(segments) == 1
        assert (segments[0].start, segments[0].end) == (0.0, 2.0)

    def test_fusionne_les_intervalles_identiques(self) -> None:
        chroma = chroma_for(0, 4, 7, frames=20)
        times = np.arange(20, dtype=np.float64) * 0.1
        segments = estimate_chords(chroma, times, [0.0, 0.5, 1.0, 1.5])
        # Quatre intervalles de temps portant le meme accord : un seul segment.
        assert len(segments) == 1
        assert segments[0].label == "C"

    def test_sans_grille_de_temps_un_seul_segment(self) -> None:
        chroma = chroma_for(0, 4, 7, frames=10)
        times = np.arange(10, dtype=np.float64) * 0.1
        segments = estimate_chords(chroma, times, [])
        assert len(segments) == 1

    def test_les_segments_sont_ordonnes_et_contigus(self) -> None:
        frames = [chroma_for(0, 4, 7) for _ in range(20)] + [
            chroma_for(7, 11, 2) for _ in range(20)
        ]
        chroma = np.vstack(frames)
        times = np.arange(40, dtype=np.float64) * 0.05
        segments = estimate_chords(chroma, times, [0.0, 0.5, 1.0, 1.5])

        for previous, following in pairwise(segments):
            assert previous.end <= following.start
            assert previous.end > previous.start

    def test_la_confiance_reste_dans_les_bornes(self) -> None:
        chroma = chroma_for(0, 4, 7, frames=12, noise=0.2)
        times = np.arange(12, dtype=np.float64) * 0.1
        for segment in estimate_chords(chroma, times, [0.0, 0.4, 0.8]):
            assert 0.0 <= segment.confidence <= 1.0


def test_detecte_une_suite_am_f_c_g() -> None:
    """Le cas de reference : la grille des stems de test."""
    progression = {
        "Am": (9, 0, 4),
        "F": (5, 9, 0),
        "C": (0, 4, 7),
        "G": (7, 11, 2),
    }
    frames: list[npt.NDArray[np.float32]] = []
    beats: list[float] = []
    for index, pitches in enumerate(progression.values()):
        frames.extend(chroma_for(*pitches) for _ in range(20))
        beats.append(index * 2.0)
    beats.append(len(progression) * 2.0)

    chroma = np.vstack(frames)
    times = np.arange(chroma.shape[0], dtype=np.float64) * 0.1
    segments = estimate_chords(chroma, times, beats)

    assert [segment.label for segment in segments] == list(progression)


def test_les_classes_de_hauteur_couvrent_l_octave() -> None:
    assert len(PITCH_CLASSES) == 12
    assert len(set(PITCH_CLASSES)) == 12


class TestReconciliationDeTonalite:
    """Une tonalite mineure et son relatif majeur ont la meme armure : seuls les
    accords joues permettent de les distinguer."""

    def test_bascule_vers_le_relatif_mineur_si_sa_tonique_domine(self) -> None:
        # Am F C G : Essentia lit souvent do majeur ; l'accord de la mineur domine.
        chords = [
            ChordSegment(0, 4, "Am", 9, "m", 0.9),
            ChordSegment(4, 6, "F", 5, "", 0.9),
            ChordSegment(6, 7, "C", 0, "", 0.9),
            ChordSegment(7, 8, "G", 7, "", 0.9),
        ]
        assert refine_key_with_chords("C", "major", chords) == ("A", "minor")

    def test_bascule_vers_le_relatif_majeur(self) -> None:
        chords = [
            ChordSegment(0, 6, "C", 0, "", 0.9),
            ChordSegment(6, 7, "Am", 9, "m", 0.9),
        ]
        assert refine_key_with_chords("A", "minor", chords) == ("C", "major")

    def test_conserve_la_reponse_de_l_estimateur_en_cas_d_egalite(self) -> None:
        chords = [
            ChordSegment(0, 2, "D", 2, "", 0.9),
            ChordSegment(2, 4, "Bm", 11, "m", 0.9),
        ]
        assert refine_key_with_chords("D", "major", chords) == ("D", "major")

    def test_tient_compte_des_septiemes(self) -> None:
        # Dmaj7 doit compter comme un accord majeur, A7 aussi.
        chords = [
            ChordSegment(0, 6, "Dmaj7", 2, "maj7", 0.9),
            ChordSegment(6, 7, "Bm", 11, "m", 0.9),
        ]
        assert refine_key_with_chords("B", "minor", chords) == ("D", "major")

    def test_sans_accord_la_tonalite_est_inchangee(self) -> None:
        assert refine_key_with_chords("E", "minor", []) == ("E", "minor")

    def test_une_tonalite_inconnue_est_inchangee(self) -> None:
        chords = [ChordSegment(0, 4, "Am", 9, "m", 0.9)]
        assert refine_key_with_chords("H", "major", chords) == ("H", "major")


class TestPonderationDesAccordsExtremes:
    def test_le_premier_accord_departage_une_suite_ambigue(self) -> None:
        # F#m D A E se lit aussi bien en la majeur : les deux toniques sont jouees
        # aussi longtemps l'une que l'autre. Seul l'accord de depart tranche.
        chords = [
            ChordSegment(0, 2, "F#m", 6, "m", 0.9),
            ChordSegment(2, 4, "D", 2, "", 0.9),
            ChordSegment(4, 6, "A", 9, "", 0.9),
            ChordSegment(6, 8, "E", 4, "", 0.9),
            ChordSegment(8, 10, "A", 9, "", 0.9),
            ChordSegment(10, 12, "E", 4, "", 0.9),
        ]
        assert refine_key_with_chords("A", "major", chords) == ("F#", "minor")

    def test_le_dernier_accord_compte_aussi(self) -> None:
        # La tonique majeure est jouee deux fois plus longtemps, mais la piece se
        # resout sur le relatif mineur.
        chords = [
            ChordSegment(0, 2, "G", 7, "", 0.9),
            ChordSegment(2, 4, "D", 2, "", 0.9),
            ChordSegment(4, 6, "D", 2, "", 0.9),
            ChordSegment(6, 8, "Bm", 11, "m", 0.9),
        ]
        assert refine_key_with_chords("D", "major", chords) == ("B", "minor")

    def test_un_accord_unique_ne_compte_qu_une_fois(self) -> None:
        # Premier et dernier segment confondus : pas de double bonus.
        chords = [ChordSegment(0, 4, "Am", 9, "m", 0.9)]
        assert refine_key_with_chords("C", "major", chords) == ("A", "minor")
