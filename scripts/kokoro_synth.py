#!/usr/bin/env python3
"""Kokoro synthesis backend using local ONNX weights.

This is the offline backend, selected with `--backend onnx`. It exists because
the default `kokoro-js` path fetches its weights from huggingface.co, which is
not always reachable; this one reads the same model from disk.

    KOKORO_MODEL=/path/kokoro-v1.0.onnx KOKORO_VOICES=/path/voices-v1.0.bin \
        python scripts/kokoro_synth.py .tts/job.json 4

Weights (Apache-2.0, ~325 MB + ~28 MB):
    https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0

Reads a job file written by narrate.mjs and writes, per page, a single WAV plus
a `.timing.json` giving the start and end second of every sentence.
"""
import json
import os
import sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import soundfile as sf

HOME = Path.home()
MODEL = os.environ.get("KOKORO_MODEL", str(HOME / ".cache/kokoro/kokoro-v1.0.onnx"))
VOICES = os.environ.get("KOKORO_VOICES", str(HOME / ".cache/kokoro/voices-v1.0.bin"))

# Pause after a sentence. A code-block announcement gets a longer one — it is an
# aside about the page rather than part of the argument, and the gap is what
# makes that audible.
GAP = 0.12
GAP_ASIDE = 0.30

_kokoro = None


def _engine():
    """One model per worker process, loaded lazily.

    Each worker pins ONNX Runtime to a single thread. Left at its default the
    runtime sizes its own pool from the core count, so N workers each spawn N
    threads and the machine spends more time context-switching than
    synthesising — parallelism belongs to the process pool here, not to ORT.
    """
    global _kokoro
    if _kokoro is None:
        import onnxruntime as ort
        from kokoro_onnx import Kokoro

        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        session = ort.InferenceSession(MODEL, options, providers=["CPUExecutionProvider"])
        _kokoro = Kokoro.from_session(session, VOICES)
    return _kokoro


def synth_page(args):
    voice, out_dir, page = args
    key, sentences = page["key"], page["sentences"]
    kokoro = _engine()
    lang = "en-gb" if voice[0] == "b" else "en-us"

    chunks, timing, cursor, rate = [], [], 0.0, 24000
    for sentence in sentences:
        text = sentence["speech"].strip()
        if not text:
            continue
        try:
            samples, rate = kokoro.create(text, voice=voice, speed=1.0, lang=lang)
        except Exception as exc:  # noqa: BLE001 - one bad sentence must not kill the run
            print(f"  ! {key} [{sentence['i']}]: {exc}", file=sys.stderr)
            continue

        duration = len(samples) / rate
        timing.append(
            {"i": sentence["i"], "start": round(cursor, 3), "end": round(cursor + duration, 3)}
        )
        gap = GAP_ASIDE if text.startswith("[") else GAP
        chunks.append(samples)
        chunks.append(np.zeros(int(rate * gap), dtype=samples.dtype))
        cursor += duration + gap

    if not chunks:
        return key, 0.0

    audio = np.concatenate(chunks)
    dest = Path(out_dir) / f"{key}.wav"
    dest.parent.mkdir(parents=True, exist_ok=True)
    sf.write(dest, audio, rate)
    # The hash travels with the audio so a resumed run can tell a finished page
    # from one whose text has since changed.
    (Path(out_dir) / f"{key}.timing.json").write_text(
        json.dumps(
            {
                "hash": page.get("hash"),
                "duration": round(len(audio) / rate, 3),
                "sentences": timing,
            }
        )
    )
    return key, len(audio) / rate


def main():
    job = json.loads(Path(sys.argv[1]).read_text())
    jobs = int(sys.argv[2]) if len(sys.argv) > 2 else 4

    for required, label in ((MODEL, "model"), (VOICES, "voices")):
        if not Path(required).exists():
            sys.exit(f"Missing Kokoro {label}: {required}\nSee the module docstring for the URL.")

    work = [(job["voice"], job["outDir"], page) for page in job["pages"]]
    total = 0.0
    with Pool(processes=min(jobs, len(work))) as pool:
        for n, (key, seconds) in enumerate(pool.imap_unordered(synth_page, work), 1):
            total += seconds
            print(f"  [{n}/{len(work)}] {key} — {seconds / 60:.1f} min", flush=True)
    print(f"Synthesised {total / 3600:.2f} h of audio.")


if __name__ == "__main__":
    main()
