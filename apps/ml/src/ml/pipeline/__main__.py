"""Pipeline en ligne de commande.

    uv run python -m ml.pipeline morceau.mp3 --out out/morceau

Produit les stems encodes en Opus et un `analysis.json` valide par les memes
modeles que le service.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from ml.pipeline.io_audio import FFmpegError, UnsupportedAudioError, probe_duration
from ml.pipeline.runner import PipelineOptions, run_pipeline
from ml.pipeline.waveform import DEFAULT_POINTS_PER_SECOND


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m ml.pipeline",
        description="Separe un morceau en stems et en analyse la structure musicale.",
    )
    parser.add_argument("source", type=Path, help="fichier audio d'entree")
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="dossier de sortie (par defaut : out/<nom du fichier>)",
    )
    parser.add_argument(
        "--model",
        choices=("htdemucs", "htdemucs_6s"),
        default="htdemucs",
        help="modele de separation (4 ou 6 stems)",
    )
    parser.add_argument(
        "--device", choices=("cpu", "cuda"), default="cpu", help="peripherique de calcul"
    )
    parser.add_argument("--bitrate", default="96k", help="debit Opus des stems")
    parser.add_argument(
        "--points-per-second",
        type=int,
        default=DEFAULT_POINTS_PER_SECOND,
        help="resolution des formes d'onde",
    )
    parser.add_argument("--keep-wav", action="store_true", help="conserve aussi les stems en WAV")
    parser.add_argument("--quiet", action="store_true", help="n'affiche pas la progression")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    source: Path = args.source

    if not source.is_file():
        print(f"fichier introuvable : {source}", file=sys.stderr)
        return 2

    output_dir: Path = args.out or Path("out") / source.stem

    options = PipelineOptions(
        model=args.model,
        device=args.device,
        opus_bitrate=args.bitrate,
        points_per_second=args.points_per_second,
        keep_wav=args.keep_wav,
    )

    last_stage = ""

    def report(percent: int, stage: str) -> None:
        nonlocal last_stage
        if args.quiet:
            return
        # Une ligne par etape plutot qu'une barre : la sortie est souvent un journal.
        if stage != last_stage:
            print(f"[{percent:3d}%] {stage}", file=sys.stderr)
            last_stage = stage

    started = time.monotonic()
    try:
        duration = probe_duration(source)
        result = run_pipeline(source, output_dir, options, report)
    except (FFmpegError, UnsupportedAudioError) as error:
        print(f"echec : {error}", file=sys.stderr)
        return 1
    except ValueError as error:
        print(f"entree invalide : {error}", file=sys.stderr)
        return 1

    destination = output_dir / "analysis.json"
    destination.write_text(
        json.dumps(result.model_dump(by_alias=True), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    if not args.quiet:
        elapsed = time.monotonic() - started
        ratio = elapsed / duration if duration > 0 else float("nan")
        print(
            f"\n{len(result.stems)} stems ecrits dans {output_dir}\n"
            f"  tonalite : {result.analysis.key} {result.analysis.mode}"
            f" ({result.analysis.key_confidence:.2f})\n"
            f"  tempo    : {result.analysis.bpm} BPM,"
            f" {len(result.analysis.beats)} temps\n"
            f"  accords  : {len(result.analysis.chords)} segments\n"
            f"  duree    : {duration:.1f} s d'audio en {elapsed:.1f} s"
            f" (x{ratio:.2f} temps reel, {args.device})",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
