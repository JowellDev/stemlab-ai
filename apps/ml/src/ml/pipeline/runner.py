"""Orchestration du pipeline : fichier d'entree -> stems + analyse.

Aucune entree/sortie reseau ici non plus : le runner lit et ecrit sur disque. Le
transfert S3 et la file de jobs sont ajoutes par-dessus en phase 3.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import cast

import numpy as np
import numpy.typing as npt

from ml.pipeline import analysis as analysis_module
from ml.pipeline import separation as separation_module
from ml.pipeline.beats import beat_loudness, build_grid
from ml.pipeline.chords import estimate_chords, refine_key_with_chords
from ml.pipeline.io_audio import (
    DecodedAudio,
    encode_opus,
    normalize_input,
    read_audio,
    write_wav,
)
from ml.pipeline.lyrics import TranscriptionSettings, transcribe, translate
from ml.pipeline.models import (
    AnalysisResult,
    Beat,
    Chord,
    Lyrics,
    PipelineResult,
    StemArtifact,
    StemType,
    TimeSignature,
    Waveform,
)
from ml.pipeline.waveform import DEFAULT_POINTS_PER_SECOND, compute_peaks

logger = logging.getLogger(__name__)

#: Le mixage basse + autres porte l'harmonie : la voix y ajoute du vibrato et du
#: portamento qui brouillent le chromagramme, la batterie n'a pas de hauteur.
HARMONIC_STEMS = ("bass", "other")

ProgressCallback = Callable[[int, str], None]


@dataclass(frozen=True, slots=True)
class PipelineOptions:
    model: separation_module.ModelName = "htdemucs"
    device: str = "cpu"
    opus_bitrate: str = "96k"
    points_per_second: int = DEFAULT_POINTS_PER_SECOND
    #: Conserve aussi les stems en WAV. Utile en debogage, lourd en production.
    keep_wav: bool = False
    #: Transcription des paroles. Desactivable : elle double le temps de traitement.
    transcribe_lyrics: bool = True
    whisper_model: str = "small"
    #: Langues vers lesquelles traduire, en plus de la langue d'origine.
    translate_to: tuple[str, ...] = ("fr", "en")


def run_pipeline(
    source: Path,
    output_dir: Path,
    options: PipelineOptions | None = None,
    on_progress: ProgressCallback | None = None,
) -> PipelineResult:
    opts = options or PipelineOptions()
    started = time.monotonic()
    output_dir.mkdir(parents=True, exist_ok=True)
    report = on_progress or (lambda _percent, _stage: None)

    report(2, "normalisation")
    normalized_path = normalize_input(source, output_dir / "_normalized.wav")
    audio = read_audio(normalized_path)

    report(8, "separation")
    separated = separation_module.separate(
        audio.samples,
        audio.sample_rate,
        model_name=opts.model,
        device=opts.device,
        on_progress=lambda ratio: report(8 + int(ratio * 52), "separation"),
    )

    report(62, "analyse")
    result_analysis = analyze(separated.stems, audio, opts)

    report(72, "paroles")
    lyrics = transcribe_vocals(separated.stems, audio.sample_rate, opts)

    report(84, "encodage")
    artifacts = encode_stems(separated.stems, audio.sample_rate, output_dir, opts)

    report(95, "formes d'onde")
    mix_waveform = Waveform(
        points_per_second=opts.points_per_second,
        peaks=compute_peaks(audio.samples, audio.sample_rate, opts.points_per_second),
    )

    normalized_path.unlink(missing_ok=True)
    report(100, "termine")

    return PipelineResult(
        duration_seconds=round(audio.duration, 3),
        sample_rate=audio.sample_rate,
        channels=audio.channels,
        model=opts.model,
        stems=artifacts,
        analysis=result_analysis,
        waveform=mix_waveform,
        lyrics=lyrics,
        processing_seconds=round(time.monotonic() - started, 2),
    )


def analyze(
    stems: dict[str, npt.NDArray[np.float32]],
    audio: DecodedAudio,
    opts: PipelineOptions,
) -> AnalysisResult:
    """Tonalite et tempo sur le mix, accords sur le seul contenu harmonique."""
    mono = audio.to_mono()

    key = analysis_module.estimate_key(mono)
    rhythm = analysis_module.estimate_rhythm(mono)

    harmonic = mix_harmonic_stems(stems)
    chroma, frame_times = analysis_module.compute_chroma(harmonic, audio.sample_rate)
    chords = estimate_chords(chroma, frame_times, rhythm.beats)

    # La grille de mesures est construite apres les accords : leurs changements
    # designent les temps forts bien plus surement que l'energie, qu'une batterie
    # reguliere repartit uniformement.
    loudness = beat_loudness(mono, audio.sample_rate, rhythm.beats)
    grid = build_grid(
        rhythm.beats,
        loudness,
        chord_starts=[segment.start for segment in chords[1:]],
    )

    # Les accords tranchent entre une tonalite et son relatif, que le profil de
    # hauteurs seul ne peut pas distinguer.
    refined_key, refined_mode = refine_key_with_chords(key.key, key.mode, chords)

    return AnalysisResult(
        key=refined_key,
        mode=refined_mode,
        key_confidence=key.confidence,
        bpm=rhythm.bpm,
        first_beat_offset=grid.first_beat_offset,
        time_signature=TimeSignature(numerator=grid.numerator, denominator=grid.denominator),
        beats=[Beat(time=time, position=position) for time, position in grid.beats],
        chords=[
            Chord(
                start=round(segment.start, 4),
                end=round(segment.end, 4),
                label=segment.label,
                root=segment.root,
                quality=segment.quality,
                confidence=segment.confidence,
            )
            for segment in chords
        ],
    )


def mix_harmonic_stems(stems: dict[str, npt.NDArray[np.float32]]) -> npt.NDArray[np.float32]:
    """Remixe basse + autres en mono, pour la detection d'accords."""
    parts = [stems[name] for name in HARMONIC_STEMS if name in stems]
    if not parts:
        raise ValueError("aucun stem harmonique disponible pour la detection d'accords")

    length = min(part.shape[-1] for part in parts)
    total = np.zeros(length, dtype=np.float32)
    for part in parts:
        trimmed = part[..., :length]
        total += trimmed if trimmed.ndim == 1 else np.mean(trimmed, axis=0, dtype=np.float32)

    peak = float(np.max(np.abs(total))) or 1.0
    return (total / peak).astype(np.float32)


