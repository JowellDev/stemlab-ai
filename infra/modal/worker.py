"""Worker GPU sur Modal.

Le GPU ne tourne que pendant un traitement : Modal demarre un conteneur a
l'arrivee d'un job et l'eteint ensuite. Aucune instance GPU n'est allumee a vide,
ce qui est la contrainte de cout posee des le depart — une L4 laissee allumee
couterait plus cher que tout le reste de l'infrastructure reunie.

Les modeles sont ranges dans un volume persistant. Sans lui, chaque demarrage a
froid retelechargerait Demucs et Whisper, soit plusieurs gigaoctets et une bonne
minute avant le premier echantillon traite.
"""

from __future__ import annotations

import os
from pathlib import Path

import modal

APP_NAME = "stemlab-worker"

#: Une L4 : 24 Go de memoire video, suffisants pour Demucs et Whisper large-v3,
#: et nettement moins chere qu'une A10G pour ce profil de charge.
GPU = "L4"

#: Dix minutes. Un morceau de dix minutes traite en deux minutes sur GPU laisse
#: une marge confortable ; au-dela, quelque chose est bloque et il vaut mieux
#: rendre la main que de payer une heure de GPU.
TIMEOUT_SECONDS = 600

#: Le conteneur s'eteint apres une minute sans travail. Assez pour enchainer une
#: file de morceaux sans redemarrer, trop court pour couter a vide.
SCALEDOWN_WINDOW = 60

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install("uv")
    # Les dependances viennent du verrou du depot : le worker GPU doit executer
    # exactement le meme pipeline que celui verifie en integration continue.
    .add_local_file("apps/ml/pyproject.toml", "/app/pyproject.toml", copy=True)
    .add_local_file("apps/ml/uv.lock", "/app/uv.lock", copy=True)
    .run_commands(
        "cd /app && uv sync --frozen --no-install-project",
        # La variante CUDA de torch remplace celle du verrou, qui cible le CPU.
        "cd /app && uv pip install --reinstall torch torchaudio",
    )
    .add_local_dir("apps/ml/src", "/app/src", copy=True)
    .env({"PYTHONPATH": "/app/src", "TORCH_DEVICE": "cuda"})
)

models = modal.Volume.from_name("stemlab-models", create_if_missing=True)

app = modal.App(APP_NAME, image=image)


@app.function(
    gpu=GPU,
    timeout=TIMEOUT_SECONDS,
    scaledown_window=SCALEDOWN_WINDOW,
    volumes={"/models": models},
    secrets=[modal.Secret.from_name("stemlab")],
    # Jamais d'instance allumee a vide : c'est la contrainte de cout.
    min_containers=0,
    max_containers=4,
)
def process_track(payload: dict) -> dict:
    """Execute le pipeline complet et rend le meme resultat que le worker local.

    Le webhook est signe et poste par ce meme code : Modal n'a pas de file ARQ,
    mais la frontiere avec le BFF reste identique — meme signature, meme corps.
    """
    # Les caches de modeles pointent vers le volume : voir le commentaire du module.
    os.environ.setdefault("TORCH_HOME", "/models/torch")
    os.environ.setdefault("HF_HOME", "/models/huggingface")
    os.environ.setdefault("XDG_CACHE_HOME", "/models/cache")

    from ml.pipeline.runner import PipelineOptions, run_pipeline

    source = Path(payload["sourcePath"])
    output = Path(payload.get("outputDir", "/tmp/stemlab-out"))
    output.mkdir(parents=True, exist_ok=True)

    options = PipelineOptions(
        model=payload.get("model", "htdemucs"),
        device="cuda",
        whisper_model=os.environ.get("WHISPER_MODEL", "large-v3"),
    )

    result = run_pipeline(source, output, options)

    # Le volume n'est commit qu'une fois : les modeles telecharges pendant ce
    # traitement servent aux suivants, y compris sur un autre conteneur.
    models.commit()

    return result.model_dump(by_alias=True)


@app.local_entrypoint()
def main(source: str) -> None:
    """Essai manuel : `modal run infra/modal/worker.py --source chemin.mp3`."""
    print(process_track.remote({"sourcePath": source}))
