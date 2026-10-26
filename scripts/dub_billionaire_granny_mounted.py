#!/usr/bin/env python3
"""Drive-mounted, resumable Arabic multi-speaker dubbing for Google Colab.

Run only after the notebook has mounted Google Drive. Compute and the large
video stay on the Colab VM; verified raw voice lines and metadata are backed up
as small incremental tar.gz batches to Drive every five minutes.
"""
from __future__ import annotations

import hashlib
import json
import os
import selectors
import shutil
import subprocess
import sys
import tarfile
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

SOURCE_NAME = "Billionaire Granny Takes Home Fainted Pregnant Woman - Original Quality.mkv"
SOURCE_FOLDER = Path("/content/drive/MyDrive/دبلجة")
SOURCE_DRIVE = SOURCE_FOLDER / SOURCE_NAME
OUTPUT_DRIVE = SOURCE_FOLDER / "Billionaire_Granny_Arabic_Dub"
CHECKPOINT_DRIVE = OUTPUT_DRIVE / "checkpoints"
DRIVE_PROGRESS = OUTPUT_DRIVE / "progress.json"
DRIVE_LOG = OUTPUT_DRIVE / "progress.log"
DRIVE_INDEX = CHECKPOINT_DRIVE / "checkpoint_index.json"
LOCAL_ROOT = Path("/content/Billionaire_Granny_Arabic_Dub")
WORK_DIR = LOCAL_ROOT / "work"
DUB_DIR = WORK_DIR / "dub"
SOURCE_LOCAL = Path("/content/Billionaire_Granny_source.mkv")
AUDIO_LOCAL = WORK_DIR / "source_audio_16k_mono.wav"
AUDIO_DRIVE = OUTPUT_DRIVE / "source_audio_16k_mono.wav"
SOURCE_IDENTITY = WORK_DIR / "source_identity.json"
IDENTITY_DRIVE = OUTPUT_DRIVE / "source_identity.json"
LOCAL_PROGRESS = LOCAL_ROOT / "progress.json"
LOCAL_LOG = LOCAL_ROOT / "progress.log"
LOCAL_INDEX = WORK_DIR / "checkpoint_index.json"
FINAL_LOCAL = Path("/content/Billionaire_Granny_Arabic_Dub_final.mp4")
FINAL_DRIVE = OUTPUT_DRIVE / "Billionaire Granny Takes Home Fainted Pregnant Woman - Arabic Dub.mp4"
SRT_DRIVE = OUTPUT_DRIVE / "Arabic_Dub_Subtitles.srt"
QUALITY_DRIVE = OUTPUT_DRIVE / "quality_report.json"
REPO_DIR = Path("/content/AI-Creative-Studio")
VENV_DIR = Path("/content/arabic-dub-venv")
VENV_PY = VENV_DIR / "bin" / "python"
PIPELINE = REPO_DIR / "scripts" / "dub_arabic_multispeaker.py"
ASR_MODEL = os.getenv("ASR_MODEL_INPUT", "small")
TRANSLATION_BACKEND = os.getenv("TRANSLATION_BACKEND_INPUT", "google")
STARTED_AT = datetime.now(timezone.utc).isoformat()
STAGE = "starting"
SOURCE_SHA256 = ""
CHECKPOINT_INDEX: dict = {"schema": 1, "source_sha256": "", "next_batch": 1, "uploaded_files": {}, "uploaded_metadata": {}, "batches": []}


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    line = f"[{now_utc()}] {message}"
    print(line, flush=True)
    LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
    with LOCAL_LOG.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
        handle.flush()


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        os.replace(temp, path)
    except OSError:
        shutil.copyfile(temp, path)
        temp.unlink(missing_ok=True)


