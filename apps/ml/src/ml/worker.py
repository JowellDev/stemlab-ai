"""Worker ARQ : consomme la file et execute le pipeline.

Le worker ne touche jamais la base de donnees. Il lit l'original sur S3, ecrit les
stems sur S3, et rend son resultat au BFF par un webhook signe. C'est cette frontiere
qui permet de le deplacer sur un GPU serverless sans rien changer ailleurs.
"""

from __future__ import annotations

import asyncio
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, ClassVar

import structlog
from arq import Retry
from arq.connections import RedisSettings
from redis.asyncio import Redis

from ml.jobs import JobRecord, JobStore
from ml.pipeline.io_audio import FFmpegError, UnsupportedAudioError
from ml.pipeline.models import PipelineResult, StemArtifact
from ml.pipeline.runner import PipelineOptions, run_pipeline
from ml.schemas import (
    CreateJobRequest,
    JobError,
    JobFailedCallback,
    JobProgressCallback,
    JobSucceededCallback,
)
from ml.settings import Settings, get_settings
from ml.storage import ObjectNotFoundError, ObjectStore, StorageError, join_key
from ml.webhook import WebhookDeliveryError, deliver

logger = structlog.get_logger(__name__)

JOB_NAME = "process_track"

#: Dix minutes : c'est aussi le plafond du worker GPU Modal (phase 9). Un morceau
#: qui n'a pas abouti dans ce delai a un probleme, il ne finira pas en trente.
JOB_TIMEOUT_SECONDS = 600

#: Trois essais au total. Au-dela, l'echec est structurel et non transitoire.
MAX_TRIES = 3

#: Pas minimal, en points de pourcentage, entre deux webhooks de progression.
#: Sans ce filtre, un morceau long inonderait le BFF.
PROGRESS_WEBHOOK_STEP = 10


