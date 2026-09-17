"""Separation de sources avec Demucs v4.

Demucs est importe paresseusement pour la meme raison qu'Essentia : charger torch
coute plusieurs secondes, et le service HTTP doit pouvoir repondre a `/health` sans
l'avoir fait.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
import numpy.typing as npt

ModelName = Literal["htdemucs", "htdemucs_6s"]

#: Ordre des sources rendu par chaque modele, tel que Demucs l'expose.
MODEL_SOURCES: dict[ModelName, tuple[str, ...]] = {
    "htdemucs": ("drums", "bass", "other", "vocals"),
    "htdemucs_6s": ("drums", "bass", "other", "vocals", "guitar", "piano"),
}

ProgressCallback = Callable[[float], None]


@dataclass(frozen=True, slots=True)
class SeparationResult:
    """Stems separes, indexes par nom de source, canaux en premier axe."""

    stems: dict[str, npt.NDArray[np.float32]]
    sample_rate: int
    model: ModelName


def load_model(name: ModelName, device: str = "cpu") -> Any:
    from demucs.pretrained import get_model

    model = get_model(name)
    model.to(device)
    model.eval()
    return model


def separate(
    samples: npt.NDArray[np.float32],
    sample_rate: int,
    model_name: ModelName = "htdemucs",
    device: str = "cpu",
    *,
    model: Any | None = None,
    on_progress: ProgressCallback | None = None,
) -> SeparationResult:
    """Separe un signal stereo en stems.

    `samples` doit etre en (canaux, echantillons) et a la frequence attendue par le
    modele — 44,1 kHz pour toute la famille htdemucs. Le modele peut etre injecte
    pour eviter de le recharger entre deux jobs.
    """
    import torch
    from demucs.apply import apply_model

    if model_name not in MODEL_SOURCES:
        raise ValueError(f"modele inconnu : {model_name}")

    loaded = model if model is not None else load_model(model_name, device)
    if sample_rate != loaded.samplerate:
        raise ValueError(
            f"{model_name} attend {loaded.samplerate} Hz, signal recu a {sample_rate} Hz"
        )

    waveform = torch.from_numpy(np.ascontiguousarray(samples, dtype=np.float32))
    if waveform.ndim == 1:
        waveform = waveform.unsqueeze(0)
    if waveform.shape[0] == 1:
        # htdemucs est entraine en stereo : un mono est duplique plutot que refuse.
        waveform = waveform.repeat(2, 1)

    # Demucs attend un signal centre et reduit ; la normalisation est annulee apres.
    reference = waveform.mean(dim=0)
    mean = float(reference.mean())
    std = float(reference.std()) or 1.0
    normalized = (waveform - mean) / std

    on_progress and on_progress(0.05)
    with torch.no_grad():
        separated = apply_model(
            loaded,
            normalized.unsqueeze(0),
            device=device,
            shifts=0,
            split=True,
            overlap=0.25,
            progress=False,
        )[0]
    on_progress and on_progress(0.95)

    restored = separated * std + mean
    stems = {
        name: restored[index].cpu().numpy().astype(np.float32)
        for index, name in enumerate(loaded.sources)
    }

    on_progress and on_progress(1.0)
    return SeparationResult(stems=stems, sample_rate=int(loaded.samplerate), model=model_name)
