"""Tests de la surface HTTP du service de jobs.

Redis est remplace par `fakeredis` et la file par une doublure qui enregistre les
depots : tout le code teste est le vrai code, seules les dependances externes sont
substituees.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest
from fakeredis import FakeServer
from fakeredis.aioredis import FakeRedis
from fastapi.testclient import TestClient

from ml.api import create_app
from ml.jobs import JobStore
from ml.security import sign_body
from ml.settings import Settings

SECRET = "secret-de-test-hmac"
CALLBACK = "http://bff.test/api/internal/jobs/callback"


@dataclass
class EnqueuedJob:
    name: str
    payload: dict[str, Any]
    job_id: str | None


@dataclass
class FakeQueue:
    """Doublure d'`ArqRedis` : elle n'enregistre que ce qui a ete depose."""

    jobs: list[EnqueuedJob] = field(default_factory=list)

    async def enqueue_job(
        self, name: str, payload: dict[str, Any], *, _job_id: str | None = None
    ) -> None:
        self.jobs.append(EnqueuedJob(name=name, payload=payload, job_id=_job_id))

    async def aclose(self) -> None:
        return None


def make_settings() -> Settings:
    return Settings(
        ML_WEBHOOK_SECRET=SECRET,
        REDIS_URL="redis://localhost:6379/0",
        S3_BUCKET="stemlab-test",
    )


@pytest.fixture
def fake_server() -> FakeServer:
    """Un seul magasin de donnees, partageable entre plusieurs clients.

    `TestClient` execute l'application dans sa propre boucle d'evenements : un
    client Redis asynchrone y est lie et ne peut pas etre reutilise depuis la
    boucle du test. Partager le serveur plutot que le client leve la contrainte.
    """
    return FakeServer()


@pytest.fixture
def redis(fake_server: FakeServer) -> Iterator[FakeRedis]:
    client = FakeRedis(server=fake_server)
    yield client


@pytest.fixture
def queue() -> FakeQueue:
    return FakeQueue()


@pytest.fixture
def client(redis: FakeRedis, queue: FakeQueue) -> Iterator[TestClient]:
    app = create_app(settings=make_settings(), redis=redis, queue=queue)  # type: ignore[arg-type]
    with TestClient(app) as test_client:
        yield test_client


def valid_body(**overrides: Any) -> str:
    payload = {
        "trackId": "11111111-1111-4111-8111-111111111111",
        "sourceKey": "tracks/abc/original.mp3",
        "checksum": "a" * 64,
        "model": "htdemucs",
        "outputPrefix": "tracks/abc/stems",
        "callbackUrl": CALLBACK,
    }
    payload.update(overrides)
    return json.dumps(payload)


def post_job(client: TestClient, body: str, *, secret: str = SECRET) -> Any:
    signed = sign_body(secret, body)
    return client.post(
        "/jobs",
        content=body.encode(),
        headers={"content-type": "application/json", **signed.headers},
    )


class TestSondes:
    def test_health_repond_sans_dependance(self, client: TestClient) -> None:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["service"] == "ml"

    def test_ready_verifie_redis(self, client: TestClient) -> None:
        response = client.get("/ready")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "redis": True}


class TestSignature:
    def test_refuse_une_requete_non_signee(self, client: TestClient) -> None:
        response = client.post("/jobs", content=valid_body().encode())
        assert response.status_code == 401
        assert response.json()["code"] == "unauthorized"

    def test_refuse_une_signature_d_un_autre_secret(self, client: TestClient) -> None:
        assert post_job(client, valid_body(), secret="mauvais-secret").status_code == 401

    def test_refuse_un_corps_altere_apres_signature(self, client: TestClient) -> None:
        body = valid_body()
        signed = sign_body(SECRET, body)
        altered = body.replace("htdemucs", "htdemucs_6s")
        response = client.post("/jobs", content=altered.encode(), headers=signed.headers)
        assert response.status_code == 401

    def test_ne_depose_rien_quand_la_signature_echoue(
        self, client: TestClient, queue: FakeQueue
    ) -> None:
        client.post("/jobs", content=valid_body().encode())
        assert queue.jobs == []


class TestValidation:
    @pytest.mark.parametrize(
        ("champ", "valeur"),
        [
            ("checksum", "trop-court"),
            ("sourceKey", "/chemin/absolu"),
            ("sourceKey", "tracks/../secret"),
            ("outputPrefix", "avec espace"),
            ("callbackUrl", "ftp://ailleurs"),
            ("model", "htdemucs_42"),
        ],
    )
    def test_rejette_un_champ_invalide(self, client: TestClient, champ: str, valeur: str) -> None:
        response = post_job(client, valid_body(**{champ: valeur}))
        assert response.status_code == 400
        assert response.json()["code"] == "bad_request"

    def test_rejette_un_corps_qui_n_est_pas_du_json(self, client: TestClient) -> None:
        assert post_job(client, "ceci n'est pas du json").status_code == 400

    def test_applique_htdemucs_par_defaut(self, client: TestClient, queue: FakeQueue) -> None:
        body = json.loads(valid_body())
        del body["model"]
        post_job(client, json.dumps(body))
        assert queue.jobs[0].payload["model"] == "htdemucs"


class TestDepot:
    def test_depose_le_job_et_repond_202(self, client: TestClient, queue: FakeQueue) -> None:
        response = post_job(client, valid_body())
        assert response.status_code == 202

        body = response.json()
        assert body["status"] == "queued"
        assert body["deduplicated"] is False
        assert body["jobId"]

        assert len(queue.jobs) == 1
        assert queue.jobs[0].name == "process_track"
        assert queue.jobs[0].job_id == body["jobId"]

    def test_enregistre_l_etat_initial(self, client: TestClient) -> None:
        job_id = post_job(client, valid_body()).json()["jobId"]
        state = client.get(f"/jobs/{job_id}").json()

        assert state["status"] == "queued"
        assert state["progress"] == 0
        assert state["type"] == "separate_and_analyze"
        assert state["error"] is None
        assert state["finishedAt"] is None

    def test_deux_depots_ont_des_identifiants_distincts(self, client: TestClient) -> None:
        first = post_job(client, valid_body()).json()["jobId"]
        second = post_job(client, valid_body(checksum="b" * 64)).json()["jobId"]
        assert first != second


class TestSuivi:
    def test_job_inconnu(self, client: TestClient) -> None:
        response = client.get("/jobs/11111111-1111-4111-8111-111111111111")
        assert response.status_code == 404
        assert response.json()["code"] == "not_found"

    async def test_reflete_la_progression_ecrite_par_le_worker(
        self, client: TestClient, fake_server: FakeServer
    ) -> None:
        job_id = post_job(client, valid_body()).json()["jobId"]

        # Client cree dans la boucle du test, sur le meme magasin : c'est ce que
        # ferait le worker, qui tourne dans un autre processus.
        store = JobStore(FakeRedis(server=fake_server))
        await store.update(job_id, status="running", progress=42, stage="separation", attempt=1)

        state = client.get(f"/jobs/{job_id}").json()
        assert state["status"] == "running"
        assert state["progress"] == 42
        assert state["stage"] == "separation"


class TestFileDeRebut:
    def test_est_vide_au_depart(self, client: TestClient) -> None:
        assert client.get("/dead-letters").json() == {"count": 0, "entries": []}

    def test_borne_la_limite_demandee(self, client: TestClient) -> None:
        assert client.get("/dead-letters?limit=99999").status_code == 200
        assert client.get("/dead-letters?limit=-5").status_code == 200
