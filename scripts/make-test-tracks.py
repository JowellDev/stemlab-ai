"""Genere trois morceaux de test complets, de styles differents.

Tout est synthetise : aucun enjeu de droits, et la verite terrain (tonalite, tempo,
grille d'accords) est connue, ce qui permet de juger la sortie du pipeline autrement
qu'a l'oreille.

Les trois pieces sont ecrites dans trois formats differents, pour que l'etage de
normalisation ffmpeg soit exerce lui aussi.

    uv run --project apps/ml python scripts/make-test-tracks.py
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt
import soundfile as sf

SAMPLE_RATE = 44_100
OUT = Path("fixtures/tracks")

Signal = npt.NDArray[np.float32]

# Demi-tons au-dessus de do3 (130,81 Hz) -> frequence.
C3 = 130.81


def note(semitones: float, octave_shift: int = 0) -> float:
    return float(C3 * 2 ** ((semitones + 12 * octave_shift) / 12))


def silence(seconds: float) -> Signal:
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


def place(track: Signal, at: float, sound: Signal) -> None:
    start = int(at * SAMPLE_RATE)
    if start >= track.size:
        return
    end = min(start + sound.size, track.size)
    track[start:end] += sound[: end - start]


def envelope(length: int, attack: float, decay: float) -> Signal:
    t = np.arange(length) / SAMPLE_RATE
    env = np.exp(-t / decay)
    attack_samples = max(1, int(attack * SAMPLE_RATE))
    env[:attack_samples] *= np.linspace(0.0, 1.0, attack_samples)
    return env.astype(np.float32)


def tone(freq: float, seconds: float, harmonics: tuple[float, ...] = (1.0,)) -> Signal:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    out = np.zeros(t.size, dtype=np.float32)
    for index, level in enumerate(harmonics, start=1):
        out += (level * np.sin(2 * np.pi * freq * index * t)).astype(np.float32)
    return out


def kick(seconds: float = 0.2) -> Signal:
    n = int(seconds * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    sweep = 130 * np.exp(-t * 20) + 45
    return (np.sin(2 * np.pi * sweep * t) * envelope(n, 0.001, 0.07)).astype(np.float32)


def snare(rng: np.random.Generator, seconds: float = 0.15) -> Signal:
    n = int(seconds * SAMPLE_RATE)
    noise = rng.normal(0, 1, n).astype(np.float32)
    body = tone(190, seconds) * 0.5
    return ((noise * 0.7 + body) * envelope(n, 0.001, 0.035)).astype(np.float32)


def hat(rng: np.random.Generator, seconds: float = 0.05, level: float = 1.0) -> Signal:
    n = int(seconds * SAMPLE_RATE)
    return (rng.normal(0, 1, n).astype(np.float32) * envelope(n, 0.0005, 0.01) * level).astype(
        np.float32
    )


@dataclass(frozen=True, slots=True)
class Track:
    name: str
    suffix: str
    bpm: float
    key: str
    mode: str
    progression: tuple[str, ...]
    bars: int


#: Degres (en demi-tons depuis do) et qualite, par nom d'accord utilise ci-dessous.
CHORDS: dict[str, tuple[int, tuple[int, ...]]] = {
    "Am": (9, (0, 3, 7)),
    "F": (5, (0, 4, 7)),
    "C": (0, (0, 4, 7)),
    "G": (7, (0, 4, 7)),
    "F#m": (6, (0, 3, 7)),
    "D": (2, (0, 4, 7)),
    "A": (9, (0, 4, 7)),
    "E": (4, (0, 4, 7)),
    "Bm": (11, (0, 3, 7)),
    "Dmaj7": (2, (0, 4, 7, 11)),
    "Gmaj7": (7, (0, 4, 7, 11)),
    "A7": (9, (0, 4, 7, 10)),
}


def chord_voicing(name: str, octave: int = 1) -> list[float]:
    root, intervals = CHORDS[name]
    return [note(root + interval, octave) for interval in intervals]


def build_rock(spec: Track) -> Signal:
    """Batterie franche, basse a la noire, accords en croches, melodie a la blanche."""
    beat = 60.0 / spec.bpm
    total = spec.bars * 4 * beat
    track = silence(total)
    rng = np.random.default_rng(11)

    for bar in range(spec.bars):
        chord = spec.progression[bar % len(spec.progression)]
        root, _ = CHORDS[chord]
        voicing = chord_voicing(chord, octave=1)
        bar_start = bar * 4 * beat

        for step in range(4):
            at = bar_start + step * beat
            if step in (0, 2):
                place(track, at, kick() * 0.95)
            else:
                place(track, at, snare(rng) * 0.5)
            for eighth in (0.0, 0.5):
                place(track, at + eighth * beat, hat(rng, level=0.22))

            # Basse : fondamentale a la noire, une quinte sur le dernier temps.
            bass_note = note(root, 0) / 2 if step < 3 else note(root + 7, 0) / 2
            place(
                track,
                at,
                tone(bass_note, beat * 0.9, (1.0, 0.35, 0.1))
                * envelope(int(beat * 0.9 * SAMPLE_RATE), 0.005, 0.22)
                * 0.55,
            )

            # Guitare rythmique : accord en croches.
            for eighth in (0.0, 0.5):
                length = beat * 0.45
                n = int(length * SAMPLE_RATE)
                strum = sum(tone(freq, length, (1.0, 0.5, 0.25, 0.12)) for freq in voicing)
                place(
                    track, at + eighth * beat, strum / len(voicing) * envelope(n, 0.004, 0.12) * 0.3
                )

        # Melodie : une blanche par demi-mesure, sur les notes de l'accord.
        for half in (0, 1):
            freq = note(root + (0 if half == 0 else 7), 2)
            length = beat * 1.8
            n = int(length * SAMPLE_RATE)
            place(
                track,
                bar_start + half * 2 * beat,
                tone(freq, length, (1.0, 0.2)) * envelope(n, 0.02, 0.6) * 0.3,
            )

    return track


def build_electro(spec: Track) -> Signal:
    """Quatre-a-la-noire, arpege de croches, nappe tenue."""
    beat = 60.0 / spec.bpm
    total = spec.bars * 4 * beat
    track = silence(total)
    rng = np.random.default_rng(23)

    for bar in range(spec.bars):
        chord = spec.progression[bar % len(spec.progression)]
        root, intervals = CHORDS[chord]
        bar_start = bar * 4 * beat

        for step in range(4):
            at = bar_start + step * beat
            place(track, at, kick(0.25) * 1.0)
            place(track, at + beat * 0.5, hat(rng, 0.06, level=0.3))
            # Basse synthetique tenue sous chaque temps.
            n = int(beat * 0.85 * SAMPLE_RATE)
            place(
                track,
                at,
                tone(note(root, -1), beat * 0.85, (1.0, 0.5, 0.25))
                * envelope(n, 0.003, 0.18)
                * 0.6,
            )

        # Arpege de doubles-croches sur les notes de l'accord.
        for step in range(16):
            interval = intervals[step % len(intervals)]
            octave = 2 + (step // len(intervals)) % 2
            length = beat * 0.22
            n = int(length * SAMPLE_RATE)
            place(
                track,
                bar_start + step * beat / 4,
                tone(note(root + interval, octave), length, (1.0, 0.3))
                * envelope(n, 0.002, 0.07)
                * 0.28,
            )

        # Nappe tenue sur toute la mesure.
        length = 4 * beat
        n = int(length * SAMPLE_RATE)
        fade = int(0.08 * SAMPLE_RATE)
        env = np.ones(n, dtype=np.float32)
        env[:fade] = np.linspace(0, 1, fade)
        env[-fade:] = np.linspace(1, 0, fade)
        pad = sum(tone(freq, length, (1.0, 0.4, 0.15)) for freq in chord_voicing(chord, 1))
        place(track, bar_start, pad / 3 * env * 0.22)

    return track


def build_ballad(spec: Track) -> Signal:
    """Tempo lent, piano en arpeges, balais, contrebasse, melodie chantante."""
    beat = 60.0 / spec.bpm
    total = spec.bars * 4 * beat
    track = silence(total)
    rng = np.random.default_rng(37)

    for bar in range(spec.bars):
        chord = spec.progression[bar % len(spec.progression)]
        root, intervals = CHORDS[chord]
        bar_start = bar * 4 * beat

        for step in range(4):
            at = bar_start + step * beat
            if step == 0:
                place(track, at, kick(0.25) * 0.45)
            if step == 2:
                place(track, at, snare(rng, 0.2) * 0.22)
            # Balais : souffle continu, discret.
            place(track, at, hat(rng, 0.25, level=0.08))
            # Contrebasse : fondamentale et quinte en alternance.
            bass = note(root if step % 2 == 0 else root + 7, -1)
            n = int(beat * 0.85 * SAMPLE_RATE)
            place(
                track, at, tone(bass, beat * 0.85, (1.0, 0.45, 0.2)) * envelope(n, 0.01, 0.45) * 0.5
            )

        # Piano : arpege de croches sur les notes de l'accord.
        for step in range(8):
            interval = intervals[step % len(intervals)]
            length = beat * 0.7
            n = int(length * SAMPLE_RATE)
            place(
                track,
                bar_start + step * beat / 2,
                tone(
                    note(root + interval, 1 + step // len(intervals)), length, (1.0, 0.45, 0.2, 0.1)
                )
                * envelope(n, 0.006, 0.4)
                * 0.3,
            )

        # Melodie : une note tenue par mesure, avec vibrato.
        length = beat * 3.2
        n = int(length * SAMPLE_RATE)
        t = np.arange(n) / SAMPLE_RATE
        freq = note(root + intervals[1 % len(intervals)], 2)
        vibrato = np.sin(2 * np.pi * 5.0 * t) * 3.0
        voice = np.sin(2 * np.pi * (freq + vibrato) * t).astype(np.float32)
        fade = int(0.05 * SAMPLE_RATE)
        env = np.ones(n, dtype=np.float32)
        env[:fade] = np.linspace(0, 1, fade)
        env[-fade:] = np.linspace(1, 0, fade)
        place(track, bar_start + beat * 0.5, voice * env * 0.3)

    return track


TRACKS: list[tuple[Track, object]] = [
    (
        Track("rock", ".wav", 120.0, "A", "minor", ("Am", "F", "C", "G"), bars=8),
        build_rock,
    ),
    (
        Track("electro", ".mp3", 128.0, "F#", "minor", ("F#m", "D", "A", "E"), bars=8),
        build_electro,
    ),
    (
        Track("ballade", ".flac", 76.0, "D", "major", ("Dmaj7", "Bm", "Gmaj7", "A7"), bars=6),
        build_ballad,
    ),
]


def write(spec: Track, mono: Signal) -> Path:
    peak = float(np.max(np.abs(mono))) or 1.0
    normalized = (mono / peak * 0.89).astype(np.float32)
    # Stereo tres legerement elargi : Demucs est entraine sur du stereo.
    stereo = np.stack([normalized, np.roll(normalized, 12) * 0.97])

    destination = OUT / f"{spec.name}{spec.suffix}"
    destination.parent.mkdir(parents=True, exist_ok=True)

    if spec.suffix == ".mp3":
        temporary = OUT / f"{spec.name}.tmp.wav"
        sf.write(temporary, stereo.T, SAMPLE_RATE)
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(temporary),
                "-c:a",
                "libmp3lame",
                "-b:a",
                "192k",
                str(destination),
            ],
            check=True,
        )
        temporary.unlink()
    else:
        sf.write(destination, stereo.T, SAMPLE_RATE)

    return destination


def main() -> int:
    for spec, builder in TRACKS:
        mono = builder(spec)  # type: ignore[operator]
        path = write(spec, mono)
        seconds = mono.size / SAMPLE_RATE
        print(
            f"{path.name:16s} {seconds:5.1f} s  {spec.bpm:5.1f} BPM  "
            f"{spec.key} {spec.mode:5s}  {' '.join(spec.progression)}  "
            f"{path.stat().st_size / 1024:7.1f} Ko"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
