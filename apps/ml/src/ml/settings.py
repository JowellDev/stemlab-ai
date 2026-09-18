"""Configuration du service, lue depuis l'environnement."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    log_level: str = Field(default="info", alias="LOG_LEVEL")

    redis_url: str = Field(default="redis://localhost:56379/0", alias="REDIS_URL")

    s3_endpoint: str = Field(default="http://localhost:59000", alias="S3_ENDPOINT")
    s3_region: str = Field(default="us-east-1", alias="S3_REGION")
    s3_bucket: str = Field(default="stemlab", alias="S3_BUCKET")
    s3_access_key_id: str = Field(default="stemlab-dev", alias="S3_ACCESS_KEY_ID")
    s3_secret_access_key: str = Field(default="stemlab-dev-secret", alias="S3_SECRET_ACCESS_KEY")
    s3_force_path_style: bool = Field(default=True, alias="S3_FORCE_PATH_STYLE")

    webhook_secret: str = Field(default="dev-only-change-me-hmac-secret", alias="ML_WEBHOOK_SECRET")
    webhook_tolerance_seconds: int = Field(default=300, alias="ML_WEBHOOK_TOLERANCE_SECONDS")

    demucs_model: Literal["htdemucs", "htdemucs_6s"] = Field(
        default="htdemucs", alias="DEMUCS_MODEL"
    )
    torch_device: Literal["cpu", "cuda"] = Field(default="cpu", alias="TORCH_DEVICE")
    stem_opus_bitrate: str = Field(default="96k", alias="STEM_OPUS_BITRATE")
    waveform_points_per_second: int = Field(default=512, alias="WAVEFORM_POINTS_PER_SECOND")

    #: Transcription des paroles. Elle allonge sensiblement le traitement : la
    #: desactiver doit rester possible sans toucher au code.
    transcribe_lyrics: bool = Field(default=True, alias="TRANSCRIBE_LYRICS")
    #: `small` suffit aux tests et a un poste sans GPU ; `large-v3` sert en production.
    whisper_model: str = Field(default="small", alias="WHISPER_MODEL")
    #: Langues cibles de la traduction, separees par des virgules.
    translate_to: str = Field(default="fr,en", alias="LYRICS_TRANSLATE_TO")

    @property
    def translation_targets(self) -> tuple[str, ...]:
        return tuple(code.strip() for code in self.translate_to.split(",") if code.strip())

    sentry_dsn: str | None = Field(default=None, alias="SENTRY_DSN_ML")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Instance unique : evite de relire l'environnement a chaque requete."""
    return Settings()
