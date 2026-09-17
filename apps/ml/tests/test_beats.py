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