def transcribe_vocals(
    stems: dict[str, npt.NDArray[np.float32]],
    sample_rate: int,
    opts: PipelineOptions,
) -> Lyrics | None:
    """Transcrit la voix isolee, puis la traduit.

    Le fichier confie a Whisper est un WAV temporaire, pas l'Opus final : la
    transcription tourne avant l'encodage, et un passage par un format avec perte
    n'apporterait rien a un modele qui reechantillonne de toute facon en 16 kHz.
    """
    if not opts.transcribe_lyrics:
        return None

    vocals = stems.get("vocals")
    if vocals is None:
        return None

    with TemporaryDirectory(prefix="stemlab-lyrics-") as tmp:
        path = write_wav(Path(tmp) / "vocals.wav", vocals, sample_rate)
        try:
            lyrics = transcribe(path, TranscriptionSettings(model=opts.whisper_model))
        except Exception:
            # Une transcription qui echoue ne doit pas emporter la separation :
            # les pistes, elles, sont deja la et c'est l'essentiel du service.
            logger.exception("transcription des paroles impossible")
            return None

    if lyrics is None:
        return None

    for target in opts.translate_to:
        try:
            lyrics = translate(lyrics, target)
        except Exception:
            logger.exception("traduction impossible", extra={"target": target})

    return lyrics


def encode_stems(
    stems: dict[str, npt.NDArray[np.float32]],
    sample_rate: int,
    output_dir: Path,
    opts: PipelineOptions,
) -> list[StemArtifact]:
    artifacts: list[StemArtifact] = []

    for name, samples in stems.items():
        wav_path = write_wav(output_dir / f"{name}.wav", samples, sample_rate)
        opus_path = encode_opus(wav_path, output_dir / f"{name}.opus", opts.opus_bitrate)
        if not opts.keep_wav:
            wav_path.unlink(missing_ok=True)

        artifacts.append(
            StemArtifact(
                # Les noms de sources de Demucs sont exactement les StemType.
                type=cast(StemType, name),
                key=opus_path.name,
                format="opus",
                bytes=opus_path.stat().st_size,
                waveform=Waveform(
                    points_per_second=opts.points_per_second,
                    peaks=compute_peaks(samples, sample_rate, opts.points_per_second),
                ),
            )
        )

    return artifacts