class NonRetryableError(RuntimeError):
    """Erreur dont un reessai ne changera rien : entree invalide, objet absent."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


async def startup(ctx: dict[str, Any]) -> None:
    settings = get_settings()
    redis = Redis.from_url(settings.redis_url)
    ctx["settings"] = settings
    ctx["store"] = JobStore(redis)
    ctx["redis_client"] = redis
    ctx["object_store"] = ObjectStore(settings)
    logger.info("worker.startup", model=settings.demucs_model, device=settings.torch_device)


async def shutdown(ctx: dict[str, Any]) -> None:
    redis: Redis | None = ctx.get("redis_client")
    if redis is not None:
        await redis.aclose()
    logger.info("worker.shutdown")


async def process_track(ctx: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """Traite un morceau de bout en bout.

    Renvoie un resume ; le resultat complet part par le webhook, parce que c'est lui
    qui doit arriver meme si personne n'interroge la file.
    """
    settings: Settings = ctx["settings"]
    store: JobStore = ctx["store"]
    objects: ObjectStore = ctx["object_store"]

    request = CreateJobRequest.model_validate(payload)
    job_id = str(ctx.get("job_id") or uuid.uuid4())
    attempt = int(ctx.get("job_try", 1))

    record = await store.get(job_id) or JobRecord(
        job_id=job_id,
        track_id=request.track_id,
        checksum=request.checksum,
        model=request.model,
        source_key=request.source_key,
        output_prefix=request.output_prefix,
        callback_url=request.callback_url,
    )
    record.status = "running"
    record.attempt = attempt
    record.started_at = record.started_at or time.time()
    record.error = None
    record.progress = 0
    await store.save(record)

    log = logger.bind(job_id=job_id, track_id=request.track_id, attempt=attempt)
    log.info("job.start", model=request.model, source=request.source_key)

    try:
        result = await _execute(ctx, request, record, store, objects, settings, log)
    except NonRetryableError as error:
        await _fail(store, record, request, settings, error.code, str(error), retryable=False)
        log.error("job.failed", code=error.code, retryable=False)
        raise
    except Exception as error:  # on reclasse toute erreur inattendue en echec de job
        retryable = attempt < MAX_TRIES
        message = f"{type(error).__name__}: {error}"
        if retryable:
            record.status = "queued"
            record.error = message
            await store.save(record)
            log.warning("job.retry", error=message, next_attempt=attempt + 1)
            # Recul exponentiel : 5 s, puis 20 s.
            raise Retry(defer=5 * (4 ** (attempt - 1))) from error
        await _fail(store, record, request, settings, "internal_error", message, retryable=False)
        log.error("job.failed", error=message, retryable=False)
        raise

    log.info("job.succeeded", stems=len(result.stems), seconds=result.processing_seconds)
    return {
        "jobId": job_id,
        "trackId": request.track_id,
        "stems": len(result.stems),
        "processingSeconds": result.processing_seconds,
    }


async def _execute(
    ctx: dict[str, Any],
    request: CreateJobRequest,
    record: JobRecord,
    store: JobStore,
    objects: ObjectStore,
    settings: Settings,
    log: Any,
) -> PipelineResult:
    loop = asyncio.get_running_loop()
    last_reported = -PROGRESS_WEBHOOK_STEP

    async def publish(percent: int, stage: str) -> None:
        nonlocal last_reported
        record.progress = percent
        record.stage = stage
        await store.save(record)
        if percent - last_reported < PROGRESS_WEBHOOK_STEP and percent < 100:
            return
        last_reported = percent
        callback = JobProgressCallback(
            job_id=record.job_id, track_id=request.track_id, progress=percent, stage=stage
        )
        try:
            await deliver(
                request.callback_url,
                settings.webhook_secret,
                callback.model_dump_json(by_alias=True),
            )
        except WebhookDeliveryError as error:
            # Une progression perdue n'est pas un echec du job : le BFF peut
            # toujours interroger GET /jobs/{id}.
            log.warning("progress.undelivered", error=str(error))

    def report(percent: int, stage: str) -> None:
        # Le pipeline tourne dans un thread : on repasse par la boucle pour ecrire.
        asyncio.run_coroutine_threadsafe(publish(percent, stage), loop)

    with tempfile.TemporaryDirectory(prefix="stemlab-") as temporary:
        workdir = Path(temporary)
        source = workdir / f"source{Path(request.source_key).suffix or '.bin'}"

        try:
            objects.download(request.source_key, source)
        except ObjectNotFoundError as error:
            raise NonRetryableError("not_found", str(error)) from error

        options = PipelineOptions(
            model=request.model,
            device=settings.torch_device,
            opus_bitrate=settings.stem_opus_bitrate,
            points_per_second=settings.waveform_points_per_second,
        )

        try:
            result = await loop.run_in_executor(
                None, lambda: run_pipeline(source, workdir / "out", options, report)
            )
        except (FFmpegError, UnsupportedAudioError) as error:
            raise NonRetryableError("unsupported_media_type", str(error)) from error

        uploaded = _upload_stems(objects, result.stems, workdir / "out", request.output_prefix)

    final = result.model_copy(update={"stems": uploaded})

    await store.remember_result(request.checksum, request.model, final.model_dump(by_alias=True))
    await _succeed(store, record, request, settings, final)
    return final


def _upload_stems(
    objects: ObjectStore,
    stems: list[StemArtifact],
    directory: Path,
    prefix: str,
) -> list[StemArtifact]:
    """Envoie chaque stem et remplace son nom de fichier local par sa cle S3."""
    uploaded: list[StemArtifact] = []
    for stem in stems:
        local = directory / stem.key
        key = join_key(prefix, f"{stem.type}.{stem.format}")
        try:
            objects.upload(local, key)
        except StorageError as error:
            raise RuntimeError(f"envoi du stem {stem.type} impossible") from error
        uploaded.append(stem.model_copy(update={"key": key}))
    return uploaded


async def _succeed(
    store: JobStore,
    record: JobRecord,
    request: CreateJobRequest,
    settings: Settings,
    result: PipelineResult,
) -> None:
    record.status = "succeeded"
    record.progress = 100
    record.stage = "termine"
    record.finished_at = time.time()
    await store.save(record)

    callback = JobSucceededCallback(
        job_id=record.job_id,
        track_id=request.track_id,
        checksum=request.checksum,
        result=result,
    )
    await deliver(
        request.callback_url, settings.webhook_secret, callback.model_dump_json(by_alias=True)
    )


async def _fail(
    store: JobStore,
    record: JobRecord,
    request: CreateJobRequest,
    settings: Settings,
    code: str,
    message: str,
    *,
    retryable: bool,
) -> None:
    record.status = "failed"
    record.error = message
    record.finished_at = time.time()
    await store.save(record)
    await store.push_dead_letter(record, message)

    callback = JobFailedCallback(
        job_id=record.job_id,
        track_id=request.track_id,
        checksum=request.checksum,
        error=JobError(code=code, message=message[:2000], retryable=retryable),
    )
    try:
        await deliver(
            request.callback_url, settings.webhook_secret, callback.model_dump_json(by_alias=True)
        )
    except WebhookDeliveryError as error:
        # Le job reste dans la file de rebut : rien n'est perdu, meme si le BFF
        # n'a pas pu etre prevenu.
        logger.error("failure.undelivered", job_id=record.job_id, error=str(error))


def build_redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(get_settings().redis_url)


class WorkerSettings:
    """Configuration consommee par `arq ml.worker.WorkerSettings`."""

    functions: ClassVar[list[Any]] = [process_track]
    on_startup = startup
    on_shutdown = shutdown
    max_tries = MAX_TRIES
    job_timeout = JOB_TIMEOUT_SECONDS
    #: Rejoue les jobs interrompus : c'est ce qui permet de redemarrer le worker
    #: en cours de traitement sans perdre le travail en file.
    retry_jobs = True
    #: Le resultat complet part par webhook ; on garde un resume une heure pour
    #: l'inspection.
    keep_result = 3600
    max_jobs = 2
    #: arq attend une instance, pas une fabrique : elle est construite au chargement
    #: du module, a partir de la configuration deja mise en cache.
    redis_settings = build_redis_settings()
