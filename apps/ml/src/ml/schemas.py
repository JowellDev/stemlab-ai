"""Schemas de la surface HTTP du service.

Miroir Python de `packages/contracts/src/jobs.ts`. Les noms partent en camelCase :
c'est le BFF TypeScript qui parle a ce service, et il ne doit pas avoir a convertir.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from ml.pipeline.models import CamelModel, PipelineResult, SeparationModel

JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
JobType = Literal["separate_and_analyze"]

#: Meme regle que `S3Key` cote contrats : pas de slash initial, pas de remontee.
S3_KEY_PATTERN = re.compile(r"^[A-Za-z0-9!_.*'()/-]+$")
CHECKSUM_PATTERN = re.compile(r"^[a-f0-9]{64}$")


def _validate_s3_key(value: str) -> str:
    if not S3_KEY_PATTERN.match(value):
        raise ValueError("cle S3 invalide")
    if value.startswith("/") or ".." in value:
        raise ValueError("cle S3 invalide")
    return value


class CreateJobRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    track_id: str
    source_key: Annotated[str, Field(min_length=1, max_length=1024)]
    checksum: str
    model: SeparationModel = "htdemucs"
    output_prefix: Annotated[str, Field(min_length=1, max_length=1024)]
    callback_url: str

    @field_validator("source_key", "output_prefix")
    @classmethod
    def _check_keys(cls, value: str) -> str:
        return _validate_s3_key(value)

    @field_validator("checksum")
    @classmethod
    def _check_checksum(cls, value: str) -> str:
        if not CHECKSUM_PATTERN.match(value):
            raise ValueError("checksum sha-256 hexadecimal attendu")
        return value

    @field_validator("callback_url")
    @classmethod
    def _check_callback(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError("callbackUrl doit etre une URL http(s)")
        return value


class CreateJobResponse(CamelModel):
    job_id: str
    status: JobStatus
    #: Vrai quand le resultat provenait deja du cache d'idempotence.
    deduplicated: bool


class JobProgressResponse(CamelModel):
    job_id: str
    track_id: str
    type: JobType
    status: JobStatus
    progress: Annotated[int, Field(ge=0, le=100)]
    stage: str | None
    error: str | None
    attempt: Annotated[int, Field(ge=0)]
    started_at: str | None
    finished_at: str | None


class JobError(CamelModel):
    code: str
    message: str
    retryable: bool


class JobSucceededCallback(CamelModel):
    event: Literal["job.succeeded"] = "job.succeeded"
    job_id: str
    track_id: str
    checksum: str
    result: PipelineResult


class JobFailedCallback(CamelModel):
    event: Literal["job.failed"] = "job.failed"
    job_id: str
    track_id: str
    checksum: str
    error: JobError


class JobProgressCallback(CamelModel):
    event: Literal["job.progress"] = "job.progress"
    job_id: str
    track_id: str
    progress: Annotated[int, Field(ge=0, le=100)]
    stage: str


def to_iso(moment: float | None) -> str | None:
    """Horodatage ISO 8601 en UTC, ou `None`. Format attendu par `z.iso.datetime()`."""
    if moment is None:
        return None
    return (
        datetime.fromtimestamp(moment, tz=UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
