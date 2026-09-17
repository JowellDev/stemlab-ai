import json

import pytest
from pydantic import ValidationError

from ml.pipeline.models import (
    AnalysisResult,
    Beat,
    Chord,
    PipelineResult,
    StemArtifact,
    TimeSignature,
    Waveform,
)


def make_analysis() -> AnalysisResult:
    return AnalysisResult(
        key="A",
        mode="minor",
        key_confidence=0.82,
        bpm=120.0,
        first_beat_offset=0.0,
        time_signature=TimeSignature(numerator=4, denominator=4),
        beats=[Beat(time=0.0, position=1), Beat(time=0.5, position=2)],
        chords=[Chord(start=0.0, end=2.0, label="Am", root=9, quality="m", confidence=0.9)],
    )


def make_result() -> PipelineResult:
    waveform = Waveform(points_per_second=512, peaks=[0.0, 0.5, 1.0])
    return PipelineResult(
        duration_seconds=12.0,
        sample_rate=44_100,
        channels=2,
        model="htdemucs",
        stems=[
            StemArtifact(
                type="vocals", key="vocals.opus", format="opus", bytes=1234, waveform=waveform
            )
        ],
        analysis=make_analysis(),
        waveform=waveform,
        processing_seconds=30.5,
    )


def test_serialise_en_camel_case() -> None:
    """Le BFF valide ce JSON avec le schema Zod : les noms doivent correspondre."""
    payload = json.loads(json.dumps(make_result().model_dump(by_alias=True)))

    assert set(payload) == {
        "durationSeconds",
        "sampleRate",
        "channels",
        "model",
        "stems",
        "analysis",
        "waveform",
        "processingSeconds",
    }
    assert payload["analysis"]["keyConfidence"] == 0.82
    assert payload["analysis"]["firstBeatOffset"] == 0.0
    assert payload["analysis"]["timeSignature"] == {"numerator": 4, "denominator": 4}
    assert payload["waveform"]["pointsPerSecond"] == 512
    assert payload["stems"][0]["waveform"]["pointsPerSecond"] == 512


def test_relit_sa_propre_sortie() -> None:
    payload = make_result().model_dump(by_alias=True)
    assert PipelineResult.model_validate(payload) == make_result()


def test_accepte_un_accord_sans_fondamentale() -> None:
    chord = Chord(start=0.0, end=1.0, label="N", root=None, quality="", confidence=0.4)
    assert chord.root is None


@pytest.mark.parametrize(
    "patch",
    [
        {"bpm": 10.0},  # sous la borne basse
        {"bpm": 400.0},  # au-dessus de la borne haute
        {"key_confidence": 1.5},
        {"mode": "lydian"},
    ],
)
def test_rejette_une_analyse_hors_bornes(patch: dict[str, object]) -> None:
    base = make_analysis().model_dump()
    base.update(patch)
    with pytest.raises(ValidationError):
        AnalysisResult.model_validate(base)


def test_rejette_un_peak_hors_bornes() -> None:
    with pytest.raises(ValidationError):
        Waveform(points_per_second=512, peaks=[1.5])


def test_rejette_un_stem_de_taille_nulle() -> None:
    with pytest.raises(ValidationError):
        StemArtifact(
            type="bass",
            key="bass.opus",
            format="opus",
            bytes=0,
            waveform=Waveform(points_per_second=512, peaks=[]),
        )


def test_rejette_un_type_de_stem_inconnu() -> None:
    with pytest.raises(ValidationError):
        StemArtifact(
            type="kazoo",
            key="kazoo.opus",
            format="opus",
            bytes=1,
            waveform=Waveform(points_per_second=512, peaks=[]),
        )
