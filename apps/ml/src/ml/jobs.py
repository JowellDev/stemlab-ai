"""Etat des jobs, dans Redis.

Trois responsabilites, volontairement regroupees parce qu'elles partagent la meme
convention de cles :

- **progression** : un hash par job, lisible par `GET /jobs/{id}` ;
- **idempotence** : un index par checksum, pour ne pas retraiter un fichier connu ;
- **file de rebut** : les jobs epuises apres tous leurs essais, conserves pour
  inspection plutot que perdus.
"""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable
from dataclasses import asdict, dataclass, field
from typing import Any, Literal, TypeVar, cast

from redis.asyncio import Redis

JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]

KEY_PREFIX = "stemlab"
#: Les enregistrements de job survivent une journee : assez pour qu'un client
#: interroge le resultat, trop peu pour que Redis serve de base de donnees.
JOB_TTL_SECONDS = 24 * 3600
#: L'index d'idempotence vit plus longtemps : c'est lui qui evite de repayer du GPU.
CHECKSUM_TTL_SECONDS = 30 * 24 * 3600
DLQ_MAX_LENGTH = 1000


def job_key(job_id: str) -> str:
    return f"{KEY_PREFIX}:job:{job_id}"


def checksum_key(checksum: str, model: str) -> str:
    # Le modele fait partie de la cle : le meme fichier separe en 6 stems n'est pas
    # le meme resultat qu'en 4.
    return f"{KEY_PREFIX}:checksum:{model}:{checksum}"


def dlq_key() -> str:
    return f"{KEY_PREFIX}:dlq"


@dataclass(slots=True)
class JobRecord:
    job_id: str
    track_id: str
    checksum: str
    model: str
    source_key: str
    output_prefix: str
    callback_url: str
    status: JobStatus = "queued"
    progress: int = 0
    stage: str | None = None
    error: str | None = None
    attempt: int = 0
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @classmethod
    def from_json(cls, payload: str) -> JobRecord:
        return cls(**json.loads(payload))


class JobStore:
    """Toutes les ecritures d'etat passent par ici, pour que les cles restent en un lieu."""

    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def save(self, record: JobRecord) -> None:
        await self._redis.set(job_key(record.job_id), record.to_json(), ex=JOB_TTL_SECONDS)

    async def get(self, job_id: str) -> JobRecord | None:
        payload = await self._redis.get(job_key(job_id))
        if payload is None:
            return None
        return JobRecord.from_json(_as_text(payload))

    async def update(self, job_id: str, **changes: Any) -> JobRecord | None:
        """Relit puis reecrit l'enregistrement.

        Pas de transaction : un seul worker traite un job donne a un instant donne,
        et l'API n'ecrit qu'a la creation. La seule concurrence possible serait un
        rejeu apres redemarrage, ou l'ecriture la plus recente est justement la bonne.
        """
        record = await self.get(job_id)
        if record is None:
            return None
        for name, value in changes.items():
            setattr(record, name, value)
        await self.save(record)
        return record

    # --- idempotence ---------------------------------------------------------

    async def remember_result(self, checksum: str, model: str, result: dict[str, Any]) -> None:
        await self._redis.set(
            checksum_key(checksum, model),
            json.dumps(result, ensure_ascii=False),
            ex=CHECKSUM_TTL_SECONDS,
        )

    async def recall_result(self, checksum: str, model: str) -> dict[str, Any] | None:
        payload = await self._redis.get(checksum_key(checksum, model))
        if payload is None:
            return None
        decoded: dict[str, Any] = json.loads(_as_text(payload))
        return decoded

    async def forget_result(self, checksum: str, model: str) -> None:
        await self._redis.delete(checksum_key(checksum, model))

    # --- file de rebut -------------------------------------------------------

    async def push_dead_letter(self, record: JobRecord, reason: str) -> None:
        """Conserve un job definitivement echoue, borne a DLQ_MAX_LENGTH entrees."""
        entry = json.dumps(
            {"job": asdict(record), "reason": reason, "at": time.time()}, ensure_ascii=False
        )
        await _awaited(self._redis.lpush(dlq_key(), entry))
        await _awaited(self._redis.ltrim(dlq_key(), 0, DLQ_MAX_LENGTH - 1))

    async def dead_letters(self, limit: int = 50) -> list[dict[str, Any]]:
        entries = await _awaited(self._redis.lrange(dlq_key(), 0, limit - 1))
        return [json.loads(_as_text(entry)) for entry in entries]

    async def dead_letter_count(self) -> int:
        return int(await _awaited(self._redis.llen(dlq_key())))


_T = TypeVar("_T")


def _awaited(value: Awaitable[_T] | _T) -> Awaitable[_T]:
    """redis-py partage ses signatures entre client synchrone et asynchrone.

    Le type annonce est donc une union, alors que le client asynchrone rend
    toujours un awaitable. Ce retrecissement evite d'eparpiller des `cast` dans
    tout le module.
    """
    return cast(Awaitable[_T], value)


def _as_text(value: str | bytes) -> str:
    return value.decode("utf-8") if isinstance(value, bytes) else value
