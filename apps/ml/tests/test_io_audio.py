from collections.abc import Callable
from pathlib import Path

import numpy as np
import pytest

from ml.pipeline.io_audio import (
    TARGET_SAMPLE_RATE,
    FFmpegError,
    UnsupportedAudioError,
    encode_opus,
    normalize_input,
    probe_duration,
    read_audio,
    write_wav,
)
from tests.conftest import ffmpeg_required


@ffmpeg_required
class TestNormalisation:
    def test_ramene_a_44100_hz_stereo(self, make_tone: Callable[..., Path], tmp_path: Path) -> None:
        source = make_tone(seconds=0.5, sample_rate=48_000, channels=1)
        audio = read_audio(normalize_input(source, tmp_path / "out.wav"))

        assert audio.sample_rate == TARGET_SAMPLE_RATE
        assert audio.channels == 2
        assert audio.duration == pytest.approx(0.5, abs=0.02)

    def test_peut_forcer_le_mono(self, make_tone: Callable[..., Path], tmp_path: Path) -> None:
        source = make_tone(seconds=0.3, channels=2)
        audio = read_audio(normalize_input(source, tmp_path / "mono.wav", mono=True))
        assert audio.channels == 1

    def test_accepte_un_mp3(self, make_tone: Callable[..., Path], tmp_path: Path) -> None:
        source = make_tone(name="tone.mp3", seconds=0.4)
        audio = read_audio(normalize_input(source, tmp_path / "from-mp3.wav"))
        assert audio.duration > 0.3

    def test_signale_une_entree_illisible(self, tmp_path: Path) -> None:
        broken = tmp_path / "pas-de-l-audio.wav"
        broken.write_bytes(b"ceci n'est pas un fichier audio")
        with pytest.raises(FFmpegError):
            normalize_input(broken, tmp_path / "out.wav")


@ffmpeg_required
class TestLecture:
    def test_rend_les_canaux_en_premier_axe(
        self, make_tone: Callable[..., Path], tmp_path: Path
    ) -> None:
        source = make_tone(seconds=0.25, channels=2)
        audio = read_audio(normalize_input(source, tmp_path / "out.wav"))
        # (canaux, echantillons) et non l'inverse.
        assert audio.samples.shape[0] == 2
        assert audio.samples.shape[1] > audio.samples.shape[0]

    def test_reduction_mono_par_moyenne(self, tmp_path: Path) -> None:
        stereo = np.zeros((2, 100), dtype=np.float32)
        stereo[0, :] = 1.0
        stereo[1, :] = -1.0
        path = write_wav(tmp_path / "opposed.wav", stereo, 44_100)
        # Deux canaux en opposition de phase s'annulent.
        assert np.allclose(read_audio(path).to_mono(), 0.0, atol=1e-4)

    def test_refuse_un_fichier_vide(self, tmp_path: Path) -> None:
        empty = tmp_path / "vide.wav"
        empty.write_bytes(b"")
        with pytest.raises(UnsupportedAudioError):
            read_audio(empty)


@ffmpeg_required
class TestEncodage:
    def test_produit_un_opus_plus_leger_que_le_wav(
        self, make_tone: Callable[..., Path], tmp_path: Path
    ) -> None:
        source = make_tone(seconds=2.0)
        wav = normalize_input(source, tmp_path / "source.wav")
        opus = encode_opus(wav, tmp_path / "out.opus", bitrate="96k")

        assert opus.exists()
        assert opus.stat().st_size > 0
        assert opus.stat().st_size < wav.stat().st_size

    def test_l_opus_se_relit(self, make_tone: Callable[..., Path], tmp_path: Path) -> None:
        source = make_tone(seconds=1.0)
        wav = normalize_input(source, tmp_path / "source.wav")
        opus = encode_opus(wav, tmp_path / "out.opus")
        assert read_audio(opus).duration == pytest.approx(1.0, abs=0.05)


@ffmpeg_required
class TestDuree:
    def test_mesure_la_duree(self, make_tone: Callable[..., Path]) -> None:
        assert probe_duration(make_tone(seconds=1.5)) == pytest.approx(1.5, abs=0.05)

    def test_signale_un_fichier_invalide(self, tmp_path: Path) -> None:
        broken = tmp_path / "casse.wav"
        broken.write_bytes(b"non")
        with pytest.raises(UnsupportedAudioError):
            probe_duration(broken)
