#!/usr/bin/env python3
"""Build the 3-minute Parallax demo video: deck slides + a live Mission Control time-lapse + narration.

Narration comes from, in order of preference:
  1. --voice-dir DIR containing 01.m4a … 10.m4a (or .wav/.mp3/.aiff) — your own recording per segment
  2. --voice-file FILE — one continuous take following deck/NARRATION.md timestamps (muxed as-is)
  3. macOS text-to-speech (`say`) as a placeholder track

Usage:
  python scripts/make_video.py --frames /path/to/frames --out deck/Parallax-demo.mp4
  python scripts/make_video.py --frames … --voice-dir deck/voice --out deck/Parallax-demo.mp4
Requires ffmpeg (brew install ffmpeg). Frames are optional: without them the demo segment uses the static screenshot.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BG = "0x07090f"
W, H = 1920, 1080

# (id, slot_seconds, visual, narration) — visual is a slide number, "demo", or a screenshot path
SEGMENTS = [
    (1, 20, 1, "Every analytics team has the same bottleneck: one analyst, one query, one hypothesis at a time. "
              "Parallax removes it. Give it a dataset and a question; it forks the database once per hypothesis, "
              "runs a swarm of agents across the branches at the same time, writes one cited answer, and remembers "
              "what it learned for next time."),
    (2, 15, 2, "Why are customers churning and where is revenue at risk? That is really eight questions: by plan, by "
              "region, by what people wrote, by how long they went quiet. One analyst runs them serially, a day of "
              "work. Eight agents on one shared database trip over each other. And whatever they learn never persists."),
    (3, 20, 3, "So we fork the database per hypothesis. One root database per run; the planner, primed by memory, "
              "proposes N hypotheses; the root is forked once per hypothesis. N agents explore concurrently, each "
              "with its own snapshot, its own indexes, its own scratch tables and notes. A synthesizer writes one "
              "report where every claim cites its branch. Then Cognee remembers it, and the next plan starts from there."),
    (4, 40, "demo", "Here it is live. Six thousand SaaS accounts, the churn question, six agents. Launch. The root "
              "database is created; before planning, Parallax asks Cognee what it already knows. The plan lands: one "
              "card per hypothesis, a mix of SQL, keyword and vector strategies. The lineage tree fans out on the "
              "left, one node per real fork. Cards fill with SQL: think, query, observe, then a finding with a "
              "confidence score. The report on the right cites every claim with a branch chip; click one and the "
              "tree lights up."),
    (5, 10, 5, "Under the hood: a Next.js Mission Control on a server-sent event stream, a FastAPI orchestrator, and "
              "three protocols, data engine, LLM router, memory, each with a cloud implementation and a zero-key "
              "local one."),
    (6, 20, 6, "Hotdata is the data plane, and forking is the whole trick. One root per run, one fork per hypothesis, "
              "BM25 and vector indexes per branch, lineage straight from the API. Then burst mode: a hundred "
              "concurrent reads spread across five forks. p50 fifteen milliseconds, p95 thirty, fifty in flight. "
              "Isolation means no branch ever waits on another."),
    (7, 15, 7, "Reasoning runs through RocketRide. Every planner, agent and synthesizer call goes through the "
              "parallax LLM pipe. And the parallax analyst pipe is the deployable analyst: a RocketRide agent "
              "controlling Claude, a Hotdata tool and a Cognee tool. Point it at api dot rocketride dot ai and it "
              "runs on Cloud. Nothing to host."),
    (8, 15, 8, "Cognee makes runs compound: findings go into the graph after each run, node sets per dataset, and a "
              "graph-completion search primes the next plan. The second run on a dataset starts smarter. Snyk scans "
              "every push and pull request, on top of a read-only SQL guard."),
    (9, 10, 9, "Measured, not claimed, all from real runs today: a hundred-read burst at p50 fifteen, p95 thirty; "
              "first finding in 1.2 seconds; sixty-five tests pass; and the identical code runs offline with zero keys."),
    (10, 15, 10, "Three commands: clone, make setup, make demo, no keys. Add keys and the same code runs on Hotdata, "
               "RocketRide Cloud and Cognee. github dot com slash vnmoorthy slash parallax. Thank you RocketRide, "
               "Hotdata, Cognee, Snyk and Devnovate. Parallax: many agents, many branches, one answer."),
]

VF_FIT = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={BG},format=yuv420p"


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def duration(path: Path) -> float:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]).stdout
    return float(out.strip() or 0)


def _spoken(text: str) -> str:
    """Natural pacing for `say`: short pauses after sentences and clauses, readable tokens for code-ish words."""
    import re

    t = text.replace("p50", "p fifty").replace("p95", "p ninety-five").replace("BM25", "B M twenty-five")
    t = t.replace("SQL", "sequel").replace("N hypotheses", "N hypotheses").replace("1.2 seconds", "one point two seconds")
    t = re.sub(r"([.!?])\s+", r"\1 [[slnc 260]] ", t)
    t = re.sub(r"([;:])\s+", r"\1 [[slnc 140]] ", t)
    return t


def tts(text: str, out: Path, voice: str, rate: int) -> None:
    aiff = out.with_suffix(".aiff")
    run(["say", "-v", voice, "-r", str(rate), "-o", str(aiff), _spoken(text)])
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff), "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "160k", str(out)])
    aiff.unlink(missing_ok=True)


def to_aac(src: Path, out: Path) -> None:
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "160k", str(out)])


def silence(seconds: float, out: Path) -> None:
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", f"{seconds:.3f}",
         "-c:a", "aac", "-b:a", "96k", str(out)])


def pad_audio(src: Path, target: float, out: Path) -> None:
    """Pad with trailing silence to exactly `target` seconds."""
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-af", f"apad=whole_dur={target:.3f}", "-t", f"{target:.3f}",
         "-c:a", "aac", "-b:a", "160k", str(out)])


def still_clip(image: Path, seconds: float, out: Path) -> None:
    # gentle push-in so slides do not feel frozen
    zoom = "zoompan=z='min(zoom+0.0004,1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=%dx%d:fps=30" % (W, H)
    run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-i", str(image), "-t", f"{seconds:.3f}",
         "-vf", f"{VF_FIT},{zoom}", "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", str(out)])


def frames_clip(frames: list[Path], seconds: float, out: Path, tmp: Path) -> None:
    """Time-lapse: spread the captured frames evenly over `seconds`."""
    lst = tmp / "frames.txt"
    per = seconds / max(1, len(frames))
    with lst.open("w") as f:
        for p in frames:
            f.write(f"file '{p.as_posix()}'\nduration {per:.4f}\n")
        f.write(f"file '{frames[-1].as_posix()}'\n")
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-vf", f"{VF_FIT},fps=30",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", "-t", f"{seconds:.3f}", str(out)])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", help="directory of PNG frames captured from a live run (sorted by name)")
    ap.add_argument("--voice-dir", help="directory with 01..10 audio files (m4a/wav/mp3/aiff)")
    ap.add_argument("--voice-file", help="one continuous narration take; muxed over the whole video")
    ap.add_argument("--voice", default="Samantha", help="macOS `say` voice for the placeholder track")
    ap.add_argument("--rate", type=int, default=172, help="`say` words per minute")
    ap.add_argument("--out", default=str(ROOT / "deck" / "Parallax-demo.mp4"))
    ap.add_argument("--thumbs", default=str(ROOT / "deck" / "thumbnails"))
    ap.add_argument("--fallback-shot", default=str(ROOT / "docs" / "assets" / "screenshots" / "mission-control.png"))
    a = ap.parse_args()

    if not shutil.which("ffmpeg"):
        print("ffmpeg not found (brew install ffmpeg)", file=sys.stderr)
        return 2
    thumbs = Path(a.thumbs)
    frames: list[Path] = []
    if a.frames:
        frames = sorted(Path(a.frames).glob("*.png")) or sorted(Path(a.frames).glob("*.jpg"))
        frames = [p for p in frames if p.stat().st_size > 20_000]  # skip blank captures
    voice_dir = Path(a.voice_dir) if a.voice_dir else None

    with tempfile.TemporaryDirectory(prefix="parallax-video-") as td:
        tmp = Path(td)
        parts: list[Path] = []
        timeline = []
        t = 0.0
        for seg_id, slot, visual, text in SEGMENTS:
            audio = tmp / f"a{seg_id:02d}.m4a"
            if voice_dir is not None:
                cand = [p for ext in ("m4a", "wav", "mp3", "aiff", "aif") for p in voice_dir.glob(f"{seg_id:02d}*.{ext}")]
                if cand:
                    to_aac(cand[0], audio)
                else:
                    print(f"voice file for segment {seg_id:02d} missing in {voice_dir}; using TTS")
                    tts(text, audio, a.voice, a.rate)
            elif a.voice_file:
                silence(slot, audio)  # placeholder; the continuous take is muxed at the end
            else:
                tts(text, audio, a.voice, a.rate)
            adur = duration(audio)
            seg_len = max(float(slot), adur + 0.6) if not a.voice_file else float(slot)
            padded = tmp / f"p{seg_id:02d}.m4a"
            pad_audio(audio, seg_len, padded)

            video = tmp / f"v{seg_id:02d}.mp4"
            if visual == "demo" and frames:
                frames_clip(frames, seg_len, video, tmp)
            elif visual == "demo":
                still_clip(Path(a.fallback_shot), seg_len, video)
            elif isinstance(visual, int):
                still_clip(thumbs / f"slide-{visual:02d}.png", seg_len, video)
            else:
                still_clip(Path(visual), seg_len, video)
            merged = tmp / f"m{seg_id:02d}.mp4"
            run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-i", str(padded), "-c:v", "copy", "-c:a", "aac",
                 "-b:a", "160k", "-shortest", str(merged)])
            parts.append(merged)
            timeline.append({"segment": seg_id, "start": round(t, 2), "seconds": round(seg_len, 2)})
            t += seg_len
            print(f"segment {seg_id:02d}: {seg_len:5.1f}s  (narration {adur:4.1f}s)")

        lst = tmp / "concat.txt"
        lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts))
        out = Path(a.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        if a.voice_file:
            silent = tmp / "silent.mp4"
            run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(silent)])
            run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(silent), "-i", a.voice_file, "-map", "0:v:0", "-map", "1:a:0",
                 "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(out)])
        else:
            run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy",
                 "-movflags", "+faststart", str(out)])
        (out.with_suffix(".timeline.json")).write_text(json.dumps(timeline, indent=2))
        print(f"\nwrote {out}  ({duration(out):.1f}s, {out.stat().st_size/1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
