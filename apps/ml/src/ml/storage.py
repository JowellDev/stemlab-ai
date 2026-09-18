"""Acces au stockage objet (MinIO en developpement, Cloudflare R2 en production).

Le worker ne fait que lire l'original et ecrire les stems : il n'emet jamais d'URL
presignee, c'est le BFF qui s'en charge. La surface reste donc volontairement etroite.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from ml.settings import Settings

if TYPE_CHECKING:
    from types_boto3_s3.client import S3Client as Boto3S3Client
else:
    Boto3S3Client = Any

#: Type MIME par extension de fichier produit par le pipeline.
CONTENT_TYPES = {
    ".opus": "audio/ogg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".json": "application/json",
}


class StorageError(RuntimeError):
    """Une operation de stockage a echoue de facon irrecuperable."""


class ObjectNotFoundError(StorageError):
    """L'objet demande n'existe pas."""


@dataclass(frozen=True, slots=True)
class UploadedObject:
    key: str
    bytes: int
    content_type: str


class ObjectStore:
    """Enveloppe minimale autour de S3."""

    def __init__(self, settings: Settings, client: Boto3S3Client | None = None) -> None:
        self._bucket = settings.s3_bucket
        self._client: Boto3S3Client = client or boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint or None,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path" if settings.s3_force_path_style else "auto"},
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )

    @property
    def bucket(self) -> str:
        return self._bucket

    def download(self, key: str, destination: Path) -> Path:
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._client.download_file(self._bucket, key, str(destination))
        except ClientError as error:
            code = error.response.get("Error", {}).get("Code", "")
            if code in {"404", "NoSuchKey", "NotFound"}:
                raise ObjectNotFoundError(f"objet introuvable : {key}") from error
            raise StorageError(f"telechargement impossible de {key}") from error
        except BotoCoreError as error:
            raise StorageError(f"telechargement impossible de {key}") from error
        return destination

    def upload(self, source: Path, key: str) -> UploadedObject:
        content_type = CONTENT_TYPES.get(source.suffix.lower(), "application/octet-stream")
        try:
            self._client.upload_file(
                str(source),
                self._bucket,
                key,
                ExtraArgs={"ContentType": content_type},
            )
        except (ClientError, BotoCoreError) as error:
            raise StorageError(f"envoi impossible de {key}") from error
        return UploadedObject(key=key, bytes=source.stat().st_size, content_type=content_type)

    def copy(self, source_key: str, destination_key: str) -> UploadedObject:
        """Copie un objet a l'interieur du bucket, sans le faire transiter par ici.

        Utilise a la deduplication : un fichier deja traite voit ses stems recopies
        sous le prefixe du nouveau demandeur, plutot que d'etre re-separe.
        """
        if source_key == destination_key:
            return self.head(source_key)
        try:
            self._client.copy_object(
                Bucket=self._bucket,
                Key=destination_key,
                CopySource={"Bucket": self._bucket, "Key": source_key},
            )
        except ClientError as error:
            code = error.response.get("Error", {}).get("Code", "")
            if code in {"404", "NoSuchKey", "NotFound"}:
                raise ObjectNotFoundError(f"objet introuvable : {source_key}") from error
            raise StorageError(f"copie impossible de {source_key}") from error
        except BotoCoreError as error:
            raise StorageError(f"copie impossible de {source_key}") from error
        return self.head(destination_key)

    def head(self, key: str) -> UploadedObject:
        """Metadonnees d'un objet existant."""
        try:
            response = self._client.head_object(Bucket=self._bucket, Key=key)
        except ClientError as error:
            code = error.response.get("Error", {}).get("Code", "")
            if code in {"404", "NoSuchKey", "NotFound"}:
                raise ObjectNotFoundError(f"objet introuvable : {key}") from error
            raise StorageError(f"lecture impossible de {key}") from error
        except BotoCoreError as error:
            raise StorageError(f"lecture impossible de {key}") from error
        return UploadedObject(
            key=key,
            bytes=int(response.get("ContentLength", 0)),
            content_type=str(response.get("ContentType", "application/octet-stream")),
        )

    def exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
        except ClientError as error:
            code = error.response.get("Error", {}).get("Code", "")
            if code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise StorageError(f"verification impossible de {key}") from error
        except BotoCoreError as error:
            raise StorageError(f"verification impossible de {key}") from error
        return True

    def ensure_bucket(self) -> None:
        """Cree le bucket s'il manque. Utile en developpement uniquement."""
        try:
            self._client.head_bucket(Bucket=self._bucket)
        except ClientError:
            try:
                self._client.create_bucket(Bucket=self._bucket)
            except (ClientError, BotoCoreError) as error:
                raise StorageError(f"creation impossible du bucket {self._bucket}") from error


def join_key(*parts: str) -> str:
    """Concatene des fragments de cle S3 sans jamais produire de double slash."""
    cleaned = [part.strip("/") for part in parts if part.strip("/")]
    return "/".join(cleaned)
