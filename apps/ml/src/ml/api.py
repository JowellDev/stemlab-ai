"""Surface HTTP du service ML (FastAPI).

Deux points d'entree utiles : deposer un job, suivre sa progression. Les deux sont
signes HMAC — ce service n'est jamais expose publiquement, seul le BFF lui parle.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import structlog
from arq import create_pool
from arq.connections import ArqRedis
from fastapi import APIRouter, FastAPI, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from redis.asyncio import Redis

from ml import __version__
from ml.jobs import JobRecord, JobStore
from ml.schemas import (
    CreateJobRequest,
    CreateJobResponse,
    JobProgressResponse,
    JobSucceededCallback,
    to_iso,
)
from ml.security import SIGNATURE_HEADER, TIMESTAMP_HEADER, verify_signature
from ml.settings import Settings, get_settings
from ml.webhook import WebhookDeliveryError, deliver
from ml.worker import JOB_NAME, build_redis_settings

logger = structlog.get_logger(__name__)

_STARTED_AT = time.monotonic()


router = APIRouter()


def create_app(
    settings: Settings | None = None,
    redis: Redis | None = None,
    queue: ArqRedis | None = None,
) -> FastAPI:
    """Construit l'application.

    Les trois dependances sont injectables : c'est ce qui permet de tester la
    surface HTTP contre un Redis en memoire et une file factice, sans rien simuler
    du code teste lui-meme.
    """
    injected = (settings, redis, queue)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        resolved_settings = settings or get_settings()
        resolved_redis = redis or Redis.from_url(resolved_settings.redis_url)
        resolved_queue = queue or await create_pool(build_redis_settings())

        application.state.settings = resolved_settings
        application.state.redis = resolved_redis
        application.state.queue = resolved_queue
        application.state.store = JobStore(resolved_redis)

        logger.info("api.startup", version=__version__, model=resolved_settings.demucs_model)
        try:
            yield
        finally:
            # On ne ferme que ce qu'on a ouvert : une dependance injectee appartient
            # a l'appelant, qui peut la reutiliser entre deux tests.
            if all(value is None for value in injected):
                await resolved_queue.aclose()
                await resolved_redis.aclose()
            logger.info("api.shutdown")

    application = FastAPI(
        title="STEMLAB ML",
        version=__version__,
        description="Separation de sources (Demucs) et analyse musicale (Essentia).",
        lifespan=lifespan,
    )
    application.include_router(router)
    return application


@router.get("/health")
def health() -> dict[str, Any]:
    """Liveness : repond sans toucher a Redis ni a S3, et sans charger torch."""
    settings = get_settings()
    return {
        "status": "ok",
        "service": "ml",
        "version": __version__,
        "uptimeSeconds": round(time.monotonic() - _STARTED_AT),
        "model": settings.demucs_model,
        "device": settings.torch_device,
    }


@router.get("/ready")
async def ready(request: Request) -> Response:
    """Readiness : verifie la dependance dont le service ne peut pas se passer."""
    redis: Redis = request.app.state.redis
    try:
        await redis.ping()
    except Exception as error:  # la cause exacte importe peu au demandeur
        logger.warning("ready.redis_unavailable", error=str(error))
        return JSONResponse(
            {"status": "degraded", "redis": False},
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return JSONResponse({"status": "ok", "redis": True})


@router.post("/jobs", status_code=status.HTTP_202_ACCEPTED)
async def create_job(request: Request) -> Response:
    """Depose un job de separation et d'analyse.

    Le corps brut est lu avant toute deserialisation : la signature porte sur les
    octets recus, pas sur une representation reserialisee qui pourrait differer.
    """
    settings: Settings = request.app.state.settings
    raw = await request.body()
    body = raw.decode("utf-8", errors="replace")

    verification = verify_signature(
        settings.webhook_secret,
        body,
        request.headers.get(SIGNATURE_HEADER),
        request.headers.get(TIMESTAMP_HEADER),
        tolerance_seconds=settings.webhook_tolerance_seconds,
    )
    if not verification.ok:
        logger.warning("jobs.signature_rejected", reason=verification.reason)
        return _error(status.HTTP_401_UNAUTHORIZED, "unauthorized", "signature invalide")

    try:
        payload = CreateJobRequest.model_validate_json(raw)
    except ValidationError as error:
        return _error(
            status.HTTP_400_BAD_REQUEST, "bad_request", "requete invalide", _fields_from(error)
        )

    store: JobStore = request.app.state.store
    queue: ArqRedis = request.app.state.queue
    job_id = str(uuid.uuid4())

    # Idempotence : un fichier deja traite avec le meme modele ne repasse pas dans
    # le pipeline. On rejoue simplement le webhook de succes, pour que le BFF
    # recoive exactement ce qu'il aurait recu.
    cached = await store.recall_result(payload.checksum, payload.model)
    if cached is not None:
        await _replay(settings, payload, job_id, cached, store)
        return JSONResponse(
            CreateJobResponse(job_id=job_id, status="succeeded", deduplicated=True).model_dump(
                by_alias=True
            ),
            status_code=status.HTTP_200_OK,
        )

    record = JobRecord(
        job_id=job_id,
        track_id=payload.track_id,
        checksum=payload.checksum,
        model=payload.model,
        source_key=payload.source_key,
        output_prefix=payload.output_prefix,
        callback_url=payload.callback_url,
    )
    await store.save(record)
    await queue.enqueue_job(JOB_NAME, payload.model_dump(by_alias=True), _job_id=job_id)

    logger.info("jobs.enqueued", job_id=job_id, track_id=payload.track_id, model=payload.model)
    return JSONResponse(
        CreateJobResponse(job_id=job_id, status="queued", deduplicated=False).model_dump(
            by_alias=True
        ),
        status_code=status.HTTP_202_ACCEPTED,
    )


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, request: Request) -> Response:
    store: JobStore = request.app.state.store
    record = await store.get(job_id)
    if record is None:
        return _error(status.HTTP_404_NOT_FOUND, "not_found", "job inconnu")

    return JSONResponse(
        JobProgressResponse(
            job_id=record.job_id,
            track_id=record.track_id,
            type="separate_and_analyze",
            status=record.status,
            progress=record.progress,
            stage=record.stage,
            error=record.error,
            attempt=record.attempt,
            started_at=to_iso(record.started_at),
            finished_at=to_iso(record.finished_at),
        ).model_dump(by_alias=True)
    )


@router.get("/dead-letters")
async def dead_letters(request: Request, limit: int = 50) -> Response:
    """Jobs definitivement echoues, conserves pour inspection."""
    store: JobStore = request.app.state.store
    return JSONResponse(
        {
            "count": await store.dead_letter_count(),
            "entries": await store.dead_letters(min(max(limit, 1), 200)),
        }
    )


async def _replay(
    settings: Settings,
    payload: CreateJobRequest,
    job_id: str,
    cached: dict[str, Any],
    store: JobStore,
) -> None:
    """Rejoue le webhook de succes pour un resultat deja en cache."""
    record = JobRecord(
        job_id=job_id,
        track_id=payload.track_id,
        checksum=payload.checksum,
        model=payload.model,
        source_key=payload.source_key,
        output_prefix=payload.output_prefix,
        callback_url=payload.callback_url,
        status="succeeded",
        progress=100,
        stage="deduplique",
        started_at=time.time(),
        finished_at=time.time(),
    )
    await store.save(record)

    callback = JobSucceededCallback.model_validate(
        {
            "jobId": job_id,
            "trackId": payload.track_id,
            "checksum": payload.checksum,
            "result": cached,
        }
    )
    try:
        await deliver(
            payload.callback_url,
            settings.webhook_secret,
            callback.model_dump_json(by_alias=True),
        )
        logger.info("jobs.deduplicated", job_id=job_id, checksum=payload.checksum)
    except WebhookDeliveryError as error:
        logger.error("jobs.replay_undelivered", job_id=job_id, error=str(error))


def _fields_from(error: ValidationError) -> dict[str, list[str]]:
    """Erreurs pydantic ramenees a la forme `ApiError.fields` des contrats.

    On ecarte le contexte et l'entree : le contexte porte des objets Python non
    serialisables, et renvoyer l'entree ferait du service un echo pour qui le sonde.
    """
    fields: dict[str, list[str]] = {}
    for item in error.errors(include_url=False, include_input=False, include_context=False):
        name = ".".join(str(part) for part in item["loc"]) or "_"
        fields.setdefault(name, []).append(item["msg"])
    return fields


def _error(
    http_status: int, code: str, message: str, fields: dict[str, list[str]] | None = None
) -> JSONResponse:
    body: dict[str, Any] = {"code": code, "message": message}
    if fields is not None:
        body["fields"] = fields
    return JSONResponse(body, status_code=http_status)


#: Instance servie par uvicorn (`uvicorn ml.api:app`).
app = create_app()
