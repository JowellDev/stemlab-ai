"""Modeles de sortie du pipeline.

Miroir Python de `packages/contracts/src/jobs.ts`. Les deux cotes doivent decrire la
meme chose : le pipeline serialise ici, le BFF valide la-bas avec le schema Zod. Les
noms sont en camelCase a la serialisation pour que le JSON traverse la frontiere sans
conversion.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

StemType = Literal["vocals", "drums", "bass", "guitar", "piano", "other"]
SeparationModel = Literal["htdemucs", "htdemucs_6s"]
KeyMode = Literal["major", "minor"]

Confidence = Annotated[float, Field(ge=0.0, le=1.0)]
Seconds = Annotated[float, Field(ge=0.0)]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)


class Waveform(CamelModel):
    points_per_second: Annotated[int, Field(ge=1, le=2000)]
    peaks: list[Annotated[float, Field(ge=0.0, le=1.0)]]


class TimeSignature(CamelModel):
    numerator: Annotated[int, Field(ge=1, le=32)]
    denominator: Literal[2, 4, 8, 16]


class Beat(CamelModel):
    time: Seconds
    position: Annotated[int, Field(ge=1, le=32)]


class Chord(CamelModel):
    start: Seconds
    end: Seconds
    label: Annotated[str, Field(min_length=1, max_length=16)]
    #: `None` pour un segment sans accord (libelle « N »).
    root: Annotated[int, Field(ge=0, le=11)] | None
    quality: Annotated[str, Field(max_length=16)]
    confidence: Confidence


class AnalysisResult(CamelModel):
    key: str
    mode: KeyMode
    key_confidence: Confidence
    bpm: Annotated[float, Field(ge=20.0, le=300.0)]
    first_beat_offset: Seconds
    time_signature: TimeSignature
    beats: list[Beat]
    chords: list[Chord]


class StemArtifact(CamelModel):
    type: StemType
    #: Cle S3 en production ; chemin relatif au dossier de sortie en mode CLI.
    key: str
    format: Literal["opus", "wav"]
    bytes: Annotated[int, Field(gt=0)]
    waveform: Waveform


class PipelineResult(CamelModel):
    duration_seconds: Seconds
    sample_rate: Annotated[int, Field(gt=0)]
    channels: Annotated[int, Field(ge=1, le=2)]
    model: SeparationModel
    stems: list[StemArtifact]
    analysis: AnalysisResult
    waveform: Waveform
    processing_seconds: Seconds
