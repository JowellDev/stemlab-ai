"""Tests du worker.

Le pipeline, S3 et le webhook sont remplaces par des doublures : ce qui est verifie
ici, c'est la machine a etats — quand reessayer, quand abandonner, ce qui part dans
la file de rebut, et ce que recoit le BFF.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from arq import Retry
from fakeredis.aioredis import FakeRedis

from ml.jobs import JobStore
from ml.pipeline.models import (
    AnalysisResult,
    PipelineResult,
    StemArtifact,
    TimeSignature,
    Waveform,
)
from ml.settings import Settings
from ml.storage import ObjectNotFoundError, UploadedObject
from ml.worker import MAX_TRIES, NonRetryableError, process_track

PAYLOAD = {
    "trackId": "11111111-1111-4111-8111-111111111111",
    "sourceKey": "tracks/1/original.mp3",
    "checksum": "a" * 64,
    "model": "htdemucs",
    "outputPrefix": "tracks/1/stems",
    "callbackUrl": "http://bff.test/callback",
}

STEM_NAMES = ("drums", "bass", "other", "vocals")


def make_result() -> PipelineResult:
    waveform = Waveform(points_per_second=512, peaks=[0.1, 0.9])
    return PipelineResult(
        duration_seconds=12.0,
        sample_rate=44_100,
        channels=2,
        model="htdemucs",
        stems=[
            StemArtifact(
                type=name,
                key=f"{name}.opus",
                format="opus",
                bytes=1000,
                waveform=waveform,
            )
            for name in STEM_NAMES
        ],
        analysis=AnalysisResult(
            key="A",
            mode="minor",
            key_confidence=0.8,
            bpm=120.0,
            first_beat_offset=0.0,
            time_signature=TimeSignature(numerator=4, denominator=4),
            beats=[],
            chords=[],
        ),
        waveform=waveform,
        processing_seconds=5.0,
    )


class FakeStore:
    """Magasin d'objets factice : enregistre ce qui a ete envoye."""

    def __init__(self, missing: bool = False) -> None:
        self.missing = missing
        self.uploaded: list[str] = []
        self.downloaded: list[str] = []

    def download(self, key: str, destination: Path) -> Path:
        if self.missing:
            raise ObjectNotFoundError(f"objet introuvable : {key}")
        self.downloaded.append(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"audio")
        return destination

    def upload(self, source: Path, key: str) -> UploadedObject:
        self.uploaded.append(key)
        return UploadedObject(key=key, bytes=1000, content_type="audio/ogg")


@pytest.fixture
async def context() -> AsyncIterator[dict[str, Any]]:
    redis = FakeRedis()
    yield {
        "settings": Settings(ML_WEBHOOK_SECRET="secret-test"),
        "store": JobStore(redis),
        "object_store": FakeStore(),
        "job_id": "job-1",
        "job_try": 1,
    }
    await redis.aclose()