def copy_stream(src: Path, dst: Path, label: str) -> None:
    """Copy large files in bounded chunks; never materialize them in RAM."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    temp = dst.with_name(dst.name + ".uploading")
    total = src.stat().st_size
    copied = 0
    with src.open("rb") as reader, temp.open("wb") as writer:
        while True:
            block = reader.read(8 * 1024 * 1024)
            if not block:
                break
            writer.write(block)
            copied += len(block)
            if copied >= total or copied % (512 * 1024 * 1024) < len(block):
                log(f"Copy {label}: {copied / max(total, 1) * 100:.1f}% ({copied:,}/{total:,} bytes)")
        writer.flush()
        os.fsync(writer.fileno())
    if temp.stat().st_size != total:
        raise RuntimeError(f"Copy size mismatch for {label}: {temp.stat().st_size} != {total}")
    try:
        os.replace(temp, dst)
    except OSError:
        shutil.copyfile(temp, dst)
        temp.unlink(missing_ok=True)
    if dst.stat().st_size != total:
        raise RuntimeError(f"Destination size mismatch for {label}.")


def sha256_file(path: Path, label: str) -> str:
    digest = hashlib.sha256()
    total = path.stat().st_size
    read = 0
    with path.open("rb") as stream:
        while True:
            block = stream.read(8 * 1024 * 1024)
            if not block:
                break
            digest.update(block)
            read += len(block)
            if read >= total or read % (512 * 1024 * 1024) < len(block):
                log(f"Hash {label}: {read / max(total, 1) * 100:.1f}% ({read:,}/{total:,} bytes)")
    return digest.hexdigest()


def md5_file(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_meminfo_gib() -> tuple[float, float]:
    values = {}
    for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
        key, _, rest = line.partition(":")
        if rest.strip().endswith("kB"):
            values[key] = int(rest.strip().split()[0]) / (1024 * 1024)
    return float(values.get("MemTotal", 0)), float(values.get("MemAvailable", 0))


def capture_json(command: list[str], label: str) -> dict:
    log(f"Running: {label}")
    result = subprocess.run(command, capture_output=True, text=True, errors="replace")
    if result.returncode:
        raise RuntimeError(f"{label} failed: {(result.stderr or result.stdout)[-2500:]}")
    return json.loads(result.stdout)


def sync_progress() -> None:
    if LOCAL_PROGRESS.is_file():
        copy_stream(LOCAL_PROGRESS, DRIVE_PROGRESS, "progress.json")
    if LOCAL_LOG.is_file():
        copy_stream(LOCAL_LOG, DRIVE_LOG, "progress.log")


def update_progress(stage: str, **extra) -> None:
    global STAGE
    STAGE = stage
    record = {
        "task": "Billionaire Granny Arabic multi-speaker dubbing",
        "status": "IN_PROGRESS",
        "stage": stage,
        "updated_at_utc": now_utc(),
        "started_at_utc": STARTED_AT,
        "source_name": SOURCE_NAME,
        "source_path": str(SOURCE_DRIVE),
        "output_folder": str(OUTPUT_DRIVE),
        "source_sha256": SOURCE_SHA256 or None,
        **extra,
    }
    atomic_json(LOCAL_PROGRESS, record)
    log(f"STAGE={stage}")
    try:
        sync_progress()
    except Exception as exc:
        log(f"WARNING: unable to sync progress to Drive ({type(exc).__name__}: {exc})")


def safe_extract(archive: tarfile.TarFile, destination: Path) -> None:
    root = destination.resolve()
    for member in archive.getmembers():
        target = (destination / member.name).resolve()
        if not target.is_relative_to(root):
            raise RuntimeError(f"Unsafe path in checkpoint archive: {member.name}")
    archive.extractall(destination)


def load_checkpoint_index() -> None:
    global CHECKPOINT_INDEX
    if DRIVE_INDEX.is_file():
        try:
            saved = json.loads(DRIVE_INDEX.read_text(encoding="utf-8"))
            if saved.get("schema") == 1 and saved.get("source_sha256") == SOURCE_SHA256:
                CHECKPOINT_INDEX = saved
            else:
                log("Existing Drive checkpoint index is for a different source version; it will not be reused.")
        except Exception as exc:
            log(f"Checkpoint index unreadable ({type(exc).__name__}); rebuilding it from the current source.")
    if CHECKPOINT_INDEX.get("source_sha256") != SOURCE_SHA256:
        CHECKPOINT_INDEX = {
            "schema": 1, "source_sha256": SOURCE_SHA256,
            "next_batch": 1, "uploaded_files": {}, "uploaded_metadata": {}, "batches": [],
        }
    CHECKPOINT_INDEX.setdefault("uploaded_metadata", {})
    CHECKPOINT_INDEX.setdefault("uploaded_files", {})
    LOCAL_INDEX.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(LOCAL_INDEX, CHECKPOINT_INDEX)


def restore_checkpoints() -> None:
    update_progress("restoring_drive_checkpoints")
    pattern = f"checkpoint-{SOURCE_SHA256[:8]}-*.tar.gz"
    archives = sorted(CHECKPOINT_DRIVE.glob(pattern), key=lambda path: path.name)
    if not archives:
        log("No checkpoint batches exist yet; starting a fresh transcript/TTS cache.")
        return
    for number, source_archive in enumerate(archives, 1):
        local_archive = WORK_DIR / source_archive.name
        try:
            copy_stream(source_archive, local_archive, source_archive.name)
            with tarfile.open(local_archive, "r:gz") as archive:
                safe_extract(archive, DUB_DIR)
            log(f"Restored checkpoint {number}/{len(archives)}: {source_archive.name}")
        except Exception as exc:
            log(f"WARNING: skipping unreadable checkpoint {source_archive.name}: {type(exc).__name__}: {exc}")
        finally:
            local_archive.unlink(missing_ok=True)


def sync_checkpoint(force: bool = False) -> None:
    """Back up new verified raw TTS line WAVs, plus the latest metadata, to Drive."""
    manifest_path = DUB_DIR / "translated_segments.json"
    metadata_names = [
        "transcript_source.json", "speaker_profiles.json",
        "transcript_source_with_speakers.json", "translated_segments.json",
        "transcript_ar.json", "run_manifest.json",
    ]
    candidates: list[tuple[str, Path, str]] = []
    if manifest_path.is_file():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        for segment in data.get("segments", []) if isinstance(data, dict) else []:
            if not isinstance(segment, dict):
                continue
            index = segment.get("index")
            voice = segment.get("voice_profile_id")
            expected_hash = segment.get("raw_sha256")
            if index is None or not voice or not expected_hash:
                continue
            relative = f"segments/line_{int(index):05d}_{voice}.wav"
            wav = DUB_DIR / relative
            if not wav.is_file() or wav.stat().st_size < 1000:
                continue
            if CHECKPOINT_INDEX["uploaded_files"].get(relative) == expected_hash:
                continue
            actual = sha256_file(wav, wav.name)
            if actual != expected_hash:
                log(f"WARNING: skipping unfinished or checksum-mismatched raw WAV: {relative}")
                continue
            candidates.append((relative, wav, actual))

    metadata_candidates: list[tuple[str, Path, str]] = []
    uploaded_metadata = CHECKPOINT_INDEX.setdefault("uploaded_metadata", {})
    for name in metadata_names:
        current = DUB_DIR / name
        if not current.is_file():
            continue
        current_hash = sha256_file(current, name)
        if force or uploaded_metadata.get(name) != current_hash:
            metadata_candidates.append((name, current, current_hash))
    if not candidates and not metadata_candidates:
        return

    build_root = WORK_DIR / "checkpoint_build"
    shutil.rmtree(build_root, ignore_errors=True)
    build_root.mkdir(parents=True, exist_ok=True)
    added = []
    for relative, wav, _checksum in candidates:
        target = build_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(wav, target)
        added.append(relative)
    for name, current, _checksum in metadata_candidates:
        destination = build_root / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(current, destination)
    if LOCAL_PROGRESS.is_file():
        shutil.copy2(LOCAL_PROGRESS, build_root / "progress.json")

    batch = int(CHECKPOINT_INDEX.get("next_batch") or 1)
    archive_name = f"checkpoint-{SOURCE_SHA256[:8]}-{batch:06d}.tar.gz"
    local_archive = WORK_DIR / archive_name
    with tarfile.open(local_archive, "w:gz", compresslevel=1) as archive:
        for item in sorted(build_root.rglob("*")):
            if item.is_file():
                archive.add(item, arcname=item.relative_to(build_root).as_posix())
    shutil.rmtree(build_root, ignore_errors=True)

    if local_archive.stat().st_size > 100:
        dest = CHECKPOINT_DRIVE / archive_name
        copy_stream(local_archive, dest, archive_name)
        CHECKPOINT_INDEX.setdefault("batches", []).append({
            "name": archive_name,
            "size_bytes": dest.stat().st_size,
            "created_at_utc": now_utc(),
            "new_raw_wavs": added,
        })
        for relative, _wav, checksum in candidates:
            CHECKPOINT_INDEX["uploaded_files"][relative] = checksum
        for name, _source, checksum in metadata_candidates:
            CHECKPOINT_INDEX.setdefault("uploaded_metadata", {})[name] = checksum
        CHECKPOINT_INDEX["next_batch"] = batch + 1
        atomic_json(LOCAL_INDEX, CHECKPOINT_INDEX)
        atomic_json(DRIVE_INDEX, CHECKPOINT_INDEX)
        log(f"Drive checkpoint verified: {archive_name}; new raw voice WAVs={len(candidates)}; archive_bytes={dest.stat().st_size:,}")
    local_archive.unlink(missing_ok=True)


def run_stream(command: list[str], *, cwd: Path | None = None, env: dict | None = None,
               label: str | None = None, heartbeat=None, heartbeat_seconds: int = 300) -> None:
    log("Running: " + (label or str(command[0])))
    merged = os.environ.copy()
    if env:
        merged.update(env)
    with LOCAL_LOG.open("a", encoding="utf-8") as logfile:
        process = subprocess.Popen(
            [str(x) for x in command], cwd=str(cwd) if cwd else None, env=merged,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            errors="replace", bufsize=1,
        )
        assert process.stdout is not None
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        last_heartbeat = time.monotonic()
        try:
            while True:
                events = selector.select(timeout=30)
                if events:
                    line = process.stdout.readline()
                    if line:
                        print(line, end="", flush=True)
                        logfile.write(line)
                        logfile.flush()
                    elif process.poll() is not None:
                        break
                elif process.poll() is not None:
                    break
                if heartbeat and time.monotonic() - last_heartbeat >= heartbeat_seconds:
                    try:
                        heartbeat()
                    except Exception as exc:
                        log(f"WARNING: checkpoint heartbeat failed; it will retry: {type(exc).__name__}: {exc}")
                    last_heartbeat = time.monotonic()
            for line in process.stdout:
                print(line, end="", flush=True)
                logfile.write(line)
            logfile.flush()
            code = process.wait()
        except Exception:
            if process.poll() is None:
                process.kill()
            process.wait()
            raise
        finally:
            selector.close()
    if code:
        raise RuntimeError(f"Command failed with exit code {code}: {label or command[0]}")


def prepare_source_and_audio() -> tuple[Path, dict]:
    global SOURCE_SHA256
    if not SOURCE_DRIVE.is_file():
        raise FileNotFoundError(
            f"Source video not found at {SOURCE_DRIVE}. Confirm that Drive is mounted and the filename is unchanged."
        )
    source_size = SOURCE_DRIVE.stat().st_size
    if source_size < 1_000_000_000:
        raise RuntimeError(f"Source size is too small ({source_size:,} bytes); refusing a partial/wrong file.")
    if not SOURCE_LOCAL.is_file() or SOURCE_LOCAL.stat().st_size != source_size:
        partial = SOURCE_LOCAL.with_suffix(".mkv.part")
        partial.unlink(missing_ok=True)
        log(f"Copying the 2.48 GB source video from Drive to local Colab disk: {source_size:,} bytes")
        copy_stream(SOURCE_DRIVE, partial, "source video from Drive")
        os.replace(partial, SOURCE_LOCAL)
    SOURCE_SHA256 = sha256_file(SOURCE_LOCAL, "source video")
    source_stat = SOURCE_DRIVE.stat()

    probe = capture_json([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,format_name:stream=codec_type,codec_name,width,height",
        "-of", "json", str(SOURCE_LOCAL)
    ], "Inspect source video")
    streams = probe.get("streams", [])
    duration = float((probe.get("format") or {}).get("duration") or 0)
    if duration < 60:
        raise RuntimeError(f"Source duration unexpectedly short ({duration:.2f}s).")
    if not any(stream.get("codec_type") == "video" for stream in streams):
        raise RuntimeError("Source contains no video stream.")
    if not any(stream.get("codec_type") == "audio" for stream in streams):
        raise RuntimeError("Source contains no audio stream.")

    saved_identity = {}
    for identity_path in (SOURCE_IDENTITY, IDENTITY_DRIVE):
        if identity_path.is_file():
            try:
                candidate = json.loads(identity_path.read_text(encoding="utf-8"))
                if candidate.get("source_sha256") == SOURCE_SHA256:
                    saved_identity = candidate
                    break
            except Exception:
                continue

    audio_is_valid = AUDIO_LOCAL.is_file() and saved_identity.get("source_sha256") == SOURCE_SHA256
    if not audio_is_valid and AUDIO_DRIVE.is_file() and saved_identity.get("source_sha256") == SOURCE_SHA256:
        expected_audio_hash = saved_identity.get("audio_sha256")
        log("Restoring the verified extracted-audio checkpoint from Drive.")
        copy_stream(AUDIO_DRIVE, AUDIO_LOCAL, "extracted audio checkpoint from Drive")
        if expected_audio_hash and sha256_file(AUDIO_LOCAL, "restored source audio") != expected_audio_hash:
            AUDIO_LOCAL.unlink(missing_ok=True)
            raise RuntimeError("The restored Drive audio checkpoint failed its SHA-256 check.")
        audio_is_valid = True

    if audio_is_valid:
        log("Reusing the extracted source audio checkpoint.")
    else:
        update_progress("extracting_audio", source_sha256=SOURCE_SHA256, duration_seconds=duration)
        temporary = AUDIO_LOCAL.with_suffix(".wav.part")
        temporary.unlink(missing_ok=True)
        run_stream([
            "ffmpeg", "-y", "-v", "error", "-i", str(SOURCE_LOCAL),
            "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
            "-c:a", "pcm_s16le", str(temporary)
        ], label="Extract mono 16 kHz audio without loading the video into RAM")
        if not temporary.is_file() or temporary.stat().st_size < 1000:
            raise RuntimeError("Audio extraction produced an empty WAV.")
        os.replace(temporary, AUDIO_LOCAL)

    audio_hash = sha256_file(AUDIO_LOCAL, "source audio")
    identity = {
        "source_name": SOURCE_NAME,
        "source_sha256": SOURCE_SHA256,
        "source_size_bytes": source_size,
        "source_mtime": source_stat.st_mtime,
        "audio_sha256": audio_hash,
        "audio_size_bytes": AUDIO_LOCAL.stat().st_size,
        "updated_at_utc": now_utc(),
    }
    atomic_json(SOURCE_IDENTITY, identity)
    if not AUDIO_DRIVE.is_file() or AUDIO_DRIVE.stat().st_size != AUDIO_LOCAL.stat().st_size or saved_identity.get("audio_sha256") != audio_hash:
        log("Saving extracted audio to Drive so a new Colab session can resume without re-extracting it.")
        copy_stream(AUDIO_LOCAL, AUDIO_DRIVE, "extracted source audio checkpoint to Drive")
    atomic_json(IDENTITY_DRIVE, identity)

    audio_probe = capture_json([
        "ffprobe", "-v", "error", "-show_entries", "format=duration,size",
        "-of", "json", str(AUDIO_LOCAL)
    ], "Validate extracted audio")
    audio_duration = float((audio_probe.get("format") or {}).get("duration") or 0)
    if abs(audio_duration - duration) > 4:
        raise RuntimeError(f"Audio duration mismatch: video={duration:.2f}s audio={audio_duration:.2f}s.")
    atomic_json(WORK_DIR / "source_probe.json", probe)
    return SOURCE_LOCAL, {
        "source_sha256": SOURCE_SHA256,
        "source_md5": md5_file(SOURCE_LOCAL),
        "source_size_bytes": source_size,
        "source_duration_seconds": duration,
        "source_modified_time": source_stat.st_mtime,
        "audio_sha256": sha256_file(AUDIO_LOCAL, "source audio"),
        "audio_duration_seconds": audio_duration,
        "video_probe": probe,
    }


def ensure_repo_and_venv() -> None:
    update_progress("preparing_dependencies")
    if not PIPELINE.is_file():
        raise FileNotFoundError(f"Dubbing pipeline not found: {PIPELINE}")
    audar = REPO_DIR / "third_party" / "Audar-TTS-V1"
    if not (audar / "audar_tts" / "__init__.py").is_file():
        if audar.exists():
            shutil.rmtree(audar)
        audar.parent.mkdir(parents=True, exist_ok=True)
        run_stream([
            "git", "clone", "--depth", "1",
            "https://github.com/AudarAI/Audar-TTS-V1.git", str(audar)
        ], label="Fetch Audar TTS inference code")
    if not VENV_PY.is_file():
        if shutil.which("uv") is None:
            run_stream([sys.executable, "-m", "pip", "install", "--upgrade", "uv"], label="Install uv")
        run_stream(["uv", "python", "install", "3.11"], label="Install Python 3.11 for ML dependency compatibility")
        run_stream(["uv", "venv", "--python", "3.11", str(VENV_DIR)], label="Create isolated Python 3.11 environment")
        env = {
            "PIP_NO_CACHE_DIR": "1",
            "CMAKE_BUILD_PARALLEL_LEVEL": "2",
            "MAKEFLAGS": "-j2",
            "CMAKE_ARGS": "-DGGML_CUDA=OFF -DGGML_OPENMP=ON",
            "HF_HOME": str(LOCAL_ROOT / "cache" / "huggingface"),
            "TOKENIZERS_PARALLELISM": "false",
        }
        run_stream([
            "uv", "pip", "install", "--python", str(VENV_PY),
            "--index-url", "https://download.pytorch.org/whl/cpu",
            "torch", "torchaudio",
        ], env=env, label="Install CPU PyTorch for predictable memory usage")
        packages = [
            "numpy<2", "soundfile", "scikit-learn>=1.4", "speechbrain>=1.0.3",
            "faster-whisper", "argostranslate", "deep-translator",
            "huggingface_hub", "llama-cpp-python", "neucodec", "librosa",
        ]
        run_stream([
            "uv", "pip", "install", "--python", str(VENV_PY),
            "--index-url", "https://pypi.org/simple", *packages,
        ], env=env, label="Install ASR, diarization, translation, and synthetic-voice packages")
    check = subprocess.run([
        str(VENV_PY), "-c",
        "import numpy,soundfile,sklearn,speechbrain,faster_whisper,llama_cpp,neucodec; print('ml-imports-ok')"
    ], capture_output=True, text=True, errors="replace")
    if check.returncode:
        raise RuntimeError("ML dependency import check failed: " + (check.stderr or check.stdout)[-2500:])
    log(check.stdout.strip() or "ML import checks passed.")


def seconds_to_srt(value: float) -> str:
    ms = max(0, int(round(value * 1000)))
    hours, rem = divmod(ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    seconds, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def create_srt(transcript_path: Path) -> float:
    data = json.loads(transcript_path.read_text(encoding="utf-8"))
    entries = []
    arabic_chars = alpha_chars = 0
    for segment in data.get("segments") or []:
        text = str(segment.get("arabic") or "").strip()
        if not text:
            continue
        for char in text:
            if char.isalpha():
                alpha_chars += 1
                if "\u0600" <= char <= "\u06ff" or "\ufb50" <= char <= "\ufdff" or "\ufe70" <= char <= "\ufeff":
                    arabic_chars += 1
        start = max(0.0, float(segment.get("start") or 0))
        end = max(start + 0.08, float(segment.get("end") or start + 0.08))
        speaker = str(segment.get("speaker_id") or "")
        prefix = f"[{speaker}] " if speaker else ""
        entries.append((start, end, prefix + text))
    SRT_LOCAL = LOCAL_ROOT / "Arabic_Dub_Subtitles.srt"
    SRT_LOCAL.write_text(
        "\n\n".join(f"{i}\n{seconds_to_srt(start)} --> {seconds_to_srt(end)}\n{text}"
                    for i, (start, end, text) in enumerate(entries, 1)) + "\n",
        encoding="utf-8",
    )
    return arabic_chars / max(1, alpha_chars)


def render_and_verify(source: Path, info: dict, manifest: dict) -> dict:
    update_progress("rendering_final_video", source_sha256=info["source_sha256"])
    dub_audio = DUB_DIR / "dub_ar.wav"
    if not dub_audio.is_file() or dub_audio.stat().st_size < 1000:
        raise RuntimeError("Arabic dub WAV is missing.")
    duration = float(info["source_duration_seconds"])
    FINAL_LOCAL.unlink(missing_ok=True)
    mux = [
        "ffmpeg", "-y", "-v", "error", "-i", str(source), "-i", str(dub_audio),
        "-filter_complex",
        "[0:a:0]volume=0.06[amb];[1:a:0]volume=1.0[ar];"
        "[amb][ar]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]",
        "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac",
        "-b:a", "192k", "-t", f"{duration:.3f}", "-movflags", "+faststart", str(FINAL_LOCAL),
    ]
    result = subprocess.run(mux, capture_output=True, text=True, errors="replace")
    if result.returncode or not FINAL_LOCAL.is_file() or FINAL_LOCAL.stat().st_size < 1_000_000:
        FINAL_LOCAL.unlink(missing_ok=True)
        log("Copying the video stream into MP4 failed; trying an H.264 re-encode.")
        run_stream([
            "ffmpeg", "-y", "-v", "error", "-i", str(source), "-i", str(dub_audio),
            "-filter_complex",
            "[0:a:0]volume=0.06[amb];[1:a:0]volume=1.0[ar];"
            "[amb][ar]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]",
            "-map", "0:v:0", "-map", "[aout]", "-c:v", "libx264", "-preset", "veryfast",
            "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-t", f"{duration:.3f}", "-movflags", "+faststart", str(FINAL_LOCAL),
        ], label="Re-encode and mux final MP4")
    probe = capture_json([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,format_name:stream=codec_type,codec_name,width,height,sample_rate,channels",
        "-of", "json", str(FINAL_LOCAL)
    ], "Validate final MP4")
    streams = probe.get("streams", [])
    final_duration = float((probe.get("format") or {}).get("duration") or 0)
    if not any(stream.get("codec_type") == "video" for stream in streams):
        raise RuntimeError("Final MP4 contains no video stream.")
    if not any(stream.get("codec_type") == "audio" and stream.get("codec_name") == "aac" for stream in streams):
        raise RuntimeError("Final MP4 contains no AAC audio stream.")
    if abs(final_duration - duration) > 3:
        raise RuntimeError(f"Final duration mismatch: source={duration:.2f}s output={final_duration:.2f}s.")
    run_stream(["ffmpeg", "-v", "error", "-i", str(FINAL_LOCAL), "-f", "null", "-"],
               label="Full decode verification of final MP4")
    final_sha = sha256_file(FINAL_LOCAL, "final MP4")
    final_md5 = md5_file(FINAL_LOCAL)
    srt_local = LOCAL_ROOT / "Arabic_Dub_Subtitles.srt"
    arabic_ratio = create_srt(DUB_DIR / "transcript_ar.json")
    if arabic_ratio < 0.45:
        raise RuntimeError(f"Arabic transcript coverage is only {arabic_ratio:.1%}; refusing to publish as a verified Arabic dub.")

    update_progress("copying_final_video_to_drive", final_size_bytes=FINAL_LOCAL.stat().st_size, final_sha256=final_sha)
    copy_stream(FINAL_LOCAL, FINAL_DRIVE, "final dubbed MP4 to Drive")
    drive_sha = sha256_file(FINAL_DRIVE, "final MP4 on Drive")
    if drive_sha != final_sha:
        raise RuntimeError("SHA-256 mismatch after copying final video to Drive.")
    copy_stream(srt_local, SRT_DRIVE, "Arabic subtitle file to Drive")

    report = {
        "status": "AUDIO_DUB_FINAL_VERIFIED",
        "source_name": SOURCE_NAME,
        "source_path": str(SOURCE_DRIVE),
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
        "arabic_text_coverage": round(arabic_ratio, 4),
        "final_file": str(FINAL_DRIVE),
        "final_size_bytes": FINAL_DRIVE.stat().st_size,
        "final_sha256": drive_sha,
        "final_md5_local": final_md5,
        "final_duration_seconds": round(final_duration, 3),
        "ffprobe_stream_check": "passed",
        "full_ffmpeg_decode": "passed",
        "drive_copy_sha256_check": "passed",
        "subtitle_file": str(SRT_DRIVE),
        "source_audio_underlay": 0.06,
        "visual_lip_sync": {
            "status": "NOT_PERFORMED",
            "reason": "The current multi-speaker audio pipeline aligns utterance timing but does not track faces and synthesize mouth movement for each visible active speaker."
        },
        "production_quality_note": "Automated multi-speaker Arabic audio dub with timestamp fitting and synthetic voices; not certified as Netflix-level without human linguistic/voice review and a separate visual lip-sync stage.",
        "limitations": manifest.get("limitations", []),
        "completed_at_utc": now_utc(),
    }
    atomic_json(LOCAL_ROOT / "quality_report.json", report)
    atomic_json(QUALITY_DRIVE, report)
    save_latest_metadata()
    update_progress("audio_dub_final_verified", final_file=str(FINAL_DRIVE),
                    final_size_bytes=FINAL_DRIVE.stat().st_size,
                    final_sha256=drive_sha, visual_lip_sync="NOT_PERFORMED")
    sync_progress()
    log(json.dumps(report, ensure_ascii=False, indent=2))
    return report


def save_latest_metadata() -> None:
    for name in (
        "transcript_source.json", "speaker_profiles.json",
        "transcript_source_with_speakers.json", "translated_segments.json",
        "transcript_ar.json", "run_manifest.json",
    ):
        local = DUB_DIR / name
        if local.is_file():
            copy_stream(local, OUTPUT_DRIVE / f"latest_{name}", f"latest_{name}")


def main() -> int:
    try:
        if not Path("/content/drive/MyDrive").is_dir():
            raise RuntimeError("Google Drive is not mounted. Run the notebook's Drive authorization cell first.")
        if not SOURCE_DRIVE.is_file():
            raise FileNotFoundError(f"Source video not found at {SOURCE_DRIVE}. Check the exact filename and Drive folder.")
        OUTPUT_DRIVE.mkdir(parents=True, exist_ok=True)
        CHECKPOINT_DRIVE.mkdir(parents=True, exist_ok=True)
        LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
        WORK_DIR.mkdir(parents=True, exist_ok=True)
        DUB_DIR.mkdir(parents=True, exist_ok=True)

        total_ram, available_ram = read_meminfo_gib()
        disk = shutil.disk_usage("/content")
        log(f"RAM total={total_ram:.1f} GiB; available={available_ram:.1f} GiB; local disk free={disk.free/1024**3:.1f} GiB")
        if total_ram and total_ram < 16:
            raise RuntimeError(f"Only {total_ram:.1f} GiB RAM available. Select a High-RAM Colab runtime; refusing to load models on a smaller VM.")
        if available_ram and available_ram < 10:
            raise RuntimeError(f"Only {available_ram:.1f} GiB RAM is free. Stop other notebooks or select a High-RAM runtime before retrying.")
        if disk.free < 16 * 1024**3:
            raise RuntimeError("Less than 16 GiB free on local Colab disk; refusing to start large model/download stages.")
        if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
            raise RuntimeError("ffmpeg/ffprobe are missing; run the notebook setup cell to install them.")

        source, info = prepare_source_and_audio()
        load_checkpoint_index()
        restore_checkpoints()
        update_progress("preflight_passed", source_sha256=info["source_sha256"],
                        source_size_bytes=info["source_size_bytes"],
                        duration_seconds=info["source_duration_seconds"],
                        ram_total_gib=round(total_ram, 2),
                        ram_available_start_gib=round(available_ram, 2))

        if not REPO_DIR.is_dir():
            raise FileNotFoundError(f"Repository checkout missing at {REPO_DIR}. Run the notebook setup cell first.")
        ensure_repo_and_venv()
        update_progress("multi_speaker_arabic_dubbing", source_sha256=SOURCE_SHA256,
                        source_duration_seconds=info["source_duration_seconds"],
                        asr_model=ASR_MODEL, translation_backend=TRANSLATION_BACKEND)
        env = {
            "HF_HOME": str(LOCAL_ROOT / "cache" / "huggingface"),
            "TOKENIZERS_PARALLELISM": "false",
            "OMP_NUM_THREADS": "2",
            "OPENBLAS_NUM_THREADS": "2",
            "MKL_NUM_THREADS": "2",
            "CMAKE_BUILD_PARALLEL_LEVEL": "2",
        }
        def heartbeat() -> None:
            sync_checkpoint(force=False)
            sync_progress()
        run_stream([
            str(VENV_PY), str(PIPELINE),
            "--audio", str(AUDIO_LOCAL),
            "--out-dir", str(DUB_DIR),
            "--asr-model", ASR_MODEL,
            "--translation-backend", TRANSLATION_BACKEND,
            "--source-sha256", SOURCE_SHA256,
            "--max-atempo", "1.35",
        ], cwd=REPO_DIR, env=env,
           label="Transcribe speakers, translate Arabic, synthesize expressive voices and resume from Drive checkpoints",
           heartbeat=heartbeat, heartbeat_seconds=300)

        manifest_path = DUB_DIR / "run_manifest.json"
        if not manifest_path.is_file():
            raise RuntimeError("Dubbing process finished without a run_manifest.json.")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("status") != "AUDIO_DUB_CREATED" or int(manifest.get("segment_count") or 0) < 1:
            raise RuntimeError("Dubbing manifest does not indicate successful Arabic TTS generation.")
        sync_checkpoint(force=True)
        sync_progress()
        render_and_verify(source, info, manifest)
        return 0
    except Exception as exc:
        error = {
            "status": "FAILED_RESUMABLE",
            "stage": STAGE,
            "error_type": type(exc).__name__,
            "error": str(exc),
            "traceback": traceback.format_exc()[-12000:],
            "updated_at_utc": now_utc(),
            "resume_note": "Verified completed raw voice-line WAVs and transcript checkpoints already copied to Drive are preserved; rerun the notebook to restore those batches and resume.",
        }
        try:
            atomic_json(LOCAL_PROGRESS, error)
            log(f"ERROR: {type(exc).__name__}: {exc}")
            if Path("/content/drive/MyDrive").is_dir():
                atomic_json(DRIVE_PROGRESS, error)
                sync_progress()
                sync_checkpoint(force=True)
        except Exception as sync_exc:
            print(f"Warning: could not persist the final error state to Drive: {type(sync_exc).__name__}: {sync_exc}", flush=True)
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
