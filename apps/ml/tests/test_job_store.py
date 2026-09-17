from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from fakeredis.aioredis import FakeRedis

from ml.jobs import DLQ_MAX_LENGTH, JobRecord, JobStore, checksum_key, job_key

BASE = {
    "job_id": "job-1",
    "track_id": "track-1",
    "checksum": "a" * 64,
    "model": "htdemucs",
    "source_key": "tracks/1/original.mp3",
    "output_prefix": "tracks/1/stems",
    "callback_url": "http://bff.test/callback",
}


@pytest.fixture
async def store() -> AsyncIterator[JobStore]:
    redis = FakeRedis()
    yield JobStore(redis)
    await redis.aclose()


def record(**overrides: object) -> JobRecord:
    return JobRecord(**{**BASE, **overrides})  # type: ignore[arg-type]


class TestCles:
    def test_le_modele_fait_partie_de_la_cle_d_idempotence(self) -> None:
        # Le meme fichier separe en six stems n'est pas le meme resultat qu'en quatre.
        assert checksum_key("abc", "htdemucs") != checksum_key("abc", "htdemucs_6s")

    def test_les_cles_de_job_sont_prefixees(self) -> None:
        assert job_key("x").startswith("stemlab:")


class TestEnregistrement:
    async def test_relit_ce_qu_il_a_ecrit(self, store: JobStore) -> None:
        await store.save(record())
        restored = await store.get("job-1")
        assert restored is not None
        assert restored.track_id == "track-1"
        assert restored.status == "queued"
        assert restored.progress == 0

    async def test_rend_none_pour_un_job_inconnu(self, store: JobStore) -> None:
        assert await store.get("inconnu") is None

    async def test_met_a_jour_les_champs_demandes(self, store: JobStore) -> None:
        await store.save(record())
        updated = await store.update("job-1", status="running", progress=42)
        assert updated is not None
        assert updated.status == "running"
        assert updated.progress == 42
        # Les autres champs sont preserves.
        assert updated.source_key == "tracks/1/original.mp3"

    async def test_une_mise_a_jour_sur_un_job_absent_ne_cree_rien(self, store: JobStore) -> None:
        assert await store.update("inconnu", status="running") is None
        assert await store.get("inconnu") is None

    async def test_survit_a_un_aller_retour_json_complet(self, store: JobStore) -> None:
        original = record(status="failed", error="boum", attempt=3, finished_at=1234.5)
        await store.save(original)
        restored = await store.get("job-1")
        assert restored == original


class TestIdempotence:
    async def test_retrouve_un_resultat_memorise(self, store: JobStore) -> None:
        await store.remember_result("a" * 64, "htdemucs", {"durationSeconds": 12.0})
        assert await store.recall_result("a" * 64, "htdemucs") == {"durationSeconds": 12.0}

    async def test_ne_confond_pas_deux_modeles(self, store: JobStore) -> None:
        await store.remember_result("a" * 64, "htdemucs", {"stems": 4})
        assert await store.recall_result("a" * 64, "htdemucs_6s") is None

    async def test_ne_confond_pas_deux_fichiers(self, store: JobStore) -> None:
        await store.remember_result("a" * 64, "htdemucs", {"stems": 4})
        assert await store.recall_result("b" * 64, "htdemucs") is None

    async def test_peut_oublier_un_resultat(self, store: JobStore) -> None:
        await store.remember_result("a" * 64, "htdemucs", {"stems": 4})
        await store.forget_result("a" * 64, "htdemucs")
        assert await store.recall_result("a" * 64, "htdemucs") is None

    async def test_conserve_les_caracteres_non_ascii(self, store: JobStore) -> None:
        await store.remember_result("a" * 64, "htdemucs", {"titre": "Été à Paris"})
        assert (await store.recall_result("a" * 64, "htdemucs")) == {"titre": "Été à Paris"}


class TestFileDeRebut:
    async def test_est_vide_au_depart(self, store: JobStore) -> None:
        assert await store.dead_letter_count() == 0
        assert await store.dead_letters() == []

    async def test_conserve_le_job_et_la_raison(self, store: JobStore) -> None:
        await store.push_dead_letter(record(status="failed"), "ffmpeg a echoue")
        entries = await store.dead_letters()

        assert len(entries) == 1
        assert entries[0]["reason"] == "ffmpeg a echoue"
        assert entries[0]["job"]["job_id"] == "job-1"
        assert entries[0]["at"] > 0

    async def test_rend_les_plus_recents_d_abord(self, store: JobStore) -> None:
        await store.push_dead_letter(record(job_id="ancien"), "premier")
        await store.push_dead_letter(record(job_id="recent"), "second")
        entries = await store.dead_letters()
        assert [entry["job"]["job_id"] for entry in entries] == ["recent", "ancien"]

    async def test_borne_la_longueur_de_la_file(self, store: JobStore) -> None:
        for index in range(DLQ_MAX_LENGTH + 20):
            await store.push_dead_letter(record(job_id=f"job-{index}"), "echec")
        assert await store.dead_letter_count() == DLQ_MAX_LENGTH

    async def test_respecte_la_limite_de_lecture(self, store: JobStore) -> None:
        for index in range(10):
            await store.push_dead_letter(record(job_id=f"job-{index}"), "echec")
        assert len(await store.dead_letters(limit=3)) == 3
