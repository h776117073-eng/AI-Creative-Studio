#!/usr/bin/env python3
"""Resumable Arabic video dubbing through the Violin CLI.

Each source segment is committed to the local checkpoint manifest only after
Violin produces a readable MP4. GitHub Actions caches this directory after each
workflow attempt, so reruns can skip completed segments.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


def run(cmd: list[str], *, check: bool = True, timeout: int | None = None) -> subprocess.CompletedProcess:
    print("+ " + " ".join(str(x) for x in cmd), flush=True)
    return subprocess.run(cmd, check=check, timeout=timeout)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def probe(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration,size,format_name:stream=codec_type,codec_name,width,height,sample_rate,channels",
         "-of", "json", str(path)],
        check=True, capture_output=True, text=True, timeout=120,
    )
    return json.loads(result.stdout)


def valid_video(path: Path) -> bool:
    try:
        if not path.is_file() or path.stat().st_size < 1_000_000:
            return False
        info = probe(path)
        streams = info.get("streams", [])
        duration = float((info.get("format") or {}).get("duration") or 0)
        return duration > 0 and any(s.get("codec_type") == "video" for s in streams) and any(
            s.get("codec_type") == "audio" for s in streams
        )
    except Exception:
        return False


def atomic_json(path: Path, data: dict[str, Any]) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def srt_time_to_ms(value: str) -> int:
    h, m, rest = value.split(":")
    s, ms = rest.split(",")
    return (((int(h) * 60 + int(m)) * 60) + int(s)) * 1000 + int(ms)


def ms_to_srt_time(value: int) -> str:
    value = max(0, value)
    h, rem = divmod(value, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def combine_srts(srt_files: list[Path], offsets_ms: list[int], target: Path) -> None:
    blocks: list[str] = []
    index = 1
    pattern = re.compile(r"^(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})(.*)$")
    for path, offset in zip(srt_files, offsets_ms):
        if not path.is_file():
            continue
        raw = path.read_text(encoding="utf-8-sig", errors="replace").strip()
        if not raw:
            continue
        for block in re.split(r"\n\s*\n", raw):
            lines = block.splitlines()
            timing_idx = next((i for i, line in enumerate(lines) if "-->" in line), None)
            if timing_idx is None:
                continue
            match = pattern.match(lines[timing_idx].strip())
            if not match:
                continue
            start = ms_to_srt_time(srt_time_to_ms(match.group(1)) + offset)
            end = ms_to_srt_time(srt_time_to_ms(match.group(2)) + offset)
            lines = lines[timing_idx + 1:]
            if not lines:
                continue
            blocks.append(f"{index}\n{start} --> {end}{match.group(3)}\n" + "\n".join(lines))
            index += 1
    target.write_text("\n\n".join(blocks) + ("\n" if blocks else ""), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--language", default="Arabic")
    parser.add_argument("--chunk-seconds", type=int, default=600)
    parser.add_argument("--style", default="storyteller")
    args = parser.parse_args()

    source = Path(args.input).resolve()
    work_dir = Path(args.work_dir).resolve() / args.source_sha256[:16]
    output_dir = Path(args.output_dir).resolve()
    input_dir = work_dir / "inputs"
    segment_dir = work_dir / "segments"
    timing_dir = work_dir / "timings"
    manifest_path = work_dir / "manifest.json"
    final_work = work_dir / f"Arabic_Dub_{args.task_id}.mp4"
    final_output = output_dir / f"Arabic_Dub_{args.task_id}.mp4"

    if not source.is_file():
        raise SystemExit(f"Input file does not exist: {source}")
    if sha256_file(source) != args.source_sha256:
        raise SystemExit("Source SHA-256 changed between preparation and dubbing; refusing stale checkpoints.")

    for path in (input_dir, segment_dir, timing_dir, output_dir):
        path.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, Any] = {}
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            manifest = {}
    if (
        manifest.get("source_sha256") != args.source_sha256
        or manifest.get("chunk_seconds") != args.chunk_seconds
        or manifest.get("language") != args.language
        or manifest.get("style") != args.style
    ):
        shutil.rmtree(work_dir, ignore_errors=True)
        for path in (input_dir, segment_dir, timing_dir):
            path.mkdir(parents=True, exist_ok=True)
        manifest = {}

    task_meta = {
        "source_sha256": args.source_sha256,
        "chunk_seconds": args.chunk_seconds,
        "language": args.language,
        "style": args.style,
        "status": "in_progress",
        "completed_segments": [],
    }
    task_meta.update(manifest)
    task_meta["status"] = "in_progress"
    task_meta["source_sha256"] = args.source_sha256
    task_meta["chunk_seconds"] = args.chunk_seconds
    task_meta["language"] = args.language
    task_meta["style"] = args.style

    # If a prior attempt already completed the final render, reuse it and rerun
    # the outer workflow's final verification / Drive upload rather than rebilling.
    if valid_video(final_work):
        output_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(final_work, final_output)
        final_hash = sha256_file(final_output)
        task_meta.update({"status": "rendered", "final_sha256": final_hash,
                          "final_file": str(final_output), "task_id": args.task_id})
        atomic_json(manifest_path, task_meta)
        print(f"FINAL_FILE={final_output}")
        print(f"FINAL_SHA256={final_hash}")
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.write(f"final_sha256={final_hash}\n")
        return 0

    inputs_marker = input_dir / "segments.complete.json"
    existing_inputs = sorted(input_dir.glob("part_*.mkv"))
    marker_ok = False
    if inputs_marker.is_file():
        try:
            marker = json.loads(inputs_marker.read_text(encoding="utf-8"))
            marker_ok = (
                marker.get("source_sha256") == args.source_sha256
                and marker.get("chunk_seconds") == args.chunk_seconds
                and marker.get("count") == len(existing_inputs)
                and bool(existing_inputs)
                and all(valid_video(p) for p in existing_inputs)
            )
        except Exception:
            marker_ok = False
    if not marker_ok:
        # Do not trust a partial segment set left by a hard cancellation.
        shutil.rmtree(input_dir, ignore_errors=True)
        input_dir.mkdir(parents=True, exist_ok=True)
        run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(source), "-map", "0:v:0", "-map", "0:a:0",
            "-c", "copy", "-f", "segment", "-segment_time", str(args.chunk_seconds),
            "-reset_timestamps", "1", "-segment_format", "matroska",
            "-segment_start_number", "0", str(input_dir / "part_%03d.mkv"),
        ], timeout=3600)
        existing_inputs = sorted(input_dir.glob("part_*.mkv"))
        if not existing_inputs or not all(valid_video(p) for p in existing_inputs):
            raise SystemExit("FFmpeg did not create a complete, readable set of input segments.")
        atomic_json(inputs_marker, {
            "source_sha256": args.source_sha256,
            "chunk_seconds": args.chunk_seconds,
            "count": len(existing_inputs),
            "files": [p.name for p in existing_inputs],
        })
    if not existing_inputs:
        raise SystemExit("FFmpeg did not create any input segments.")
    if not any(s.get("codec_type") == "audio" for s in probe(existing_inputs[0]).get("streams", [])):
        raise SystemExit("The first segmented input has no audio stream.")

    completed = set(task_meta.get("completed_segments", []))
    segment_durations: list[float] = []
    segment_files: list[Path] = []
    srt_files: list[Path] = []
    for index, part in enumerate(existing_inputs):
        stem = f"part_{index:03d}"
        output_part = segment_dir / f"{stem}.mp4"
        srt_part = segment_dir / f"{stem}.srt"
        timing_path = timing_dir / f"{stem}.json"

        # A prior successful segment is trusted only after media validation.
        if stem in completed and valid_video(output_part):
            pass
        elif valid_video(output_part):
            completed.add(stem)
        else:
            output_part.unlink(missing_ok=True)
            srt_part.unlink(missing_ok=True)
            timing_path.unlink(missing_ok=True)
            env = os.environ.copy()
            if not env.get("TOGETHER_API_KEY", "").strip():
                raise SystemExit("Missing TOGETHER_API_KEY. Add a valid Together AI API key as repository secret TOGETHER_API_KEY or VIOLIN_API_KEY.")
            run([
                "violin", str(part), str(output_part),
                "--language", args.language,
                "--style", args.style,
                "--timings-out", str(timing_path),
            ], timeout=1200)
            if not valid_video(output_part):
                raise SystemExit(f"Violin returned success but output validation failed for {stem}.")
            completed.add(stem)
            task_meta["completed_segments"] = sorted(completed)
            task_meta["segment_count"] = len(existing_inputs)
            task_meta["last_completed_segment"] = stem
            atomic_json(manifest_path, task_meta)
            print(f"CHECKPOINT: completed {stem} ({len(completed)}/{len(existing_inputs)})", flush=True)

        info = probe(output_part)
        duration = float((info.get("format") or {}).get("duration") or 0)
        segment_durations.append(duration)
        segment_files.append(output_part)
        srt_files.append(srt_part)

    concat_list = work_dir / "concat.txt"
    concat_list.write_text("".join("file '" + str(p).replace("'", "'\\''") + "'\n" for p in segment_files), encoding="utf-8")
    temp_final = work_dir / "joined_copy.mp4"
    result = subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", str(concat_list),
        "-c", "copy", "-movflags", "+faststart", str(temp_final),
    ])
    if result.returncode != 0 or not valid_video(temp_final):
        temp_final.unlink(missing_ok=True)
        run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", str(concat_list),
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
            str(final_work),
        ], timeout=3600)
        if not valid_video(final_work):
            raise SystemExit("Fallback render failed validation.")
    else:
        shutil.move(str(temp_final), str(final_work))

    shutil.copy2(final_work, final_output)
    offsets: list[int] = []
    running_ms = 0
    for duration in segment_durations:
        offsets.append(running_ms)
        running_ms += round(duration * 1000)
    combined_srt = output_dir / f"Arabic_Dub_{args.task_id}.srt"
    combine_srts(srt_files, offsets, combined_srt)

    final_hash = sha256_file(final_output)
    final_info = probe(final_output)
    final_duration = float((final_info.get("format") or {}).get("duration") or 0)
    original_info = probe(source)
    source_duration = float((original_info.get("format") or {}).get("duration") or 0)
    tolerance = max(5.0, len(existing_inputs) * 2.0)
    if abs(final_duration - source_duration) > tolerance:
        raise SystemExit(
            f"Final duration mismatch exceeds tolerance: source={source_duration:.3f}s "
            f"output={final_duration:.3f}s allowed={tolerance:.1f}s"
        )

    task_meta.update({
        "status": "rendered",
        "task_id": args.task_id,
        "source_sha256": args.source_sha256,
        "source_duration_seconds": source_duration,
        "final_duration_seconds": final_duration,
        "final_file": str(final_output),
        "final_size_bytes": final_output.stat().st_size,
        "final_sha256": final_hash,
        "segment_count": len(existing_inputs),
        "completed_segments": sorted(completed),
        "subtitle_file": str(combined_srt),
        "note": "Violin uses one selected Arabic voice for the clip; it does not perform character-by-character voice cloning or multi-speaker diarization in this workflow.",
    })
    atomic_json(manifest_path, task_meta)
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
        f.write(f"final_sha256={final_hash}\n")
        f.write(f"task_id={args.task_id}\n")
        f.write(f"final_file={final_output}\n")
        f.write(f"segment_count={len(existing_inputs)}\n")
    print(f"FINAL_FILE={final_output}")
    print(f"FINAL_SHA256={final_hash}")
    print(f"SEGMENTS={len(existing_inputs)}")
    print(f"DURATION={final_duration:.3f}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"::error::Command failed with exit code {exc.returncode}: {exc.cmd}", file=sys.stderr)
        raise SystemExit(exc.returncode or 1)
    except subprocess.TimeoutExpired as exc:
        print(f"::error::Command timed out: {exc.cmd}", file=sys.stderr)
        raise SystemExit(124)
