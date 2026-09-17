"""Surface HTTP du service ML (FastAPI)."""

from __future__ import annotations

import time
from typing import Any

from fastapi import FastAPI

from ml import __version__
from ml.settings import get_settings

_STARTED_AT = time.monotonic()

app = FastAPI(
    title="STEMLAB ML",
    version=__version__,
    description="Separation de sources (Demucs) et analyse musicale (Essentia).",
)


@app.get("/health")
def health() -> dict[str, Any]:
    """Liveness : repond sans toucher a Redis ni a S3."""
    settings = get_settings()
    return {
        "status": "ok",
        "service": "ml",
        "version": __version__,
        "uptimeSeconds": round(time.monotonic() - _STARTED_AT),
        "model": settings.demucs_model,
        "device": settings.torch_device,
    }
