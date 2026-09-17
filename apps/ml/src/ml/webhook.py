"""Envoi du webhook signe vers le BFF.

C'est le seul canal par lequel un resultat remonte : le worker ne touche jamais la
base. Un echec de livraison est donc une perte reelle, d'ou les reessais.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import httpx
import structlog

from ml.security import sign_body

logger = structlog.get_logger(__name__)

#: Delais entre les tentatives, en secondes. Cinq envois au total, sur ~30 s.
RETRY_DELAYS = (0.5, 2.0, 5.0, 15.0)
REQUEST_TIMEOUT_SECONDS = 15.0

#: Au-dela de 500, le BFF est momentanement indisponible : cela vaut un reessai.
#: 429 aussi. Une 4xx de validation, non — le corps ne changera pas.
RETRYABLE_STATUS = {408, 425, 429}


class WebhookDeliveryError(RuntimeError):
    """Le webhook n'a pas pu etre livre apres tous les reessais."""


@dataclass(frozen=True, slots=True)
class DeliveryOutcome:
    status_code: int
    attempts: int


async def deliver(
    url: str,
    secret: str,
    body: str,
    client: httpx.AsyncClient | None = None,
) -> DeliveryOutcome:
    """Poste le corps signe, avec reessais a delai croissant.

    Le corps est signe une fois et reenvoye tel quel a chaque tentative — mais
    l'horodatage, lui, est refait a chaque envoi : sinon la fenetre de tolerance
    pourrait expirer entre le premier essai et le dernier.
    """
    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS)
    last_error: str = "aucune tentative"
    last_status = 0

    try:
        for attempt in range(len(RETRY_DELAYS) + 1):
            signed = sign_body(secret, body)
            try:
                response = await http.post(
                    url,
                    content=body.encode("utf-8"),
                    headers={"content-type": "application/json", **signed.headers},
                )
            except httpx.HTTPError as error:
                last_error = f"erreur reseau : {error}"
            else:
                last_status = response.status_code
                if response.is_success:
                    return DeliveryOutcome(status_code=response.status_code, attempts=attempt + 1)
                last_error = f"HTTP {response.status_code}"
                if not _is_retryable(response.status_code):
                    raise WebhookDeliveryError(
                        f"webhook refuse definitivement ({last_error}) par {url}"
                    )

            if attempt < len(RETRY_DELAYS):
                delay = RETRY_DELAYS[attempt]
                logger.warning(
                    "webhook.retry", url=url, attempt=attempt + 1, delay=delay, reason=last_error
                )
                await asyncio.sleep(delay)
    finally:
        if owns_client:
            await http.aclose()

    raise WebhookDeliveryError(
        f"webhook non livre apres {len(RETRY_DELAYS) + 1} tentatives ({last_error}), "
        f"dernier statut {last_status}"
    )


def _is_retryable(status_code: int) -> bool:
    return status_code >= 500 or status_code in RETRYABLE_STATUS
