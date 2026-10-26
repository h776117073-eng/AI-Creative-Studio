#!/usr/bin/env python3
"""Headless Colab runner for the public-link Billionaire Granny source.

No Drive API scope or interactive drive.mount is required: the input is fetched
from the user's explicitly shared Drive URL with gdown. The result and all
diagnostics remain in /content/dub-output so the caller can retrieve them before
stopping the Colab session. Video streams are processed off disk in bounded
chunks; the pipeline itself checkpoints each completed speech segment locally.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

SOURCE_URL = "https://drive.google.com/file/d/1sMis6qi_j3AsBvAEL2mliPRIKf0s3-uI/view?usp=drivesdk"
SOURCE_ID = "1sMis6qi_j3AsBvAEL2mliPRIKf0s3-uI"
SOURCE_NAME = "Billionaire Granny Takes Home Fainted Pregnant Woman - Original Quality.mkv"
ROOT = Path("/content/billionaire-granny-dub")
SOURCE_PATH = ROOT / "source" / SOURCE_NAME
WORK = ROOT / "work"
AUDIO_PATH = WORK / "source_audio_16k_mono.wav"
DUB_DIR = WORK / "dub"
OUTPUT = Path("/content/dub-output")
PROGRESS_PATH = OUTPUT / "progress.json"
LOG_PATH = OUTPUT / "progress.log"
FINAL_PATH = OUTPUT / "Billionaire Granny Takes Home Fainted Pregnant Woman - Arabic Dub.mp4"
SRT_PATH = OUTPUT / "Arabic_Dub_Subtitles.srt"
REPORT_PATH = OUTPUT / "quality_report.json"
ASR_MODEL = os.getenv("ASR_MODEL_INPUT", "small")
TRANSLATION_BACKEND = os.getenv("TRANSLATION_BACKEND_INPUT", "google")
STARTED_AT = datetime.now(timezone.utc).isoformat()
STAGE = "starting"
SOURCE_SHA256 = ""


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    line = f"[{now_utc()}] {message}"
    print(line, flush=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
        handle.flush()


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def update_progress(stage: str, **extra) -> None:
    global STAGE
    STAGE = stage
    record = {
        "task": "Billionaire Granny Arabic multi-speaker dubbing",
        "status": "IN_PROGRESS",
        "stage": stage,
        "source_name": SOURCE_NAME,
        "source_file_id": SOURCE_ID,
        "source_sha256": SOURCE_SHA256 or None,
        "updated_at_utc": now_utc(),
        "started_at_utc": STARTED_AT,
        **extra,
    }
    atomic_json(PROGRESS_PATH, record)
    log(f"STAGE={stage}")


def run_stream(command: list[str], *, cwd: Path | None = None,
               env: dict | None = None, label: str | None = None) -> None:
    log("Running: " + (label or str(command[0])))
    merged = os.environ.copy()
    if env:
        merged.update(env)
    with LOG_PATH.open("a", encoding="utf-8") as logfile:
        proc = subprocess.Popen(
            [str(x) for x in command],
            cwd=str(cwd) if cwd else None,
            env=merged,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            errors="replace",
            bufsize=1,
        )
        assert proc.stdout is not None
        try:
            for line in proc.stdout:
                print(line, end="", flush=True)
                logfile.write(line)
                logfile.flush()
            code = proc.wait()
        except Exception:
            if proc.poll() is None:
                proc.kill()
            proc.wait()
            raise
    if code != 0:
        raise RuntimeError(f"Command failed with exit code {code}: {label or command[0]}")


def read_meminfo_gib() -> tuple[float, float]:
    values = {}
    for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
        key, _, rest = line.partition(":")
        if rest.strip().endswith("kB"):
            values[key] = int(rest.strip().split()[0]) / (1024 * 1024)
    return float(values.get("MemTotal", 0)), float(values.get("MemAvailable", 0))


def sha256_file(path: Path, label: str) -> str:
    digest = hashlib.sha256()
    total = path.stat().st_size
    consumed = 0
    with path.open("rb") as stream:
        while True:
            block = stream.read(8 * 1024 * 1024)
            if not block:
                break
            digest.update(block)
            consumed += len(block)
            if consumed >= total or consumed % (512 * 1024 * 1024) < len(block):
                log(f"Hashing {label}: {consumed / max(total, 1) * 100:.1f}% ({consumed:,}/{total:,} bytes)")
    return digest.hexdigest()


def capture_json(command: list[str], label: str) -> dict:
    log("Running: " + label)
    result = subprocess.run(command, capture_output=True, text=True, errors="replace")
    if result.returncode:
        raise RuntimeError(f"{label} failed: {(result.stderr or result.stdout)[-2500:]}")
    return json.loads(result.stdout)


def install_pipeline() -> tuple[Path, Path]:
    update_progress("preparing_dependencies")
    repo = Path("/content/AI-Creative-Studio")
    pipeline = repo / "scripts" / "dub_arabic_multispeaker.py"
    audar = repo / "third_party" / "Audar-TTS-V1"
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("FFmpeg/FFprobe are unavailable in this Colab runtime.")
    if not repo.is_dir():
        run_stream([
            "git", "clone", "--depth", "1",
            "https://github.com/h776117073-eng/AI-Creative-Studio.git",
            str(repo),
        ], label="Clone AI-Creative-Studio dubbing pipeline")
    if not pipeline.is_file():
        raise FileNotFoundError(f"Multi-speaker pipeline missing: {pipeline}")
    if not (audar / "audar_tts" / "__init__.py").is_file():
        if audar.exists():
            shutil.rmtree(audar)
        audar.parent.mkdir(parents=True, exist_ok=True)
        run_stream([
            "git", "clone", "--depth", "1",
            "https://github.com/AudarAI/Audar-TTS-V1.git", str(audar),
        ], label="Fetch Audar TTS inference source")

    venv = Path("/content/arabic-dub-venv")
    python = venv / "bin" / "python"
    env = {
        "PIP_NO_CACHE_DIR": "1",
        "CMAKE_BUILD_PARALLEL_LEVEL": "2",
        "MAKEFLAGS": "-j2",
        "CMAKE_ARGS": "-DGGML_CUDA=OFF -DGGML_OPENMP=ON",
        "HF_HOME": str(ROOT / "cache" / "huggingface"),
        "TOKENIZERS_PARALLELISM": "false",
    }
    if not python.is_file():
        if shutil.which("uv") is None:
            run_stream([sys.executable, "-m", "pip", "install", "--upgrade", "uv"],
                       label="Install uv environment manager")
        run_stream(["uv", "python", "install", "3.11"], env=env,
                   label="Install compatible Python 3.11")
        run_stream(["uv", "venv", "--python", "3.11", str(venv)], env=env,
                   label="Create isolated ML environment")
        run_stream([
            "uv", "pip", "install", "--python", str(python),
            "--index-url", "https://download.pytorch.org/whl/cpu", "torch", "torchaudio",
        ], env=env, label="Install CPU PyTorch for bounded memory use")
        packages = [
            "numpy<2", "soundfile", "scikit-learn>=1.4", "speechbrain>=1.0.3",
            "faster-whisper", "argostranslate", "deep-translator",
            "huggingface_hub", "llama-cpp-python", "neucodec", "librosa",
        ]
        run_stream([
            "uv", "pip", "install", "--python", str(python),
            "--index-url", "https://pypi.org/simple", *packages,
        ], env=env, label="Install ASR, speaker diarization, translation, and synthetic-voice libraries")
    check = subprocess.run([
        str(python), "-c",
        "import numpy,soundfile,sklearn,speechbrain,faster_whisper,llama_cpp,neucodec; print('ml-imports-ok')",
    ], capture_output=True, text=True, errors="replace")
    if check.returncode:
        raise RuntimeError("ML dependency check failed: " + (check.stderr or check.stdout)[-2500:])
    log(check.stdout.strip() or "ML dependency check passed.")
    return repo, python


def obtain_source() -> tuple[Path, dict]:
    update_progress("downloading_source_from_shared_drive")
    SOURCE_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not SOURCE_PATH.is_file() or SOURCE_PATH.stat().st_size < 1_000_000_000:
        if shutil.which("gdown") is None:
            run_stream([sys.executable, "-m", "pip", "install", "--no-cache-dir", "gdown"],
                       label="Install Drive-compatible downloader")
        partial = SOURCE_PATH.with_suffix(".mkv.part")
        partial.unlink(missing_ok=True)
        run_stream([
            sys.executable, "-m", "gdown", "--fuzzy", SOURCE_URL,
            "--output", str(partial), "--continue",
        ], label="Download the user-shared 2.48 GB Drive video directly to local Colab disk")
        if not partial.is_file() or partial.stat().st_size < 1_000_000_000:
            raise RuntimeError("Drive download did not produce a complete-looking source video.")
        os.replace(partial, SOURCE_PATH)
    source_bytes = SOURCE_PATH.stat().st_size
    if source_bytes < 1_000_000_000:
        raise RuntimeError(f"Source file is unexpectedly small: {source_bytes:,} bytes.")
    source_hash = sha256_file(SOURCE_PATH, "source video")
    probe = capture_json([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,format_name:stream=codec_type,codec_name,width,height",
        "-of", "json", str(SOURCE_PATH),
    ], "Inspect downloaded video streams")
    streams = probe.get("streams", [])
    duration = float((probe.get("format") or {}).get("duration") or 0)
    if duration < 60 or not any(s.get("codec_type") == "video" for s in streams) or not any(s.get("codec_type") == "audio" for s in streams):
        raise RuntimeError("Source duration/streams failed validation.")
    return SOURCE_PATH, {
        "source_id": SOURCE_ID, "source_name": SOURCE_NAME,
        "source_sha256": source_hash, "source_size_bytes": source_bytes,
        "duration_seconds": duration, "probe": probe,
    }


def extract_audio(source: Path, info: dict) -> Path:
    WORK.mkdir(parents=True, exist_ok=True)
    if AUDIO_PATH.is_file() and AUDIO_PATH.stat().st_size > 1000:
        try:
            existing = json.loads((WORK / "source_identity.json").read_text(encoding="utf-8"))
            if existing.get("source_sha256") == info["source_sha256"]:
                log("Reusing extracted audio checkpoint from the current Colab session.")
                return AUDIO_PATH
        except Exception:
            pass
    update_progress("extracting_audio", source_sha256=info["source_sha256"])
    temp = AUDIO_PATH.with_suffix(".wav.part")
    temp.unlink(missing_ok=True)
    run_stream([
        "ffmpeg", "-y", "-v", "error", "-i", str(source),
        "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", str(temp),
    ], label="Extract 16 kHz mono speech audio to disk without loading video into RAM")
    if not temp.is_file() or temp.stat().st_size < 1000:
        raise RuntimeError("Audio extraction created an empty file.")
    os.replace(temp, AUDIO_PATH)
    atomic_json(WORK / "source_identity.json", {
        "source_sha256": info["source_sha256"],
        "audio_sha256": sha256_file(AUDIO_PATH, "source audio"),
        "audio_size_bytes": AUDIO_PATH.stat().st_size,
        "source_duration_seconds": info["duration_seconds"],
    })
    audio_probe = capture_json([
        "ffprobe", "-v", "error", "-show_entries", "format=duration,size",
        "-of", "json", str(AUDIO_PATH),
    ], "Validate extracted audio")
    audio_duration = float((audio_probe.get("format") or {}).get("duration") or 0)
    if abs(audio_duration - float(info["duration_seconds"])) > 4:
        raise RuntimeError("Audio/video duration mismatch after extraction.")
    return AUDIO_PATH


def seconds_to_srt(value: float) -> str:
    ms = max(0, int(round(value * 1000)))
    hours, rem = divmod(ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    seconds, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def create_subtitles(transcript_path: Path) -> float:
    data = json.loads(transcript_path.read_text(encoding="utf-8"))
    entries = []
    arabic_chars = alphabetic_chars = 0
    for segment in data.get("segments") or []:
        text = str(segment.get("arabic") or "").strip()
        if not text:
            continue
        for char in text:
            if char.isalpha():
                alphabetic_chars += 1
                if "\u0600" <= char <= "\u06ff" or "\ufb50" <= char <= "\ufdff" or "\ufe70" <= char <= "\ufeff":
                    arabic_chars += 1
        start = max(0.0, float(segment.get("start") or 0))
        end = max(start + 0.08, float(segment.get("end") or start + 0.08))
        speaker = str(segment.get("speaker_id") or "")
        prefix = f"[{speaker}] " if speaker else ""
        entries.append((start, end, prefix + text))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    SRT_PATH.write_text(
        "\n\n".join(f"{i}\n{seconds_to_srt(start)} --> {seconds_to_srt(end)}\n{text}"
                    for i, (start, end, text) in enumerate(entries, 1)) + "\n",
        encoding="utf-8",
    )
    return arabic_chars / max(1, alphabetic_chars)


def render_and_verify(source: Path, info: dict, manifest: dict) -> dict:
    update_progress("rendering_and_validating_mp4")
    audio = DUB_DIR / "dub_ar.wav"
    if not audio.is_file() or audio.stat().st_size < 1000:
        raise RuntimeError("Continuous Arabic dub WAV is missing.")
    duration = float(info["duration_seconds"])
    FINAL_PATH.unlink(missing_ok=True)
    mux = [
        "ffmpeg", "-y", "-v", "error", "-i", str(source), "-i", str(audio),
        "-filter_complex",
        "[0:a:0]volume=0.06[amb];[1:a:0]volume=1.0[ar];"
        "[amb][ar]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]",
        "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k", "-t", f"{duration:.3f}",
        "-movflags", "+faststart", str(FINAL_PATH),
    ]
    result = subprocess.run(mux, capture_output=True, text=True, errors="replace")
    if result.returncode or not FINAL_PATH.is_file() or FINAL_PATH.stat().st_size < 1_000_000:
        FINAL_PATH.unlink(missing_ok=True)
        log("Video stream-copy mux failed; trying H.264 re-encode fallback.")
        run_stream([
            "ffmpeg", "-y", "-v", "error", "-i", str(source), "-i", str(audio),
            "-filter_complex",
            "[0:a:0]volume=0.06[amb];[1:a:0]volume=1.0[ar];"
            "[amb][ar]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]",
            "-map", "0:v:0", "-map", "[aout]", "-c:v", "libx264",
            "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-t", f"{duration:.3f}",
            "-movflags", "+faststart", str(FINAL_PATH),
        ], label="Re-encode video fallback and mux the Arabic audio")
    probe = capture_json([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,format_name:stream=codec_type,codec_name,width,height,sample_rate,channels",
        "-of", "json", str(FINAL_PATH),
    ], "Validate final MP4 codecs and duration")
    streams = probe.get("streams", [])
    final_duration = float((probe.get("format") or {}).get("duration") or 0)
    if not any(s.get("codec_type") == "video" for s in streams):
        raise RuntimeError("Final MP4 has no video stream.")
    if not any(s.get("codec_type") == "audio" and s.get("codec_name") == "aac" for s in streams):
        raise RuntimeError("Final MP4 has no AAC audio stream.")
    if abs(final_duration - duration) > 3:
        raise RuntimeError(f"Final video duration differs from source by >3 seconds ({duration:.2f}/{final_duration:.2f}).")
    run_stream(["ffmpeg", "-v", "error", "-i", str(FINAL_PATH), "-f", "null", "-"],
               label="Full decode check of final MP4")
    audio_chars = create_subtitles(DUB_DIR / "transcript_ar.json")
    if audio_chars < 0.45:
        raise RuntimeError(f"Arabic transcript coverage check failed ({audio_chars:.1%}).")
    final_sha = sha256_file(FINAL_PATH, "final dubbed MP4")
    report = {
        "status": "AUDIO_DUB_FINAL_VERIFIED",
        "source_name": SOURCE_NAME,
        "source_file_id": SOURCE_ID,
        "source_sha256": info["source_sha256"],
        "source_size_bytes": info["source_size_bytes"],
        "source_duration_seconds": round(duration, 3),
        "target_language": "ar",
        "asr_model": ASR_MODEL,
        "translation_backend": TRANSLATION_BACKEND,
        "speaker_count": manifest.get("speaker_count"),
        "segment_count": manifest.get("segment_count"),
        "speaker_profiles": manifest.get("speaker_profiles"),
        "tts_engine": manifest.get("tts_engine"),
        "emotion_tags": manifest.get("expressive_tags"),
        "timing_overrun_segments": manifest.get("timing_overrun_segments"),
        "arabic_text_coverage": round(audio_chars, 4),
        "final_file": str(FINAL_PATH),
        "final_size_bytes": FINAL_PATH.stat().st_size,
        "final_sha256": final_sha,
        "final_duration_seconds": round(final_duration, 3),
        "ffprobe_stream_check": "passed",
        "full_ffmpeg_decode": "passed",
        "arabic_subtitle_file": str(SRT_PATH),
        "source_audio_underlay": 0.06,
        "visual_lip_sync": {
            "status": "NOT_PERFORMED",
            "reason": "The existing multi-speaker pipeline aligns utterance timing but does not track faces or animate mouth motion for the active speaker."
        },
        "production_quality_note": "Multi-speaker Arabic audio dub with synthesized voices and timing fit. It is not certified Netflix-level without human language/voice review and a separate visual lip-sync pass.",
        "limitations": manifest.get("limitations", []),
        "completed_at_utc": now_utc(),
    }
    atomic_json(REPORT_PATH, report)
    atomic_json(OUTPUT / "source_info.json", info)
    atomic_json(OUTPUT / "run_manifest.json", manifest)
    atomic_json(OUTPUT / "speaker_profiles.json", manifest.get("speaker_profiles") or {})
    shutil.copy2(DUB_DIR / "transcript_ar.json", OUTPUT / "transcript_ar.json")
    shutil.copy2(DUB_DIR / "transcript_source.json", OUTPUT / "transcript_source.json")
    update_progress("audio_dub_final_verified",
                    final_size_bytes=FINAL_PATH.stat().st_size,
                    final_sha256=final_sha,
                    final_duration_seconds=round(final_duration, 3),
                    visual_lip_sync="NOT_PERFORMED")
    log(json.dumps(report, ensure_ascii=False, indent=2))
    return report


def main() -> int:
    try:
        ROOT.mkdir(parents=True, exist_ok=True)
        WORK.mkdir(parents=True, exist_ok=True)
        DUB_DIR.mkdir(parents=True, exist_ok=True)
        OUTPUT.mkdir(parents=True, exist_ok=True)

        total_ram, available_ram = read_meminfo_gib()
        disk = shutil.disk_usage("/content")
        log(f"Colab RAM: total={total_ram:.1f} GiB, available={available_ram:.1f} GiB; disk free={disk.free/1024**3:.1f} GiB")
        if total_ram < 16:
            raise RuntimeError(f"Only {total_ram:.1f} GiB RAM. High-RAM Colab is required; no models were loaded.")
        if available_ram < 10:
            raise RuntimeError(f"Only {available_ram:.1f} GiB RAM is free. Stop before model loading and restart high-memory Colab.")
        if disk.free < 16 * 1024**3:
            raise RuntimeError(f"Less than 16 GiB local disk free. No large model was downloaded.")
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            raise RuntimeError("FFmpeg/FFprobe are not installed in this Colab runtime.")

        source, info = obtain_source()
        global SOURCE_SHA256
        SOURCE_SHA256 = info["source_sha256"]
        audio = extract_audio(source, info)
        repo, python = install_pipeline()

        update_progress("multi_speaker_arabic_dubbing",
                        source_sha256=SOURCE_SHA256,
                        source_duration_seconds=info["duration_seconds"],
                        asr_model=ASR_MODEL, translation_backend=TRANSLATION_BACKEND)
        env = {
            "HF_HOME": str(ROOT / "cache" / "huggingface"),
            "TOKENIZERS_PARALLELISM": "false",
            "OMP_NUM_THREADS": "2",
            "OPENBLAS_NUM_THREADS": "2",
            "MKL_NUM_THREADS": "2",
            "CMAKE_BUILD_PARALLEL_LEVEL": "2",
        }
        run_stream([
            str(python), str(repo / "scripts" / "dub_arabic_multispeaker.py"),
            "--audio", str(audio),
            "--out-dir", str(DUB_DIR),
            "--asr-model", ASR_MODEL,
            "--translation-backend", TRANSLATION_BACKEND,
            "--source-sha256", SOURCE_SHA256,
            "--max-atempo", "1.35",
        ], cwd=repo, env=env,
           label="Transcribe, diarize speakers, translate Arabic and synthesize expressive multi-voice dialogue")

        manifest_path = DUB_DIR / "run_manifest.json"
        if not manifest_path.is_file():
            raise RuntimeError("Dubbing process finished without run_manifest.json.")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("status") != "AUDIO_DUB_CREATED" or int(manifest.get("segment_count") or 0) < 1:
            raise RuntimeError("Dubbing manifest does not confirm successful Arabic audio generation.")
        render_and_verify(source, info, manifest)
        return 0
    except Exception as exc:
        failure = {
            "status": "FAILED_WITH_CHECKPOINTS",
            "stage": STAGE,
            "error_type": type(exc).__name__,
            "error": str(exc),
            "traceback": traceback.format_exc()[-12000:],
            "updated_at_utc": now_utc(),
            "resume_note": "Local transcription, speaker clustering and per-line voice checkpoints are preserved in /content/billionaire-granny-dub/work/dub for recovery while this Colab session remains available.",
        }
        try:
            atomic_json(PROGRESS_PATH, failure)
            log(f"ERROR: {type(exc).__name__}: {exc}")
        except Exception:
            pass
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        raise


if __name__ == "__main__":
    main()
