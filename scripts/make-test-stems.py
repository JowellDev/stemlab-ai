"""Genere quatre stems de test synthetiques.

Aucun enjeu de droits : tout est synthetise. Les quatre pistes partagent la meme
grille rythmique (120 BPM, 4/4, 6 mesures), ce qui rend une desynchronisation
immediatement audible — le kick et la basse tombent exactement ensemble.

    uv run --project apps/ml python scripts/make-test-stems.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLE_RATE = 44_100
BPM = 120.0
BEATS = 24  # 6 mesures en 4/4
BEAT = 60.0 / BPM
DURATION = BEATS * BEAT

OUT = Path("apps/web/public/dev-stems")
POINTS_PER_SECOND = 512


def envelope(length: int, attack: float, decay: float) -> np.ndarray:
    """Enveloppe percussive : attaque lineaire courte, decroissance exponentielle."""
    t = np.arange(length) / SAMPLE_RATE
    attack_samples = max(1, int(attack * SAMPLE_RATE))
    env = np.exp(-t / decay)
    env[:attack_samples] *= np.linspace(0.0, 1.0, attack_samples)
    return env


def place(track: np.ndarray, at: float, sound: np.ndarray) -> None:
    start = int(at * SAMPLE_RATE)
    end = min(start + len(sound), len(track))
    if start >= len(track):
        return
    track[start:end] += sound[: end - start]


def sine(freq: float, seconds: float) -> np.ndarray:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return np.sin(2 * np.pi * freq * t)


def make_drums() -> np.ndarray:
    track = np.zeros(int(DURATION * SAMPLE_RATE))
    rng = np.random.default_rng(7)

    for beat in range(BEATS):
        at = beat * BEAT
        if beat % 4 in (0, 2):
            # Kick : sinus descendant de 120 a 45 Hz.
            n = int(0.18 * SAMPLE_RATE)
            t = np.arange(n) / SAMPLE_RATE
            freq = 120 * np.exp(-t * 18) + 45
            place(track, at, np.sin(2 * np.pi * freq * t) * envelope(n, 0.001, 0.06) * 0.9)
        if beat % 4 in (1, 3):
            # Caisse claire : bruit filtre grossierement.
            n = int(0.12 * SAMPLE_RATE)
            place(track, at, rng.normal(0, 1, n) * envelope(n, 0.001, 0.03) * 0.45)
        # Charleston sur chaque croche.
        for half in (0.0, 0.5):
            n = int(0.04 * SAMPLE_RATE)
            place(track, at + half * BEAT, rng.normal(0, 1, n) * envelope(n, 0.0005, 0.008) * 0.2)

    return track


def make_bass() -> np.ndarray:
    track = np.zeros(int(DURATION * SAMPLE_RATE))
    # Am - F - C - G, une mesure chacun, deux fois (Am2 = 110 Hz, F2 = 87.31...).
    roots = [110.00, 87.31, 130.81, 98.00]
    for bar in range(6):
        root = roots[bar % 4]
        for beat in range(4):
            at = (bar * 4 + beat) * BEAT
            n = int(BEAT * 0.9 * SAMPLE_RATE)
            tone = sine(root, BEAT * 0.9) + 0.3 * sine(root * 2, BEAT * 0.9)
            place(track, at, tone * envelope(n, 0.005, 0.25) * 0.7)
    return track


def make_other() -> np.ndarray:
    """Nappe d'accords tenue, une mesure par accord."""
    track = np.zeros(int(DURATION * SAMPLE_RATE))
    chords = [
        [220.00, 261.63, 329.63],  # Am
        [174.61, 220.00, 261.63],  # F
        [261.63, 329.63, 392.00],  # C
        [196.00, 246.94, 293.66],  # G
    ]
    bar_seconds = 4 * BEAT
    for bar in range(6):
        chord = chords[bar % 4]
        n = int(bar_seconds * SAMPLE_RATE)
        voice = sum(sine(freq, bar_seconds) for freq in chord) / len(chord)
        # Fondu d'entree et de sortie pour eviter un clic a la jonction des mesures.
        fade = int(0.05 * SAMPLE_RATE)
        env = np.ones(n)
        env[:fade] = np.linspace(0, 1, fade)
        env[-fade:] = np.linspace(1, 0, fade)
        place(track, bar * bar_seconds, voice * env * 0.35)
    return track


def make_vocals() -> np.ndarray:
    """Melodie a la noire, avec un leger vibrato pour la distinguer a l'oreille."""
    track = np.zeros(int(DURATION * SAMPLE_RATE))
    melody = [440.00, 523.25, 493.88, 440.00, 349.23, 440.00, 392.00, 329.63]
    for beat in range(BEATS):
        freq = melody[beat % len(melody)]
        seconds = BEAT * 0.85
        n = int(seconds * SAMPLE_RATE)
        t = np.arange(n) / SAMPLE_RATE
        vibrato = np.sin(2 * np.pi * 5.5 * t) * 4.0
        tone = np.sin(2 * np.pi * (freq + vibrato) * t)
        fade = int(0.01 * SAMPLE_RATE)
        env = np.ones(n)
        env[:fade] = np.linspace(0, 1, fade)
        env[-fade:] = np.linspace(1, 0, fade)
        place(track, beat * BEAT, tone * env * 0.4)
    return track


def compute_peaks(samples: np.ndarray) -> list[float]:
    """Meme format que le pipeline : amplitude crete absolue par fenetre."""
    window = max(1, round(SAMPLE_RATE / POINTS_PER_SECOND))
    count = int(np.ceil(len(samples) / window))
    padded = np.zeros(count * window, dtype=np.float32)
    padded[: len(samples)] = samples
    peaks = np.abs(padded.reshape(count, window)).max(axis=1)
    return [round(float(min(p, 1.0)), 4) for p in peaks]


def encode(name: str, samples: np.ndarray) -> dict[str, object]:
    peak = np.max(np.abs(samples))
    if peak > 0:
        samples = samples / peak * 0.89
    wav = OUT / f"{name}.wav"
    opus = OUT / f"{name}.opus"
    sf.write(wav, samples.astype(np.float32), SAMPLE_RATE)
    subprocess.run(  # noqa: S603
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),  # noqa: S607
         "-c:a", "libopus", "-b:a", "96k", str(opus)],
        check=True,
    )
    wav.unlink()
    print(f"  {opus.name:14s} {opus.stat().st_size / 1024:6.1f} Ko")
    return {
        "type": name,
        "file": f"{name}.opus",
        "waveform": {"pointsPerSecond": POINTS_PER_SECOND, "peaks": compute_peaks(samples)},
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Generation de 4 stems — {DURATION:.1f} s, {BPM:.0f} BPM, Am-F-C-G")
    stems = [
        encode("vocals", make_vocals()),
        encode("drums", make_drums()),
        encode("bass", make_bass()),
        encode("other", make_other()),
    ]
    manifest = {
        "title": "Grille de test — Am F C G",
        "artist": "STEMLAB (synthetise)",
        "durationSeconds": round(DURATION, 3),
        "bpm": BPM,
        "key": "A",
        "mode": "minor",
        "stems": stems,
    }
    path = OUT / "manifest.json"
    path.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"  {path.name:14s} {path.stat().st_size / 1024:6.1f} Ko")
    return 0


if __name__ == "__main__":
    sys.exit(main())
