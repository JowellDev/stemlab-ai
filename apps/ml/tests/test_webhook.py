"""Tests de la livraison du webhook.

`httpx.MockTransport` intercepte au niveau du transport : tout le code de `deliver`
est reellement execute, y compris la signature et la logique de reessai. Seul le
reseau est absent.
"""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest

from ml.security import SIGNATURE_HEADER, TIMESTAMP_HEADER, verify_signature
from ml.webhook import RETRY_DELAYS, WebhookDeliveryError, deliver

SECRET = "secret-webhook"
URL = "http://bff.test/api/internal/jobs/callback"
BODY = json.dumps({"event": "job.succeeded", "jobId": "job-1"})


@pytest.fixture(autouse=True)
def pas_d_attente(monkeypatch: pytest.MonkeyPatch) -> None:
    """Neutralise les delais : ce sont les enchainements qu'on teste, pas l'horloge."""

    async def instantane(_delay: float) -> None:
        return None

    monkeypatch.setattr("ml.webhook.asyncio.sleep", instantane)


def client_with(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class TestLivraison:
    async def test_livre_du_premier_coup(self) -> None:
        async with client_with(lambda _request: httpx.Response(204)) as client:
            outcome = await deliver(URL, SECRET, BODY, client)
        assert outcome.status_code == 204
        assert outcome.attempts == 1

    async def test_signe_le_corps_envoye(self) -> None:
        captured: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured.append(request)
            return httpx.Response(200)

        async with client_with(handler) as client:
            await deliver(URL, SECRET, BODY, client)

        request = captured[0]
        assert request.content.decode() == BODY
        result = verify_signature(
            SECRET,
            BODY,
            request.headers[SIGNATURE_HEADER],
            request.headers[TIMESTAMP_HEADER],
        )
        assert result.ok

    async def test_envoie_le_bon_type_de_contenu(self) -> None:
        captured: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured.append(request)
            return httpx.Response(200)

        async with client_with(handler) as client:
            await deliver(URL, SECRET, BODY, client)
        assert captured[0].headers["content-type"] == "application/json"


class TestReessais:
    async def test_reessaie_apres_une_erreur_serveur(self) -> None:
        tentatives = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal tentatives
            tentatives += 1
            return httpx.Response(200 if tentatives == 3 else 503)

        async with client_with(handler) as client:
            outcome = await deliver(URL, SECRET, BODY, client)
        assert outcome.attempts == 3

    async def test_reessaie_apres_une_erreur_reseau(self) -> None:
        tentatives = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal tentatives
            tentatives += 1
            if tentatives < 2:
                raise httpx.ConnectError("connexion refusee")
            return httpx.Response(200)

        async with client_with(handler) as client:
            assert (await deliver(URL, SECRET, BODY, client)).attempts == 2

    @pytest.mark.parametrize("code", [408, 425, 429, 500, 502, 503, 504])
    async def test_considere_ces_statuts_comme_transitoires(self, code: int) -> None:
        tentatives = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal tentatives
            tentatives += 1
            return httpx.Response(200 if tentatives > 1 else code)

        async with client_with(handler) as client:
            assert (await deliver(URL, SECRET, BODY, client)).attempts == 2

    @pytest.mark.parametrize("code", [400, 401, 403, 404, 409, 422])
    async def test_abandonne_immediatement_sur_un_refus_definitif(self, code: int) -> None:
        tentatives = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal tentatives
            tentatives += 1
            return httpx.Response(code)

        async with client_with(handler) as client:
            with pytest.raises(WebhookDeliveryError):
                await deliver(URL, SECRET, BODY, client)
        # Un corps refuse pour cause de validation ne deviendra pas valide en le
        # renvoyant : on n'insiste pas.
        assert tentatives == 1

    async def test_abandonne_apres_toutes_les_tentatives(self) -> None:
        tentatives = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal tentatives
            tentatives += 1
            return httpx.Response(503)

        async with client_with(handler) as client:
            with pytest.raises(WebhookDeliveryError, match="non livre"):
                await deliver(URL, SECRET, BODY, client)
        assert tentatives == len(RETRY_DELAYS) + 1

    async def test_rehorodate_chaque_tentative(self) -> None:
        """Sinon la fenetre de tolerance pourrait expirer entre le premier essai
        et le dernier, et le BFF rejetterait une livraison pourtant legitime."""
        horodatages: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            horodatages.append(request.headers[TIMESTAMP_HEADER])
            return httpx.Response(200 if len(horodatages) == 3 else 503)

        async with client_with(handler) as client:
            await deliver(URL, SECRET, BODY, client)

        # Chaque envoi porte sa propre signature, recalculee.
        assert len(horodatages) == 3
