#!/usr/bin/env python3
"""faster-whisper transcription with word timestamps + per-second RMS energy."""

from __future__ import annotations

import argparse
import json
import sys
import wave
from pathlib import Path

import numpy as np


def compute_energy(wav_path: str) -> dict:
    with wave.open(wav_path, "rb") as wf:
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    if sampwidth == 2:
        data = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    else:
        data = np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0

    if n_channels > 1:
        data = data.reshape(-1, n_channels).mean(axis=1)

    data /= 32768.0
    hop = framerate  # 1 second
    rms = []
    for i in range(0, len(data), hop):
        chunk = data[i : i + hop]
        if len(chunk) == 0:
            break
        rms.append(float(np.sqrt(np.mean(chunk**2))))
    return {"hop": 1, "rms": rms}


def _patch_av_open() -> None:
    """PyAV 19 dropped metadata_errors=; faster-whisper 1.x still passes it."""
    import av

    original = av.open

    def open_compat(file, mode="r", **kwargs):  # noqa: ANN001
        kwargs.pop("metadata_errors", None)
        return original(file, mode=mode, **kwargs)

    av.open = open_compat  # type: ignore[assignment]


def _words_from_segment(seg) -> list[dict]:
    words = []
    if seg.words:
        for w in seg.words:
            token = (w.word or "").strip()
            if not token:
                continue
            words.append(
                {
                    "w": token,
                    "start": float(w.start),
                    "end": float(w.end),
                    "p": float(getattr(w, "probability", 0.0) or 0.0),
                }
            )
        return words

    # Fallback when word_timestamps failed or returned nothing.
    text = (seg.text or "").strip()
    if not text:
        return []
    tokens = text.split()
    if not tokens:
        return []
    start = float(seg.start)
    end = float(seg.end)
    dur = max(0.01, end - start)
    step = dur / len(tokens)
    for i, token in enumerate(tokens):
        words.append(
            {
                "w": token,
                "start": start + i * step,
                "end": start + (i + 1) * step,
                "p": 0.0,
            }
        )
    return words


def _run_transcribe(model, audio: str, *, vad_filter: bool, word_timestamps: bool):
    # CPU-friendly defaults: greedy decode + no cross-segment conditioning.
    # beam_size=5 was ~3–5× slower on long videos with no quality win for shorts.
    segments_iter, info = model.transcribe(
        audio,
        word_timestamps=word_timestamps,
        vad_filter=vad_filter,
        beam_size=1,
        best_of=1,
        temperature=0.0,
        condition_on_previous_text=False,
        vad_parameters=dict(min_silence_duration_ms=500),
    )
    segments = []
    duration = float(getattr(info, "duration", 0.0) or 0.0)
    for seg in segments_iter:
        words = _words_from_segment(seg)
        segments.append(
            {
                "start": float(seg.start),
                "end": float(seg.end),
                "text": (seg.text or "").strip(),
                "words": words,
            }
        )
        progress = min(0.99, float(seg.end) / duration) if duration else 0.0
        print(json.dumps({"progress": progress}), flush=True)
    return segments, info, duration


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="base")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute", default="int8")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    _patch_av_open()
    from faster_whisper import WhisperModel
    import os

    # Use physical cores; leaving default (4) under-utilizes i5-class CPUs.
    cpu_threads = max(1, (os.cpu_count() or 4) - 1)
    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute,
        cpu_threads=cpu_threads,
        num_workers=1,
    )

    # Prefer VAD; if it yields nothing, retry without (quiet / music-bed speech).
    try:
        segments, info, duration = _run_transcribe(
            model, args.audio, vad_filter=True, word_timestamps=True
        )
    except Exception:
        segments, info, duration = _run_transcribe(
            model, args.audio, vad_filter=True, word_timestamps=False
        )

    word_count = sum(len(s.get("words") or []) for s in segments)
    if word_count == 0:
        try:
            segments, info, duration = _run_transcribe(
                model, args.audio, vad_filter=False, word_timestamps=True
            )
        except Exception:
            segments, info, duration = _run_transcribe(
                model, args.audio, vad_filter=False, word_timestamps=False
            )

    energy = compute_energy(args.audio)
    out = {
        "language": getattr(info, "language", None),
        "duration": duration,
        "segments": segments,
        "energy": energy,
    }
    Path(args.out).write_text(json.dumps(out), encoding="utf-8")
    print(json.dumps({"progress": 1.0}), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
