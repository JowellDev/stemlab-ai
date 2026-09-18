"""Transcription des paroles et traduction.

La transcription porte sur le stem `vocals`, pas sur le mixage : une voix
debarrassee de la batterie et de la basse se transcrit nettement mieux, et c'est
le seul avantage que cette application ait sur un transcripteur generique.

`faster-whisper` plutot que `openai-whisper` : meme modele, execute par
CTranslate2, plusieurs fois plus rapide sur processeur — ce qui compte quand
aucun GPU n'est garanti.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .models import LyricLine, Lyrics, LyricWord

if TYPE_CHECKING:
    from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)

#: Sous ce seuil, Whisper a surtout reconnu du bruit. Les segments concernes sont
#: ecartes : une parole inventee est pire qu'une parole absente.
MIN_SEGMENT_CONFIDENCE = -1.0

#: Whisper renvoie une probabilite de langue ; en dessous, on ne l'annonce pas.
MIN_LANGUAGE_CONFIDENCE = 0.5

#: Modeles de traduction OPUS-MT. Petits, rapides, sous licence permissive.
TRANSLATION_MODELS = {
    ("en", "fr"): "Helsinki-NLP/opus-mt-en-fr",
    ("fr", "en"): "Helsinki-NLP/opus-mt-fr-en",
}


@dataclass(frozen=True)
class TranscriptionSettings:
    """Reglages de transcription.

    `model` suit `WHISPER_MODEL` : `small` suffit aux tests, `large-v3` sert en
    production. Le compromis n'a pas a etre fige dans le code.
    """

    model: str = "small"
    device: str = "cpu"
    compute_type: str = "int8"
    #: `None` : Whisper detecte la langue lui-meme.
    language: str | None = None


@lru_cache(maxsize=2)
def _load_model(model: str, device: str, compute_type: str) -> WhisperModel:
    from faster_whisper import WhisperModel

    logger.info("chargement de Whisper", extra={"model": model, "device": device})
    return WhisperModel(model, device=device, compute_type=compute_type)


def transcribe(vocals: Path, settings: TranscriptionSettings | None = None) -> Lyrics | None:
    """Transcrit une piste de voix, horodatee au mot.

    Renvoie `None` quand rien d'exploitable n'a ete reconnu — un morceau
    instrumental, par exemple. Un resultat vide serait indistinguable d'un echec.
    """
    settings = settings or TranscriptionSettings()
    model = _load_model(settings.model, settings.device, settings.compute_type)

    segments, info = model.transcribe(
        str(vocals),
        language=settings.language,
        word_timestamps=True,
        # Le detecteur d'activite vocale ecarte les longs passages instrumentaux,
        # ou Whisper a tendance a halluciner des paroles.
        vad_filter=True,
        condition_on_previous_text=False,
    )

    lines = [line for segment in segments if (line := _to_line(segment)) is not None]
    if not lines:
        return None

    language = info.language if info.language_probability >= MIN_LANGUAGE_CONFIDENCE else None

    return Lyrics(
        language=language,
        language_confidence=round(float(info.language_probability), 3),
        lines=lines,
        translations={},
    )


def _to_line(segment: Any) -> LyricLine | None:
    text = segment.text.strip()
    if not text:
        return None
    if segment.avg_logprob < MIN_SEGMENT_CONFIDENCE:
        return None

    words = [
        LyricWord(
            start=max(0.0, float(word.start)),
            end=max(float(word.start), float(word.end)),
            text=word.word.strip(),
        )
        for word in (segment.words or [])
        if word.word.strip()
    ]

    return LyricLine(
        start=max(0.0, float(segment.start)),
        end=max(float(segment.start), float(segment.end)),
        text=text,
        words=words,
    )


@lru_cache(maxsize=2)
def _load_translator(name: str) -> tuple[Any, Any]:
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    logger.info("chargement du traducteur", extra={"model": name})
    return AutoTokenizer.from_pretrained(name), AutoModelForSeq2SeqLM.from_pretrained(name)


def translate(lyrics: Lyrics, target: str) -> Lyrics:
    """Ajoute une traduction ligne a ligne.

    Ligne a ligne et non bloc entier : les horodatages doivent rester alignes,
    et une traduction globale redecoupee arbitrairement ne le garantirait pas.
    Le prix est un contexte plus court, donc quelques tournures moins heureuses.
    """
    if lyrics.language is None or lyrics.language == target:
        return lyrics
    if target in lyrics.translations:
        return lyrics

    name = TRANSLATION_MODELS.get((lyrics.language, target))
    if name is None:
        logger.info(
            "paire de langues non prise en charge",
            extra={"source": lyrics.language, "target": target},
        )
        return lyrics

    tokenizer, model = _load_translator(name)
    sources = [line.text for line in lyrics.lines]

    batch = tokenizer(sources, return_tensors="pt", padding=True, truncation=True)
    generated = model.generate(**batch, max_length=512)
    translated = tokenizer.batch_decode(generated, skip_special_tokens=True)

    return lyrics.model_copy(update={"translations": {**lyrics.translations, target: translated}})