@pytest.fixture
def delivered(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Capture les corps de webhook au lieu de les envoyer."""
    bodies: list[str] = []

    async def fake_deliver(url: str, secret: str, body: str, client: Any = None) -> Any:
        bodies.append(body)
        return None

    monkeypatch.setattr("ml.worker.deliver", fake_deliver)
    return bodies


@pytest.fixture
def pipeline_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run(source: Path, out: Path, options: Any, report: Any) -> PipelineResult:
        out.mkdir(parents=True, exist_ok=True)
        for name in STEM_NAMES:
            (out / f"{name}.opus").write_bytes(b"opus")
        report(50, "separation")
        report(100, "termine")
        return make_result()

    monkeypatch.setattr("ml.worker.run_pipeline", fake_run)


@pytest.mark.usefixtures("pipeline_succeeds")
class TestSucces:
    async def test_marque_le_job_termine(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        summary = await process_track(context, PAYLOAD)
        assert summary["stems"] == 4

        record = await context["store"].get("job-1")
        assert record is not None
        assert record.status == "succeeded"
        assert record.progress == 100
        assert record.finished_at is not None

    async def test_envoie_un_webhook_de_succes(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        await process_track(context, PAYLOAD)
        assert any('"job.succeeded"' in body for body in delivered)

    async def test_envoie_les_stems_sous_le_prefixe_demande(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        await process_track(context, PAYLOAD)
        assert sorted(context["object_store"].uploaded) == sorted(
            f"tracks/1/stems/{name}.opus" for name in STEM_NAMES
        )

    async def test_reecrit_les_cles_des_stems_dans_le_resultat(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        await process_track(context, PAYLOAD)
        success = next(body for body in delivered if '"job.succeeded"' in body)
        # Les chemins locaux du pipeline sont remplaces par les cles S3.
        assert "tracks/1/stems/drums.opus" in success
        assert '"key":"drums.opus"' not in success

    async def test_memorise_le_resultat_pour_l_idempotence(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        await process_track(context, PAYLOAD)
        cached = await context["store"].recall_result("a" * 64, "htdemucs")
        assert cached is not None
        assert cached["stems"][0]["key"].startswith("tracks/1/stems/")

    async def test_ne_memorise_rien_pour_un_autre_modele(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        await process_track(context, PAYLOAD)
        assert await context["store"].recall_result("a" * 64, "htdemucs_6s") is None


class TestEchecDefinitif:
    async def test_un_original_absent_n_est_pas_rejoue(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        context["object_store"] = FakeStore(missing=True)

        with pytest.raises(NonRetryableError) as raised:
            await process_track(context, PAYLOAD)
        assert raised.value.code == "not_found"

        record = await context["store"].get("job-1")
        assert record is not None
        assert record.status == "failed"

    async def test_envoie_un_webhook_d_echec_non_rejouable(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        context["object_store"] = FakeStore(missing=True)
        with pytest.raises(NonRetryableError):
            await process_track(context, PAYLOAD)

        failure = next(body for body in delivered if '"job.failed"' in body)
        assert '"retryable":false' in failure
        assert '"code":"not_found"' in failure

    async def test_alimente_la_file_de_rebut(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        context["object_store"] = FakeStore(missing=True)
        with pytest.raises(NonRetryableError):
            await process_track(context, PAYLOAD)

        entries = await context["store"].dead_letters()
        assert len(entries) == 1
        assert "introuvable" in entries[0]["reason"]

    async def test_ne_memorise_pas_un_echec(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        context["object_store"] = FakeStore(missing=True)
        with pytest.raises(NonRetryableError):
            await process_track(context, PAYLOAD)
        assert await context["store"].recall_result("a" * 64, "htdemucs") is None


class TestReessais:
    @pytest.fixture
    def pipeline_explodes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def fake_run(source: Path, out: Path, options: Any, report: Any) -> PipelineResult:
            raise RuntimeError("le GPU a disparu")

        monkeypatch.setattr("ml.worker.run_pipeline", fake_run)

    @pytest.mark.usefixtures("pipeline_explodes")
    async def test_demande_un_reessai_tant_qu_il_reste_des_essais(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        with pytest.raises(Retry) as raised:
            await process_track(context, PAYLOAD)
        # Recul exponentiel : premier essai, cinq secondes.
        assert raised.value.defer_score == 5000

        record = await context["store"].get("job-1")
        assert record is not None
        assert record.status == "queued"
        assert "le GPU a disparu" in (record.error or "")

    @pytest.mark.usefixtures("pipeline_explodes")
    async def test_le_recul_croit_avec_les_essais(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        context["job_try"] = 2
        with pytest.raises(Retry) as raised:
            await process_track(context, PAYLOAD)
        assert raised.value.defer_score == 20_000

    @pytest.mark.usefixtures("pipeline_explodes")
    async def test_abandonne_au_dernier_essai(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        context["job_try"] = MAX_TRIES
        with pytest.raises(RuntimeError, match="GPU"):
            await process_track(context, PAYLOAD)

        record = await context["store"].get("job-1")
        assert record is not None
        assert record.status == "failed"
        assert len(await context["store"].dead_letters()) == 1
        assert any('"job.failed"' in body for body in delivered)

    @pytest.mark.usefixtures("pipeline_explodes")
    async def test_n_envoie_pas_de_webhook_d_echec_avant_le_dernier_essai(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        with pytest.raises(Retry):
            await process_track(context, PAYLOAD)
        assert not any('"job.failed"' in body for body in delivered)


@pytest.mark.usefixtures("pipeline_succeeds")
class TestProgression:
    async def test_conserve_l_essai_en_cours(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        context["job_try"] = 2
        await process_track(context, PAYLOAD)
        record = await context["store"].get("job-1")
        assert record is not None
        assert record.attempt == 2

    async def test_repart_d_un_enregistrement_existant(
        self, context: dict[str, Any], delivered: list[str]
    ) -> None:
        """Apres un redemarrage, le job retrouve son enregistrement plutot que
        d'en creer un second."""
        await process_track(context, PAYLOAD)
        before = await context["store"].get("job-1")
        assert before is not None
        first_started = before.started_at

        context["job_try"] = 2
        await process_track(context, PAYLOAD)
        record = await context["store"].get("job-1")
        assert record is not None
        assert record.started_at == first_started
