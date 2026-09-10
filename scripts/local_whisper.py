#!/usr/bin/env python3
"""Local, free transcription with word-level timestamps via faster-whisper.

Usage: python3 scripts/local_whisper.py <audio> [--model small] [--device cpu] [--compute-type int8]
                                       [--initial-prompt TEXT]
Prints JSON: {"text","language","duration","words":[{"word","start","end"}],
              "segments":[{"start","end","text"}]} to stdout. Logs go to stderr.

Install once:  pip install faster-whisper   (models download to ~/.cache on first run)
"""
import argparse
import json
import sys


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("audio")
    p.add_argument("--model", default="small")
    p.add_argument("--device", default="cpu")
    p.add_argument("--compute-type", default="int8")
    p.add_argument("--language", default=None)
    p.add_argument("--initial-prompt", default=None)
    args = p.parse_args()

    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError:
        print("faster-whisper is not installed: pip install faster-whisper", file=sys.stderr)
        return 2

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    segments, info = model.transcribe(
        args.audio,
        word_timestamps=True,
        language=args.language,
        initial_prompt=args.initial_prompt,
        vad_filter=True,
    )

    words = []
    segs = []
    for s in segments:
        segs.append({"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip()})
        for w in s.words or []:
            words.append({"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)})

    out = {
        "text": " ".join(s["text"] for s in segs),
        "language": info.language,
        "duration": round(float(info.duration), 3),
        "words": words,
        "segments": segs,
    }
    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
