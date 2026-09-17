import json
from pathlib import Path
from typing import TypedDict

import pytest

from ml.security import (
    DEFAULT_TOLERANCE_SECONDS,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    sign_body,
    verify_signature,
)

SECRET = "secret-de-test"
BODY = '{"event":"job.succeeded","jobId":"abc"}'
NOW = 1_700_000_000


class Vector(TypedDict):
    secret: str
    body: str
    timestamp: int
    signature: str


VECTORS: list[Vector] = json.loads(
    (Path(__file__).parent / "../../../fixtures/signature-vectors.json").read_text(encoding="utf-8")
)["vectors"]


class TestVecteursPartages:
    """Les memes vecteurs sont verifies cote TypeScript : si les deux suites passent,
    les deux implementations concordent."""

    @pytest.mark.parametrize("vector", VECTORS, ids=lambda v: str(v["timestamp"]))
    def test_reproduit_la_signature_de_reference(self, vector: Vector) -> None:
        signed = sign_body(vector["secret"], vector["body"], vector["timestamp"])
        assert signed.signature == vector["signature"]

    def test_les_vecteurs_couvrent_les_cas_interessants(self) -> None:
        bodies = [vector["body"] for vector in VECTORS]
        assert "" in bodies  # corps vide
        assert any(len(body) > 4000 for body in bodies)  # gros corps
        assert any("é" in body for body in bodies)  # UTF-8 hors ASCII


class TestSignature:
    def test_est_stable_et_hexadecimale(self) -> None:
        first = sign_body(SECRET, BODY, NOW)
        second = sign_body(SECRET, BODY, NOW)
        assert first.signature == second.signature
        assert len(first.signature) == 64
        assert first.signature == first.signature.lower()

    def test_change_avec_l_horodatage(self) -> None:
        assert sign_body(SECRET, BODY, NOW).signature != sign_body(SECRET, BODY, NOW + 1).signature

    def test_change_avec_un_seul_octet_du_corps(self) -> None:
        assert (
            sign_body(SECRET, BODY, NOW).signature != sign_body(SECRET, BODY + " ", NOW).signature
        )

    def test_expose_les_en_tetes_prets_a_envoyer(self) -> None:
        headers = sign_body(SECRET, BODY, NOW).headers
        assert headers[TIMESTAMP_HEADER] == str(NOW)
        assert headers[SIGNATURE_HEADER] == sign_body(SECRET, BODY, NOW).signature

    def test_horodate_au_present_par_defaut(self) -> None:
        signed = sign_body(SECRET, BODY)
        assert abs(signed.timestamp - int(__import__("time").time())) < 5


class TestVerification:
    def test_accepte_une_signature_valide(self) -> None:
        signed = sign_body(SECRET, BODY, NOW)
        result = verify_signature(SECRET, BODY, signed.signature, str(NOW), now=NOW)
        assert result.ok

    def test_rejette_un_secret_different(self) -> None:
        signed = sign_body("autre", BODY, NOW)
        result = verify_signature(SECRET, BODY, signed.signature, str(NOW), now=NOW)
        assert not result.ok
        assert result.reason == "mismatch"

    def test_rejette_un_corps_altere(self) -> None:
        signed = sign_body(SECRET, BODY, NOW)
        result = verify_signature(SECRET, BODY + "!", signed.signature, str(NOW), now=NOW)
        assert result.reason == "mismatch"

    @pytest.mark.parametrize(
        "decalage", [DEFAULT_TOLERANCE_SECONDS + 1, -DEFAULT_TOLERANCE_SECONDS - 1]
    )
    def test_rejette_un_rejeu_hors_fenetre(self, decalage: int) -> None:
        moment = NOW + decalage
        signed = sign_body(SECRET, BODY, moment)
        result = verify_signature(SECRET, BODY, signed.signature, str(moment), now=NOW)
        assert result.reason == "expired"

    def test_accepte_au_bord_de_la_fenetre(self) -> None:
        moment = NOW - DEFAULT_TOLERANCE_SECONDS
        signed = sign_body(SECRET, BODY, moment)
        assert verify_signature(SECRET, BODY, signed.signature, str(moment), now=NOW).ok

    @pytest.mark.parametrize(
        ("signature", "timestamp"),
        [(None, "1700000000"), ("abc", None), (None, None), ("", "1700000000")],
    )
    def test_rejette_des_en_tetes_manquants(
        self, signature: str | None, timestamp: str | None
    ) -> None:
        result = verify_signature(SECRET, BODY, signature, timestamp, now=NOW)
        assert result.reason == "missing-headers"

    def test_rejette_un_horodatage_non_numerique(self) -> None:
        signed = sign_body(SECRET, BODY, NOW)
        result = verify_signature(SECRET, BODY, signed.signature, "hier", now=NOW)
        assert result.reason == "bad-timestamp"

    def test_rejette_une_signature_de_mauvaise_longueur(self) -> None:
        result = verify_signature(SECRET, BODY, "abcd", str(NOW), now=NOW)
        assert result.reason == "mismatch"
