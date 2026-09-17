import numpy as np
import pytest

from ml.pipeline.waveform import compute_peaks


def test_produit_le_nombre_de_points_attendu() -> None:
    samples = np.zeros(44_100 * 2, dtype=np.float32)
    peaks = compute_peaks(samples, 44_100, points_per_second=512)
    # 2 s a 512 points/s, a un point pres selon l'arrondi de la fenetre.
    assert 1020 <= len(peaks) <= 1030


def test_releve_le_maximum_et_non_la_moyenne() -> None:
    # Une attaque isolee ne doit pas etre lissee par sa fenetre.
    samples = np.zeros(1000, dtype=np.float32)
    samples[10] = 0.8
    peaks = compute_peaks(samples, 1000, points_per_second=2)
    assert peaks[0] == pytest.approx(0.8)
    assert peaks[1] == pytest.approx(0.0)


def test_prend_la_valeur_absolue() -> None:
    samples = np.array([-0.9, 0.1], dtype=np.float32)
    assert compute_peaks(samples, 2, points_per_second=1)[0] == pytest.approx(0.9)


def test_reduit_le_multicanal_par_maximum() -> None:
    stereo = np.zeros((2, 100), dtype=np.float32)
    stereo[1, 5] = 0.7
    assert compute_peaks(stereo, 100, points_per_second=1)[0] == pytest.approx(0.7)


def test_borne_les_valeurs_a_un() -> None:
    samples = np.array([3.0], dtype=np.float32)
    assert compute_peaks(samples, 1, points_per_second=1) == [1.0]


def test_signal_vide() -> None:
    assert compute_peaks(np.zeros(0, dtype=np.float32), 44_100) == []


@pytest.mark.parametrize(("rate", "pps"), [(0, 512), (44_100, 0), (44_100, -1)])
def test_rejette_des_parametres_invalides(rate: int, pps: int) -> None:
    with pytest.raises(ValueError):
        compute_peaks(np.zeros(10, dtype=np.float32), rate, pps)
