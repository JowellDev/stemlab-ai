"""Signature HMAC des appels internes.

Implementation Python du schema decrit dans `packages/contracts/src/signature.ts`.
Les deux doivent rester identiques : la chaine signee est `${timestamp}.${corps}`,
ou le corps est l'octet pour octet de la requete HTTP. Un jeu de vecteurs partage
(`fixtures/signature-vectors.json`) verifie que les deux implementations concordent.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from dataclasses import dataclass
from typing import Literal

SIGNATURE_HEADER = "x-stemlab-signature"
TIMESTAMP_HEADER = "x-stemlab-timestamp"
DEFAULT_TOLERANCE_SECONDS = 300

FailureReason = Literal["missing-headers", "bad-timestamp", "expired", "mismatch"]


@dataclass(frozen=True, slots=True)
class SignedRequest:
    signature: str
    timestamp: int

    @property
    def headers(self) -> dict[str, str]:
        return {SIGNATURE_HEADER: self.signature, TIMESTAMP_HEADER: str(self.timestamp)}


def signed_payload(timestamp: int, body: str) -> str:
    return f"{timestamp}.{body}"


def sign_body(secret: str, body: str, timestamp: int | None = None) -> SignedRequest:
    """Signature hexadecimale minuscule, sans prefixe."""
    moment = int(time.time()) if timestamp is None else timestamp
    digest = hmac.new(
        secret.encode("utf-8"), signed_payload(moment, body).encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return SignedRequest(signature=digest, timestamp=moment)


@dataclass(frozen=True, slots=True)
class VerificationResult:
    ok: bool
    reason: FailureReason | None = None


def verify_signature(
    secret: str,
    body: str,
    signature: str | None,
    timestamp: str | None,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
    now: int | None = None,
) -> VerificationResult:
    """Verifie une signature entrante, en temps constant.

    La fenetre de tolerance ferme la porte au rejeu : une requete capturee ne peut
    etre replayee que pendant `tolerance_seconds`.
    """
    if not signature or not timestamp:
        return VerificationResult(ok=False, reason="missing-headers")

    try:
        moment = int(timestamp)
    except ValueError:
        return VerificationResult(ok=False, reason="bad-timestamp")

    current = int(time.time()) if now is None else now
    if abs(current - moment) > tolerance_seconds:
        return VerificationResult(ok=False, reason="expired")

    expected = sign_body(secret, body, moment)
    if not hmac.compare_digest(expected.signature, signature):
        return VerificationResult(ok=False, reason="mismatch")

    return VerificationResult(ok=True)
