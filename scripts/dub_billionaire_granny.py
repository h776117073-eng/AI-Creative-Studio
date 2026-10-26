#!/usr/bin/env python3
"""Resumable, Drive-backed Colab orchestration for the Billionaire Granny episode.

This runs inside a remote Colab VM. Checkpoints are stored on mounted Drive.
Video I/O uses FFmpeg streaming, not an in-memory video array. The current
multi-speaker pipeline does not have a speaker-aware visual lip-animation stage,
so the final report records visual lip sync as not performed.
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

SOURCE_NAME = "Billionaire Granny Takes Home Fainted Pregnant Woman - Original Quality.mkv"
SOURCE_FOLDER = Path("/content/drive/MyDrive/دبلجة")
SOURCE_PATH = SOURCE_FOLDER / SOURCE_NAME
OUTPUT_ROOT = SOURCE_FOLDER / "Billionaire_Granny_Arabic_Dub"
WORK_DIR = OUTPUT_ROOT / "work"
DUB_DIR = WORK_DIR / "dub"
AUDIO_PATH = WORK_DIR / "source_audio_16k_mono.wav"
IDENTITY_PATH = WORK_DIR / "source_identity.json"
PROGRESS_PATH = OUTPUT_ROOT / "progress.json"
LOG_PATH = OUTPUT_ROOT / "progress.log"
FINAL_PATH = OUTPUT_ROOT / "Billionaire Granny Takes Home Fainted Pregnant Woman - Arabic Dub.mp4"
FINAL_TEMP_LOCAL = Path("/content/Billionaire_Granny_Arabic_Dub_final.mp4")
SRT_PATH = OUTPUT_ROOT / "Arabic_Dub_Subtitles.srt"
QUALITY_PATH = OUTPUT_ROOT / "quality_report.json"
REPO_DIR = Path("/content/AI-Creative-Studio")
VENV_DIR = Path("/content/arabic-dub-venv")
VENV_PY = VENV_DIR / "bin" / "python"
PIPELINE_PATH = REPO_DIR / "scripts" / "dub_arabic_multispeaker.py"
ASR_MODEL = "small"
TRANSLATION_BACKEND = "google"
STARTED_AT = datetime.now(timezone.utc).isoformat()
STAGE = "starting"


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    line = f"[{now_utc()}] {message}"
    print(line, flush=True)
    try:
        OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
            handle.flush()
    except OSError:
        pass


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def update_progress(stage: str, **extra) -> None:
    global STAGE
    STAGE = stage
    record = {
        "task": "Billionaire Granny Arabic dubbing",
        "stage": stage,
        "started_at_utc": STARTED_AT,
        "updated_at_utc": now_utc(),
        "source_name": SOURCE_NAME,
        "source_path": str(SOURCE_PATH),
        "output_folder": str(OUTPUT_ROOT),
        **extra,
    }
    atomic_json(PROGRESS_PATH, record)
    log(f"STAGE={stage}")


def run_stream(command: list[str], *, cwd: Path | None = None, env: dict | None = None,
               label: str | None = None, timeout_seconds: int = 0) -> None:
    log("Running: " + (label or " ".join(str(x) for x in command)))
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    with LOG_PATH.open("a", encoding="utf-8") as logfile:
        process = subprocess.Popen(
            [str(x) for x in command],
            cwd=str(cwd) if cwd else None,
            env=merged_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            errors="replace",
            bufsize=1,
        )
        start = time.monotonic()
        try:
            assert process.stdout is not None
            for line in process.stdout:
                print(line, end="", flush=True)
                logfile.write(line)
                logfile.flush()
                if timeout_seconds and time.monotonic() - start > timeout_seconds:
                    process.kill()
                    raise TimeoutError(f"Command exceeded {timeout_seconds} seconds: {label or command[0]}")
            code = process.wait()
        except Exception:
            if process.poll() is None:
                process.kill()
            process.wait()
            raise
    if code != 0:
        raise RuntimeError(f"Command failed with exit code {code}: {label or command[0]}")


def read_meminfo_gib() -> tuple[float, float]:
    data = {}
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            key, _, rest = line.partition(":")
            if rest.strip().endswith("kB"):
                data[key] = int(rest.strip().split()[0]) / (1024 * 1024)
    except Exception:
        pass
    return float(data.get("MemTotal", 0)), float(data.get("MemAvailable", 0))


def sha256_file(path: Path, label: str) -> str:
    digest = hashlib.sha256()
    size = path.stat().st_size
    done = 0
    with path.open("rb") as stream:
        while True:
            block = stream.read(8 * 1024 * 1024)
            if not block:
                break
            digest.update(block)
            done += len(block)
            if done >= size or done % (512 * 1024 * 1024) < len(block):
                log(f"Hashing {label}: {done / max(size, 1) * 100:.1f}% ({done:,}/{size:,} bytes)")
    return digest.hexdigest()


def capture_json(command: list[str], label: str) -> dict:
    log("Running: " + label)
    result = subprocess.run(command, capture_output=True, text=True, errors="replace")
    if result.returncode != 0:
        raise RuntimeError(f"{label} failed: {(result.stderr or result.stdout)[-2000:]}")
    return json.loads(result.stdout)


def find_source() -> Path:
    if SOURCE_PATH.is_file():
        return SOURCE_PATH
    if not Path("/content/drive/MyDrive").is_dir():
        raise RuntimeError("Google Drive is not mounted at /content/drive/MyDrive. The workflow must run colab drivemount first.")
    matches = []
    for candidate_parent in (SOURCE_FOLDER, Path("/content/drive/Shareddrives")):
        if candidate_parent.is_dir():
            try:
                matches.extend(p for p in candidate_parent.rglob(SOURCE_NAME) if p.is_file())
            except OSError:
                continue
        if matches:
            break
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        exact = [p for p in matches if p.parent == SOURCE_FOLDER]
        if len(exact) == 1:
            return exact[0]
        raise RuntimeError("Found multiple copies of the source video; refusing an ambiguous file: " +
                           ", ".join(str(p) for p in matches[:5]))
    raise FileNotFoundError(f"Could not find source video under {SOURCE_FOLDER}.")


def prepare_environment() -> tuple[Path, dict]:
    global SOURCE_PATH
    update_progress("preflight")
    source = find_source()
    source_bytes = source.stat().st_size
    if source_bytes < 1_000_000_000:
        raise RuntimeError(f"Source size is unexpectedly small ({source_bytes:,} bytes); refusing a wrong/partial file.")
    total_ram, available_ram = read_meminfo_gib()
    disk = shutil.disk_usage("/content")
    log(f"Host memory: total={total_ram:.1f} GiB, available={available_ram:.1f} GiB")
    log(f"Local disk: total={disk.total / 1024**3:.1f} GiB, free={disk.free / 1024**3:.1f} GiB")
    log(f"Source video: {source}; bytes={source_bytes:,}")
    if total_ram and total_ram < 7.0:
        raise RuntimeError(f"Colab runtime exposes only {total_ram:.1f} GiB RAM. High-memory allocation failed; stopping before model loading.")
    if available_ram and available_ram < 3.0:
        raise RuntimeError(f"Only {available_ram:.1f} GiB RAM is available. Stopping before model loading.")
    if disk.free < 8 * 1024**3:
        raise RuntimeError("Less than 8 GiB of local working disk is free; stopping before model installation/rendering.")
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        raise RuntimeError("ffmpeg/ffprobe are unavailable in this Colab runtime.")
    SOURCE_PATH = source
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    WORK_DIR.mkdir(parents=True, exist_ok=True)

    old = None
    try:
        old = json.loads(IDENTITY_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    stat = source.stat()
    if (isinstance(old, dict) and old.get("size_bytes") == source_bytes
            and old.get("mtime_ns") == stat.st_mtime_ns and old.get("sha256")):
        source_hash = str(old["sha256"])
        log("Reusing verified source SHA-256 checkpoint.")
    else:
        source_hash = sha256_file(source, "source video")
        atomic_json(IDENTITY_PATH, {
            "source_name": source.name,
            "source_path": str(source),
            "size_bytes": source_bytes,
            "mtime_ns": stat.st_mtime_ns,
            "sha256": source_hash,
            "verified_at_utc": now_utc(),
        })

    probe = capture_json([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,format_name:stream=codec_type,codec_name,width,height",
        "-of", "json", str(source)
    ], "Inspect source video")
    streams = probe.get("streams", [])
    duration = float((probe.get("format") or {}).get("duration") or 0)
    if duration < 60:
        raise RuntimeError(f"Source video duration is unexpectedly short ({duration:.2f} seconds).")
    if not any(s.get("codec_type") == "video" for s in streams):
        raise RuntimeError("Source file contains no video stream.")
    if not any(s.get("codec_type") == "audio" for s in streams):
        raise RuntimeError("Source file contains no audio stream.")

    if not AUDIO_PATH.is_file() or AUDIO_PATH.stat().st_size < 1000:
        update_progress("extracting_audio", source_sha256=source_hash, duration_seconds=duration)
        tmp_audio = AUDIO_PATH.with_suffix(".wav.tmp.wav")
        tmp_audio.unlink(missing_ok=True)
        run_stream([
            "ffmpeg", "-y", "-v", "error", "-i", str(source),
            "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
            "-c:a", "pcm_s16le", str(tmp_audio)
        ], label="Extract mono 16 kHz audio without loading video into RAM")
        if not tmp_audio.is_file() or tmp_audio.stat().st_size < 1000:
            raise RuntimeError("Source audio extraction produced an empty file.")
        os.replace(tmp_audio, AUDIO_PATH)
    else:
        log("Reusing extracted audio checkpoint from Drive.")
    audio_probe = capture_json([
        "ffprobe", "-v", "error", "-show_entries", "format=duration,size",
        "-of", "json", str(AUDIO_PATH)
    ], "Validate extracted audio")
    audio_duration = float((audio_probe.get("format") or {}).get("duration") or 0)
    if audio_duration < duration - 4 or audio_duration > duration + 4:
        raise RuntimeError(f"Audio duration mismatch: video={duration:.2f}s audio={audio_duration:.2f}s.")
    atomic_json(WORK_DIR / "source_probe.json", probe)
    return source, {
        "source_sha256": source_hash,
        "source_bytes": source_bytes,
        "duration_seconds": duration,
        "audio_sha256": sha256_file(AUDIO_PATH, "extracted audio"),
        "audio_duration_seconds": audio_duration,
        "video_probe": probe,
        "ram_total_gib": round(total_ram, 2),
        "ram_available_start_gib": round(available_ram, 2),
        "local_disk_free_start_gib": round(disk.free / 1024**3, 2),
    }


def ensure_repo_and_venv() -> None:
    update_progress("preparing_dependencies")
    if not REPO_DIR.is_dir():
        run_stream(["git", "clone", "--depth", "1",
                    "https://github.com/h776117073-eng/AI-Creative-Studio.git", str(REPO_DIR)],
                   label="Download dubbing pipeline source")
    if not PIPELINE_PATH.is_file():
        raise FileNotFoundError(f"Dubbing pipeline script is missing: {PIPELINE_PATH}")
    audar_dir = REPO_DIR / "third_party" / "Audar-TTS-V1"
    if not (audar_dir / "audar_tts" / "__init__.py").is_file():
        if audar_dir.exists():
            shutil.rmtree(audar_dir)
        audar_dir.parent.mkdir(parents=True, exist_ok=True)
        run_stream(["git", "clone", "--depth", "1",
                    "https://github.com/AudarAI/Audar-TTS-V1.git", str(audar_dir)],
                   label="Fetch Audar TTS inference code")
    if not VENV_PY.is_file():
        if shutil.which("uv") is None:
            run_stream([sys.executable, "-m", "pip", "install", "--upgrade", "uv"],
                       label="Install uv environment manager")
        run_stream(["uv", "python", "install", "3.11"], label="Install Python 3.11 for ML dependency compatibility")
        run_stream(["uv", "venv", "--python", "3.11", str(VENV_DIR)], label="Create isolated Python 3.11 environment")
        env = {
            "PIP_NO_CACHE_DIR": "1",
            "CMAKE_BUILD_PARALLEL_LEVEL": "2",
            "MAKEFLAGS": "-j2",
            "CMAKE_ARGS": "-DGGML_CUDA=OFF -DGGML_OPENMP=ON",
            "HF_HOME": str(OUTPUT_ROOT / "cache" / "huggingface"),
            "TOKENIZERS_PARALLELISM": "false",
        }
        run_stream(["uv", "pip", "install", "--python", str(VENV_PY),
                    "--index-url", "https://download.pytorch.org/whl/cpu",
                    "torch", "torchaudio"], env=env,
                   label="Install CPU PyTorch for predictable RAM/VRAM usage")
        packages = [
            "numpy<2", "soundfile", "scikit-learn>=1.4", "speechbrain>=1.0.3",
            "faster-whisper", "argostranslate", "deep-translator",
            "huggingface_hub", "llama-cpp-python", "neucodec", "librosa",
        ]
        run_stream(["uv", "pip", "install", "--python", str(VENV_PY),
                    "--index-url", "https://pypi.org/simple", *packages],
                   env=env, label="Install ASR, speaker diarization, translation, and multi-voice TTS")
    else:
        log("Reusing the current session's isolated Python environment.")
    check = subprocess.run([
        str(VENV_PY), "-c",
        "import numpy,soundfile,sklearn,speechbrain,faster_whisper,llama_cpp,neucodec; print('ml-imports-ok')"
    ], capture_output=True, text=True, errors="replace")
    if check.returncode != 0:
        raise RuntimeError("ML dependency import check failed: " + (check.stderr or check.stdout)[-2500:])
    log(check.stdout.strip() or "ML dependency import check passed.")


def seconds_to_srt(value: float) -> str:
    ms = max(0, int(round(value * 1000)))
    hours, rem = divmod(ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    seconds, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def create_srt(transcript_path: Path) -> tuple[Path, float]:
    data = json.loads(transcript_path.read_text(encoding="utf-8"))
    segments = data.get("segments") or []
    entries = []
    arabic_chars = 0
    alphabetic_chars = 0
    for seg in segments:
        text = str(seg.get("arabic") or "").strip()
        if not text:
            continue
        for char in text:
            if char.isalpha():
                alphabetic_chars += 1
                if "\u0600" <= char <= "\u06ff" or "\ufb50" <= char <= "\ufdff" or "\ufe70" <= char <= "\ufeff":
                    arabic_chars += 1
        start = max(0.0, float(seg.get("start") or 0))
        end = max(start + 0.08, float(seg.get("end") or start + 0.08))
        speaker = str(seg.get("speaker_id") or "")
        prefix = f"[{speaker}] " if speaker else ""
        entries.append((start, end, prefix + text))
    ratio = arabic_chars / max(1, alphabetic_chars)
    SRT_PATH.write_text(
        "\n\n".join(f"{i}\n{seconds_to_srt(start)} --> {seconds_to_srt(end)}\n{text}"
                    for i, (start, end, text) in enumerate(entries, 1)) + "\n",
        encoding="utf-8",
    )
    return SRT_PATH, ratio


def render_and_verify(source: Path, source_info: dict, dub_manifest: dict) -> dict:
    update_progress("rendering_final_video", source_sha256=source_info["source_sha256"])
    audio_path = DUB_DIR / "dub_ar.wav"
    if not audio_path.is_file() or audio_path.stat().st_size < 1000:
        raise RuntimeError("Arabic dub audio is missing; refusing to create a mislabeled final video.")
    duration = float(source_info["duration_seconds"])
    FINAL_TEMP_LOCAL.unlink(missing_ok=True)
    command_copy = [
        "ffmpeg", "-y", "-v", "error", "-i", str(source), "-i", str(audio_path),
        "-filter_complex",
        "[0:a:0]volume=0.06[amb];[1:a:0]volume=1.0[ar];"
        "[amb][ar]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]",
        "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k", "-t", f"{duration:.3f}",
        "-movflags", "+faststart", str(FINAL_TEMP_LOCAL),
    ]
    copy_result = subprocess.run(command_copy, capture_output=True, text=True, errors="replace")
    if copy_result.returncode != 0 or not FINAL_TEMP_LOCAL.is_file() or FINAL_TEMP_LOCAL.stat().st_size < 1_000_000:
        FINAL_TEMP_LOCAL.unlink(missing_ok=True)
        log("Video stream copy did not work in MP4; trying H.264 re-encode fallback.")
        command_encode = [
            "ffmpeg", "-y", "-v", "error", "-i", str(source), "-i", str(audio_path),
            "-filter_complex",
            "[0:a:0]volume=0.06[amb];[1:a:0]volume=1.0[ar];"
            "[amb][ar]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]",
            "-map", "0:v:0", "-map", "[aout]", "-c:v", "libx264",
            "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-t", f"{duration:.3f}",
            "-movflags", "+faststart", str(FINAL_TEMP_LOCAL),
        ]
        run_stream(command_encode, label="Re-encode video fallback and mux Arabic audio")
    else:
        log("H.264/video stream copy and Arabic audio mux succeeded.")
    if not FINAL_TEMP_LOCAL.is_file() or FINAL_TEMP_LOCAL.stat().st_size < 1_000_000:
        raise RuntimeError("Final local MP4 is missing or unexpectedly small.")
    probe = capture_json([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,format_name:stream=codec_type,codec_name,width,height,sample_rate,channels",
        "-of", "json", str(FINAL_TEMP_LOCAL)
    ], "Validate final MP4 streams and duration")
    streams = probe.get("streams", [])
    output_duration = float((probe.get("format") or {}).get("duration") or 0)
    if not any(s.get("codec_type") == "video" for s in streams):
        raise RuntimeError("Final MP4 has no video stream.")
    if not any(s.get("codec_type") == "audio" and s.get("codec_name") == "aac" for s in streams):
        raise RuntimeError("Final MP4 has no AAC audio stream.")
    if abs(output_duration - duration) > 3.0:
        raise RuntimeError(f"Duration check failed: source={duration:.2f}s output={output_duration:.2f}s.")
    run_stream(["ffmpeg", "-v", "error", "-i", str(FINAL_TEMP_LOCAL), "-f", "null", "-"],
               label="Full MP4 decode verification")
    local_size = FINAL_TEMP_LOCAL.stat().st_size
    local_sha = sha256_file(FINAL_TEMP_LOCAL, "final MP4")
    srt_path, arabic_ratio = create_srt(DUB_DIR / "transcript_ar.json")
    if arabic_ratio < 0.45:
        raise RuntimeError(f"Arabic text coverage check failed ({arabic_ratio:.1%}); refusing to upload a mislabeled Arabic dub.")

    update_progress("uploading_to_drive", final_size_bytes=local_size, final_sha256=local_sha)
    upload_tmp = FINAL_PATH.with_suffix(".mp4.uploading")
    upload_tmp.unlink(missing_ok=True)
    with FINAL_TEMP_LOCAL.open("rb") as src, upload_tmp.open("wb") as dst:
        copied = 0
        while True:
            block = src.read(8 * 1024 * 1024)
            if not block:
                break
            dst.write(block)
            copied += len(block)
            if copied >= local_size or copied % (512 * 1024 * 1024) < len(block):
                log(f"Copying verified MP4 to Drive: {copied / local_size * 100:.1f}%")
        dst.flush()
        os.fsync(dst.fileno())
    if upload_tmp.stat().st_size != local_size:
        raise RuntimeError("Drive copy size does not match the verified local MP4.")
    drive_sha = sha256_file(upload_tmp, "Drive copy verification")
    if drive_sha != local_sha:
        raise RuntimeError("SHA-256 mismatch after copying the MP4 to Drive.")
    os.replace(upload_tmp, FINAL_PATH)

    report = {
        "status": "AUDIO_DUB_FINAL_VERIFIED",
        "source_name": SOURCE_NAME,
        "source_path": str(source),
        "source_sha256": source_info["source_sha256"],
        "source_size_bytes": source_info["source_bytes"],
        "source_duration_seconds": round(duration, 3),
        "source_language": dub_manifest.get("source_language"),
        "target_language": "ar",
        "asr_model": ASR_MODEL,
        "translation_backend": TRANSLATION_BACKEND,
        "speaker_count": dub_manifest.get("speaker_count"),
        "segment_count": dub_manifest.get("segment_count"),
        "speaker_profiles": dub_manifest.get("speaker_profiles"),
        "tts_engine": dub_manifest.get("tts_engine"),
        "emotion_tags": dub_manifest.get("expressive_tags"),
        "timing_overrun_segments": dub_manifest.get("timing_overrun_segments"),
        "arabic_text_coverage": round(arabic_ratio, 4),
        "final_file": str(FINAL_PATH),
        "final_drive_size_bytes": FINAL_PATH.stat().st_size,
        "final_sha256": drive_sha,
        "final_duration_seconds": round(output_duration, 3),
        "ffprobe_stream_check": "passed",
        "full_ffmpeg_decode": "passed",
        "drive_copy_sha256_check": "passed",
        "arabic_subtitle_file": str(SRT_PATH),
        "source_audio_underlay": 0.06,
        "visual_lip_sync": {
            "status": "NOT_PERFORMED",
            "reason": "The current pipeline timestamp-aligns speech but does not track every visible face and animate mouth movement per active speaker. The result is not represented as visually lip-synced."
        },
        "production_quality_note": "Automated multi-speaker Arabic audio dub with timestamp fitting and synthetic voices; not certified as Netflix-level without human linguistic, voice, speaker, and visual lip-sync review.",
        "limitations": dub_manifest.get("limitations", []),
        "completed_at_utc": now_utc(),
    }
    atomic_json(QUALITY_PATH, report)
    update_progress("audio_dub_final_verified", final_file=str(FINAL_PATH), final_size_bytes=local_size,
                    final_sha256=drive_sha, visual_lip_sync="NOT_PERFORMED")
    log(json.dumps(report, ensure_ascii=False, indent=2))
    return report


def main() -> int:
    try:
        if not Path("/content/drive/MyDrive").is_dir():
            raise RuntimeError("Google Drive is not mounted. Workflow must run colab drivemount before this script.")
        OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
        update_progress("starting")
        source, source_info = prepare_environment()
        existing = None
        try:
            existing = json.loads(QUALITY_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
        if (FINAL_PATH.is_file() and isinstance(existing, dict)
                and existing.get("status") == "AUDIO_DUB_FINAL_VERIFIED"
                and existing.get("source_sha256") == source_info["source_sha256"]
                and int(existing.get("final_drive_size_bytes") or 0) == FINAL_PATH.stat().st_size):
            log("A verified final output for this exact source already exists in Drive. Skipping completed work.")
            update_progress("already_complete", final_file=str(FINAL_PATH), final_sha256=existing.get("final_sha256"))
            return 0

        ensure_repo_and_venv()
        update_progress("multi_speaker_arabic_dubbing",
                        source_sha256=source_info["source_sha256"],
                        source_duration_seconds=source_info["duration_seconds"],
                        asr_model=ASR_MODEL, translation_backend=TRANSLATION_BACKEND)
        env = {
            "HF_HOME": str(OUTPUT_ROOT / "cache" / "huggingface"),
            "TOKENIZERS_PARALLELISM": "false",
            "OMP_NUM_THREADS": "2",
            "OPENBLAS_NUM_THREADS": "2",
            "MKL_NUM_THREADS": "2",
            "CMAKE_BUILD_PARALLEL_LEVEL": "2",
        }
        run_stream([
            str(VENV_PY), str(PIPELINE_PATH),
            "--audio", str(AUDIO_PATH),
            "--out-dir", str(DUB_DIR),
            "--asr-model", ASR_MODEL,
            "--translation-backend", TRANSLATION_BACKEND,
            "--source-sha256", source_info["source_sha256"],
            "--max-atempo", "1.35",
        ], cwd=REPO_DIR, env=env,
           label="Transcribe, cluster speakers, translate to Arabic, synthesize multiple voices, and resume from Drive checkpoints")
        manifest_path = DUB_DIR / "run_manifest.json"
        if not manifest_path.is_file():
            raise RuntimeError("Dubbing pipeline exited without writing run_manifest.json.")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("status") != "AUDIO_DUB_CREATED":
            raise RuntimeError(f"Unexpected dubbing manifest status: {manifest.get('status')}")
        if int(manifest.get("segment_count") or 0) < 1:
            raise RuntimeError("No Arabic speech segments were produced.")
        render_and_verify(source, source_info, manifest)
        atomic_json(OUTPUT_ROOT / "source_info.json", source_info)
        return 0
    except Exception as exc:
        error = {
            "status": "FAILED_RESUMABLE",
            "stage": STAGE,
            "error_type": type(exc).__name__,
            "error": str(exc),
            "traceback": traceback.format_exc()[-12000:],
            "updated_at_utc": now_utc(),
            "resume_note": "Existing Drive checkpoints were retained. Fix the cause and rerun the workflow to continue from valid checkpoints.",
        }
        try:
            atomic_json(PROGRESS_PATH, error)
            with LOG_PATH.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(error, ensure_ascii=False, indent=2) + "\n")
        except Exception:
            pass
        log(f"ERROR: {type(exc).__name__}: {exc}")
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        return 1


# colab exec evaluates the file in a remote notebook kernel, so invoke main
# unconditionally rather than depending on how the kernel sets __name__.
_TASK_RESULT = main()
if _TASK_RESULT != 0:
    raise RuntimeError(f"Colab dubbing task failed at stage {STAGE}; inspect the Drive progress log.")
