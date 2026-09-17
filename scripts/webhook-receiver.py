"""Receveur de webhook pour le developpement.

Verifie la signature HMAC exactement comme le fera le BFF, journalise ce qu'il
recoit et conserve les evenements pour inspection.

    uv run --project apps/ml python scripts/webhook-receiver.py [--port 3999]
    curl localhost:3999/events | jq
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/ml/src"))

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from ml.security import SIGNATURE_HEADER, TIMESTAMP_HEADER, verify_signature

app = FastAPI(title="Receveur de webhook STEMLAB")
EVENEMENTS: list[dict[str, Any]] = []


@app.post("/api/internal/jobs/callback")
async def callback(request: Request) -> JSONResponse:
    raw = await request.body()
    body = raw.decode("utf-8", errors="replace")

    result = verify_signature(
        app.state.secret,
        body,
        request.headers.get(SIGNATURE_HEADER),
        request.headers.get(TIMESTAMP_HEADER),
    )
    if not result.ok:
        print(f"  [REFUSE] signature invalide : {result.reason}", flush=True)
        return JSONResponse({"code": "unauthorized"}, status_code=401)

    payload = json.loads(body)
    EVENEMENTS.append({"at": time.time(), "payload": payload})

    event = payload.get("event")
    if event == "job.progress":
        print(f"  [{payload['progress']:3d}%] {payload['stage']}", flush=True)
    elif event == "job.succeeded":
        result_payload = payload["result"]
        analysis = result_payload["analysis"]
        print(
            f"  [SUCCES] {len(result_payload['stems'])} stems | "
            f"{analysis['key']} {analysis['mode']} | {analysis['bpm']} BPM | "
            f"{len(analysis['chords'])} accords | "
            f"{result_payload['processingSeconds']} s de traitement",
            flush=True,
        )
        for stem in result_payload["stems"]:
            print(f"           {stem['type']:8s} -> {stem['key']} ({stem['bytes']} o)", flush=True)
    elif event == "job.failed":
        error = payload["error"]
        print(
            f"  [ECHEC] {error['code']} : {error['message'][:160]} "
            f"(rejouable : {error['retryable']})",
            flush=True,
        )

    return JSONResponse({"received": True})


@app.get("/events")
def events() -> JSONResponse:
    return JSONResponse({"count": len(EVENEMENTS), "events": EVENEMENTS})


@app.post("/reset")
def reset() -> JSONResponse:
    EVENEMENTS.clear()
    return JSONResponse({"cleared": True})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Receveur de webhook signe")
    parser.add_argument("--port", type=int, default=3999)
    parser.add_argument("--secret", default="dev-only-change-me-hmac-secret")
    args = parser.parse_args()

    app.state.secret = args.secret
    print(f"Receveur de webhook sur http://127.0.0.1:{args.port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
