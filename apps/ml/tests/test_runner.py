"""Tests d'orchestration.

La separation et l'analyse sont remplacees par des doublures : ce qui est verifie
ici, c'est l'enchainement — normalisation, encodage, formes d'onde, forme du
resultat — et non la qualite des modeles, qui ne se teste pas par assertion.
"""

from __future__ import annotations

from collections.abc import Callable
from itertools import pairwise
from pathlib import Path

import numpy as np
import numpy.typing as npt
import pytest

from ml.pipeline import analysis as analysis_module
from ml.pipeline import separation as separation_module
from ml.pipeline.analysis import KeyEstimate, RhythmEstimate
from ml.pipeline.models import PipelineResult
from ml.pipeline.runner import PipelineOptions, mix_harmonic_stems, run_pipeline
from ml.pipeline.separation import SeparationResult
from tests.conftest import ffmpeg_required

STEM_NAMES = ("drums", "bass", "other", "vocals")


@pytest.fixture
def fake_backends(monkeypatch: pytest.MonkeyPatch) -> None:
    """Remplace Demucs et Essentia par des sorties deterministes."""

    def fake_separate(
        samples: npt.NDArray[np.float32],
        sample_rate: int,
        model_name: str = "htdemucs",
        device: str = "cpu",
        *,
        model: object | None = None,
        on_progress: Callable[[float], None] | None = None,
    ) -> SeparationResult:
        on_progress and on_progress(1.0)
        # Chaque stem recoit le quart du signal : la somme reconstitue l'entree.
        return SeparationResult(
            stems={name: (samples / 4).astype(np.float32) for name in STEM_NAMES},
            sample_rate=sample_rate,
            model="htdemucs",
        )

    def fake_key(_mono: npt.NDArray[np.float32]) -> KeyEstimate:
        return KeyEstimate(key="A", mode="minor", confidence=0.77)

    def fake_rhythm(_mono: npt.NDArray[np.float32]) -> RhythmEstimate:
        return RhythmEstimate(bpm=120.0, beats=[0.0, 0.5, 1.0, 1.5], confidence=0.8)

    def fake_chroma(
        mono: npt.NDArray[np.float32], sample_rate: int
    ) -> tuple[npt.NDArray[np.float32], npt.NDArray[np.float64]]:
        frames = 40
        chroma = np.zeros((frames, 12), dtype=np.float32)
        # La mineur sur toute la duree : la, do, mi.
        chroma[:, [9, 0, 4]] = 1.0
        times = np.linspace(0.0, mono.size / sample_rate, frames, dtype=np.float64)
        return chroma, times

    # Le runner importe le module, pas la fonction : patcher le module suffit.
    monkeypatch.setattr(separation_module, "separate", fake_separate)
    monkeypatch.setattr(analysis_module, "estimate_key", fake_key)
    monkeypatch.setattr(analysis_module, "estimate_rhythm", fake_rhythm)
    monkeypatch.setattr(analysis_module, "compute_chroma", fake_chroma)


