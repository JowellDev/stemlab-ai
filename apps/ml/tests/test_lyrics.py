"""Transcription des paroles et traduction.

Les modeles sont telecharges au premier appel puis mis en cache : le premier
passage est lent, les suivants ne le sont pas. Les tests qui touchent un modele
sont donc regroupes pour n'en charger qu'un seul par famille.
"""

from __future__ import annotations

from collections.abc import Callable
from itertools import pairwise
from pathlib import Path

import pytest

from ml.pipeline.lyrics import TranscriptionSettings, transcribe, translate
from ml.pipeline.models import LyricLine, Lyrics

from .conftest import (
    SPEECH_FIXTURE,
    speech_fixture_required,
    transformers_required,
    whisper_required,
)


@pytest.fixture(scope="module")
def transcription() -> Lyrics | None:
    return transcribe(SPEECH_FIXTURE, TranscriptionSettings(model="small"))


@whisper_required
@speech_fixture_required
class TestTranscription:
    def test_reconnait_la_langue(self, transcription: Lyrics | None) -> None:
        assert transcription is not None
        assert transcription.language == "en"
        assert transcription.language_confidence > 0.8

    def test_transcrit_le_texte(self, transcription: Lyrics) -> None:
        texte = " ".join(ligne.text for ligne in transcription.lines).lower()
        # Le contenu exact depend du modele ; ces mots-la, eux, sont sans ambiguite.
        assert "ask not what your country can do for you" in texte

    def test_horodate_chaque_mot(self, transcription: Lyrics) -> None:
        mots = [mot for ligne in transcription.lines for mot in ligne.words]
        assert len(mots) > 10

        # Les mots avancent : un horodatage qui recule rendrait le defilement
        # incoherent, et c'est la seule propriete dont depend l'affichage.
        for precedent, suivant in pairwise(mots):
            assert suivant.start >= precedent.start
            assert suivant.end >= suivant.start

    def test_les_lignes_tiennent_dans_la_duree(self, transcription: Lyrics) -> None:
        for ligne in transcription.lines:
            assert 0.0 <= ligne.start <= ligne.end <= 12.0
            if ligne.words:
                assert ligne.words[0].start >= ligne.start - 0.5
                assert ligne.words[-1].end <= ligne.end + 0.5

    def test_un_instrumental_ne_rend_rien(self, make_tone: Callable[..., Path]) -> None:
        # Une sinusoide n'a pas de paroles. Inventer un texte serait pire que
        # n'en rendre aucun.
        silence = make_tone(name="instrumental.wav", frequency=220, seconds=4.0)
        assert transcribe(silence, TranscriptionSettings(model="small")) is None


@transformers_required
class TestTraduction:
    @staticmethod
    def _paroles(language: str, *lignes: str) -> Lyrics:
        return Lyrics(
            language=language,
            language_confidence=0.95,
            lines=[
                LyricLine(start=i, end=i + 1, text=texte, words=[])
                for i, texte in enumerate(lignes)
            ],
            translations={},
        )

    def test_traduit_du_francais_vers_l_anglais(self) -> None:
        paroles = self._paroles("fr", "Je marche seul dans la nuit sans fin")
        traduit = translate(paroles, "en")

        assert "en" in traduit.translations
        assert traduit.translations["en"][0].lower().startswith("i walk alone")

    def test_conserve_une_traduction_par_ligne(self) -> None:
        paroles = self._paroles("fr", "Premiere ligne", "Deuxieme ligne", "Troisieme ligne")
        traduit = translate(paroles, "en")

        # L'alignement avec les horodatages tient a cette egalite, et a rien d'autre.
        assert len(traduit.translations["en"]) == len(paroles.lines)

    def test_ne_traduit_pas_vers_sa_propre_langue(self) -> None:
        paroles = self._paroles("fr", "Une ligne")
        assert translate(paroles, "fr").translations == {}

    def test_ignore_une_paire_non_prise_en_charge(self) -> None:
        paroles = self._paroles("de", "Eine Zeile")
        assert translate(paroles, "fr").translations == {}

    def test_ne_traduit_pas_sans_langue_detectee(self) -> None:
        paroles = self._paroles("fr", "Une ligne").model_copy(update={"language": None})
        assert translate(paroles, "en").translations == {}

    def test_ne_refait_pas_une_traduction_existante(self) -> None:
        paroles = self._paroles("fr", "Une ligne").model_copy(
            update={"translations": {"en": ["A line"]}}
        )
        assert translate(paroles, "en").translations["en"] == ["A line"]
