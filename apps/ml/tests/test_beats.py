from typing import ClassVar

import numpy as np

from ml.pipeline.beats import beat_loudness, build_grid


def test_grille_vide_sans_temps() -> None:
    grid = build_grid([])
    assert grid.beats == []
    assert grid.first_beat_offset == 0.0


def test_numerote_les_temps_en_quatre_temps() -> None:
    grid = build_grid([0.0, 0.5, 1.0, 1.5, 2.0])
    assert [position for _, position in grid.beats] == [1, 2, 3, 4, 1]
    assert grid.numerator == 4
    assert grid.first_beat_offset == 0.0


def test_trie_les_temps_desordonnes() -> None:
    grid = build_grid([1.0, 0.0, 0.5])
    assert [time for time, _ in grid.beats] == [0.0, 0.5, 1.0]


def test_choisit_la_phase_qui_maximise_l_energie_des_temps_forts() -> None:
    # Deux mesures completes : l'heuristique a de quoi decider.
    beats = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]
    # L'energie est concentree sur les index 1 et 5 : le « un » doit s'y placer.
    loudness = np.array([0.1, 1.0, 0.1, 0.1, 0.1, 1.0, 0.1, 0.1], dtype=np.float32)
    grid = build_grid(beats, loudness)
    assert grid.beats[1][1] == 1
    assert grid.first_beat_offset == 0.5


def test_ignore_une_energie_ambigue() -> None:
    """Sur un signal regulier, argmax designerait une phase au hasard."""
    beats = [index * 0.5 for index in range(8)]
    loudness = np.array([0.50, 0.51, 0.50, 0.49, 0.50, 0.51, 0.50, 0.49], dtype=np.float32)
    assert build_grid(beats, loudness).beats[0][1] == 1


def test_ignore_l_energie_sur_moins_de_deux_mesures() -> None:
    beats = [0.0, 0.5, 1.0, 1.5]
    loudness = np.array([0.1, 9.0, 0.1, 0.1], dtype=np.float32)
    # Une seule mesure : pas de quoi trancher, on garde la convention.
    assert build_grid(beats, loudness).beats[0][1] == 1


def test_sans_energie_le_premier_temps_est_fort() -> None:
    grid = build_grid([0.25, 0.75, 1.25])
    assert grid.beats[0][1] == 1
    assert grid.first_beat_offset == 0.25


def test_signature_personnalisee() -> None:
    grid = build_grid([0.0, 0.4, 0.8, 1.2], numerator=3, denominator=4)
    assert [position for _, position in grid.beats] == [1, 2, 3, 1]


def test_energie_par_temps() -> None:
    mono = np.zeros(44_100, dtype=np.float32)
    mono[22_000:22_100] = 1.0
    values = beat_loudness(mono, 44_100, [0.0, 0.5])
    assert values[1] > values[0]


class TestPhaseParLesAccords:
    """Les changements d'accord designent les temps forts bien plus surement que
    l'energie, qu'une batterie reguliere repartit uniformement."""

    BEATS: ClassVar[list[float]] = [index * 0.5 for index in range(16)]

    def test_place_le_temps_fort_sur_les_changements_d_accord(self) -> None:
        # Les accords changent aux index 1, 5, 9, 13 : le « un » doit s'y placer.
        chord_starts = [0.5, 2.5, 4.5, 6.5]
        grid = build_grid(self.BEATS, chord_starts=chord_starts)
        assert grid.beats[1][1] == 1
        assert grid.first_beat_offset == 0.5

    def test_prime_sur_l_energie(self) -> None:
        # L'energie designe l'index 0, les accords l'index 2 : les accords gagnent.
        loudness = np.zeros(16, dtype=np.float32)
        loudness[0::4] = 9.0
        grid = build_grid(self.BEATS, loudness, chord_starts=[1.0, 3.0, 5.0, 7.0])
        assert grid.beats[2][1] == 1

    def test_ignore_des_changements_trop_rares(self) -> None:
        # Un seul changement ne donne aucune marge : on retombe sur l'energie.
        grid = build_grid(self.BEATS, chord_starts=[1.0])
        assert grid.beats[0][1] == 1

    def test_ignore_des_changements_hors_grille(self) -> None:
        # Des changements qui ne tombent sur aucun temps n'apprennent rien.
        grid = build_grid(self.BEATS, chord_starts=[0.23, 1.17, 2.31, 3.09])
        assert grid.beats[0][1] == 1

    def test_ignore_une_egalite(self) -> None:
        grid = build_grid(self.BEATS, chord_starts=[0.0, 0.5, 2.0, 2.5])
        assert grid.beats[0][1] == 1

    def test_sans_accord_le_comportement_est_inchange(self) -> None:
        grid = build_grid(self.BEATS, chord_starts=[])
        assert grid.beats[0][1] == 1