@ffmpeg_required
@pytest.mark.usefixtures("fake_backends")
class TestRunPipeline:
    def test_produit_un_resultat_valide(
        self, make_tone: Callable[..., Path], tmp_path: Path
    ) -> None:
        result = run_pipeline(make_tone(seconds=2.0), tmp_path / "out")

        assert isinstance(result, PipelineResult)
        assert result.sample_rate == 44_100
        assert result.channels == 2
        assert result.duration_seconds == pytest.approx(2.0, abs=0.05)
        assert {stem.type for stem in result.stems} == set(STEM_NAMES)

    def test_ecrit_un_opus_non_vide_par_stem(
        self, make_tone: Callable[..., Path], tmp_path: Path
    ) -> None:
        out = tmp_path / "out"
        result = run_pipeline(make_tone(seconds=1.5), out)

        for stem in result.stems:
            path = out / stem.key
            assert path.exists()
            assert path.stat().st_size == stem.bytes > 0
            assert stem.format == "opus"

    def test_supprime_les_fichiers_intermediaires(
        self, make_tone: Callable[..., Path], tmp_path: Path
    ) -> None:
        out = tmp_path / "out"
        run_pipeline(make_tone(seconds=1.0), out)

        assert not (out / "_normalized.wav").exists()
        assert list(out.glob("*.wav")) == []

    def test_conserve_les_wav_sur_demande(
        self, make_tone: Callable[..., Path], tmp_path: Path
    ) -> None:
        out = tmp_path / "out"
        run_pipeline(make_tone(seconds=1.0), out, PipelineOptions(keep_wav=True))
        assert len(list(out.glob("*.wav"))) == len(STEM_NAMES)

    def test_les_formes_d_onde_couvrent_le_morceau(
        self, make_tone: Callable[..., Path], tmp_path: Path
    ) -> None:
        result = run_pipeline(make_tone(seconds=2.0), tmp_path / "out")

        attendu = 2.0 * result.waveform.points_per_second
        assert result.waveform.points_per_second == 512
        assert abs(len(result.waveform.peaks) - attendu) < 10
        for stem in result.stems:
            assert abs(len(stem.waveform.peaks) - attendu) < 10

    def test_remonte_une_progression_monotone(
        self, make_tone: Callable[..., Path], tmp_path: Path
    ) -> None:
        seen: list[tuple[int, str]] = []
        run_pipeline(
            make_tone(seconds=1.0), tmp_path / "out", None, lambda p, s: seen.append((p, s))
        )

        percentages = [percent for percent, _ in seen]
        assert percentages == sorted(percentages)
        assert percentages[-1] == 100
        assert seen[-1][1] == "termine"

    def test_reporte_l_analyse_dans_le_resultat(
        self, make_tone: Callable[..., Path], tmp_path: Path
    ) -> None:
        analysis = run_pipeline(make_tone(seconds=2.0), tmp_path / "out").analysis

        assert analysis.key == "A"
        assert analysis.mode == "minor"
        assert analysis.bpm == 120.0
        assert [beat.position for beat in analysis.beats] == [1, 2, 3, 4]
        assert analysis.chords
        assert analysis.chords[0].label == "Am"

    def test_les_accords_couvrent_le_morceau_sans_trou(
        self, make_tone: Callable[..., Path], tmp_path: Path
    ) -> None:
        chords = run_pipeline(make_tone(seconds=2.0), tmp_path / "out").analysis.chords
        for previous, following in pairwise(chords):
            assert previous.end == pytest.approx(following.start, abs=1e-6)


class TestMixHarmonique:
    def test_ne_retient_que_la_basse_et_les_autres(self) -> None:
        stems = {
            "bass": np.full(100, 0.5, dtype=np.float32),
            "other": np.full(100, 0.5, dtype=np.float32),
            # La voix et la batterie doivent etre ignorees : la premiere a du
            # vibrato, la seconde n'a pas de hauteur.
            "vocals": np.full(100, 9.0, dtype=np.float32),
            "drums": np.full(100, 9.0, dtype=np.float32),
        }
        mixed = mix_harmonic_stems(stems)
        assert mixed.shape == (100,)
        assert np.max(np.abs(mixed)) == pytest.approx(1.0)

    def test_reduit_le_stereo_en_mono(self) -> None:
        stems = {
            "bass": np.ones((2, 50), dtype=np.float32),
            "other": np.zeros((2, 50), dtype=np.float32),
        }
        assert mix_harmonic_stems(stems).shape == (50,)

    def test_s_aligne_sur_le_stem_le_plus_court(self) -> None:
        stems = {
            "bass": np.ones(80, dtype=np.float32),
            "other": np.ones(50, dtype=np.float32),
        }
        assert mix_harmonic_stems(stems).shape == (50,)

    def test_echoue_sans_stem_harmonique(self) -> None:
        with pytest.raises(ValueError, match="harmonique"):
            mix_harmonic_stems({"drums": np.ones(10, dtype=np.float32)})
