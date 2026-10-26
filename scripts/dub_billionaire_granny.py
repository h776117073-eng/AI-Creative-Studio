#!/usr/bin/env python3
"""Drive-API-backed, resumable multi-speaker Arabic dubbing on a remote Colab VM.

The runner transfers a short-lived ADC credential file to the ephemeral VM.
Google Drive is accessed via Drive API (no interactive drive.mount prompt).
Source video and output audio are streamed to disk in bounded chunks. Completed
raw voice segments are periodically snapshotted to Drive so a restarted session
can resume without repeating already synthesized lines.
"""
from __future__ import annotations

import hashlib
import io
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
from pathlib import Path, PurePosixPath
from typing import Any

SOURCE_NAME = "Billionaire Granny Takes Home Fainted Pregnant Woman - Original Quality.mkv"
SOURCE_ID = "1sMis6qi_j3AsBvAEL2mliPRIKf0s3-uI"
CREDENTIALS_PATH = Path("/content/.private/google_adc.json")
CONFIG_PATH = Path("/content/dub_config.json")
LOCAL_ROOT = Path("/content/Billionaire_Granny_Arabic_Dub")
WORK_DIR = LOCAL_ROOT / "work"
DUB_DIR = WORK_DIR / "dub"
SOURCE_LOCAL = Path("/content/Billionaire_Granny_source.mkv")
AUDIO_PATH = WORK_DIR / "source_audio_16k_mono.wav"
IDENTITY_PATH = WORK_DIR / "source_identity.json"
PROGRESS_PATH = LOCAL_ROOT / "progress.json"
LOG_PATH = LOCAL_ROOT / "progress.log"
LOCAL_INDEX_PATH = WORK_DIR / "checkpoint_index.json"
FINAL_LOCAL = Path("/content/Billionaire_Granny_Arabic_Dub_final.mp4")
FINAL_NAME = "Billionaire Granny Takes Home Fainted Pregnant Woman - Arabic Dub.mp4"
SRT_NAME = "Arabic_Dub_Subtitles.srt"
QUALITY_NAME = "quality_report.json"
SOURCE_AUDIO_NAME = "source_audio_16k_mono.wav"
ASR_MODEL = os.getenv("ASR_MODEL_INPUT", "small")
TRANSLATION_BACKEND = os.getenv("TRANSLATION_BACKEND_INPUT", "google")
STARTED_AT = datetime.now(timezone.utc).isoformat()
STAGE = "starting"
DRIVE = None
OUTPUT_FOLDER_ID = ""
CHECKPOINT_FOLDER_ID = ""
DRIVE_FILE_IDS: dict[str, str] = {}
CHECKPOINT_INDEX: dict[str, Any] = {
    "schema": 1, "batches": [], "uploaded_files": {}, "next_batch": 1,
}
SOURCE_META: dict[str, Any] = {}
DRIVE_SYNC_READY = False


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    line = f"[{now_utc()}] {message}"
    print(line, flush=True)
    try:
        LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
            handle.flush()
    except OSError:
        pass


def sha256_file(path: Path, label: str = "file") -> str:
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


def md5_file(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def drive_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def drive_list(query: str, fields: str = "files(id,name,mimeType,size,parents,modifiedTime,md5Checksum,appProperties,webViewLink)") -> list[dict]:
    if DRIVE is None:
        raise RuntimeError("Google Drive API is not initialized.")
    results: list[dict] = []
    token = None
    while True:
        response = DRIVE.files().list(
            q=query,
            pageSize=1000,
            pageToken=token,
            fields=f"nextPageToken,{fields}",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute(num_retries=4)
        results.extend(response.get("files", []))
        token = response.get("nextPageToken")
        if not token:
            break
    return results


def drive_find_child(parent_id: str, name: str) -> dict | None:
    q = (
        f"'{parent_id}' in parents and name = '{drive_escape(name)}' "
        "and trashed = false"
    )
    matches = drive_list(q)
    return matches[0] if matches else None


def upload_request(request) -> dict:
    response = None
    while response is None:
        _status, response = request.next_chunk(num_retries=5)
    return response


def drive_upsert_local(local_file: Path, name: str, parent_id: str,
                       mime_type: str = "application/octet-stream",
                       app_properties: dict[str, str] | None = None) -> dict:
    """Create or replace a Drive file with resumable upload for large media."""
    if DRIVE is None:
        raise RuntimeError("Google Drive API is not initialized.")
    key = f"{parent_id}/{name}"
    metadata = DRIVE_FILE_IDS.get(key)
    if not metadata:
        existing = drive_find_child(parent_id, name)
        if existing:
            metadata = existing.get("id")
    body: dict[str, Any] = {"name": name, "appProperties": app_properties or {}}
    media = __import__("googleapiclient.http", fromlist=["MediaFileUpload"]).MediaFileUpload(
        str(local_file), mimetype=mime_type, resumable=True, chunksize=8 * 1024 * 1024
    )
    if metadata:
        request = DRIVE.files().update(
            fileId=metadata, body=body, media_body=media,
            fields="id,name,size,md5Checksum,parents,webViewLink,appProperties",
            supportsAllDrives=True,
        )
    else:
        body["parents"] = [parent_id]
        request = DRIVE.files().create(
            body=body, media_body=media,
            fields="id,name,size,md5Checksum,parents,webViewLink,appProperties",
            supportsAllDrives=True,
        )
    response = upload_request(request)
    DRIVE_FILE_IDS[key] = response["id"]
    return response


def drive_download(file_id: str, local_path: Path, expected_size: int | None = None,
                   label: str = "Drive file") -> Path:
    from googleapiclient.http import MediaIoBaseDownload
    local_path.parent.mkdir(parents=True, exist_ok=True)
    partial = local_path.with_suffix(local_path.suffix + ".part")
    partial.unlink(missing_ok=True)
    request = DRIVE.files().get_media(fileId=file_id, supportsAllDrives=True)
    with partial.open("wb") as stream:
        downloader = MediaIoBaseDownload(stream, request, chunksize=8 * 1024 * 1024)
        done = False
        last_logged = 0
        while not done:
            status, done = downloader.next_chunk(num_retries=5)
            current = int(stream.tell())
            if current - last_logged >= 256 * 1024 * 1024 or done:
                log(f"Downloading {label}: {current / max(expected_size or current, 1) * 100:.1f}% ({current:,} bytes)")
                last_logged = current
        stream.flush()
        os.fsync(stream.fileno())
    if expected_size is not None and partial.stat().st_size != expected_size:
        raise RuntimeError(
            f"Drive download size mismatch for {label}: expected {expected_size:,}, got {partial.stat().st_size:,} bytes."
        )
    os.replace(partial, local_path)
    return local_path


def upload_json(name: str, parent_id: str, payload: dict) -> dict:
    local = WORK_DIR / "drive_payloads" / name
    local.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(local, payload)
    return drive_upsert_local(local, name, parent_id, "application/json")


def upload_text(name: str, parent_id: str, text: str, mime_type: str = "text/plain") -> dict:
    local = WORK_DIR / "drive_payloads" / name
    local.parent.mkdir(parents=True, exist_ok=True)
    local.write_text(text, encoding="utf-8")
    return drive_upsert_local(local, name, parent_id, mime_type)


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
    if result.returncode != 0:
        raise RuntimeError(f"{label} failed: {(result.stderr or result.stdout)[-2500:]}")
    return json.loads(result.stdout)


def initialize_drive() -> None:
    global DRIVE, OUTPUT_FOLDER_ID, CHECKPOINT_FOLDER_ID, DRIVE_SYNC_READY, ASR_MODEL, TRANSLATION_BACKEND
    if not CREDENTIALS_PATH.is_file():
        raise RuntimeError(
            "The ADC credential file is missing inside the Colab VM. "
            "The workflow must upload it before executing this task."
        )
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    ASR_MODEL = str(config.get("asr_model", ASR_MODEL))
    TRANSLATION_BACKEND = str(config.get("translation_backend", TRANSLATION_BACKEND))
    from google.auth import load_credentials_from_file
    from googleapiclient.discovery import build
    scopes = ["https://www.googleapis.com/auth/drive.file"]
    credentials, _project = load_credentials_from_file(str(CREDENTIALS_PATH), scopes=scopes)
    DRIVE = build("drive", "v3", credentials=credentials, cache_discovery=False)
    OUTPUT_FOLDER_ID = str(config["output_folder_id"])
    CHECKPOINT_FOLDER_ID = str(config["checkpoint_folder_id"])
    # Confirm the API credential can read the precise source before downloading it.
    source = DRIVE.files().get(
        fileId=SOURCE_ID,
        fields="id,name,size,mimeType,modifiedTime,md5Checksum,parents,trashed",
        supportsAllDrives=True,
    ).execute(num_retries=4)
    if source.get("name") != SOURCE_NAME or source.get("trashed"):
        raise RuntimeError("Drive source metadata does not match the requested video.")
    if int(source.get("size") or 0) < 1_000_000_000:
        raise RuntimeError("Drive source size is unexpectedly small; refusing to process an ambiguous/partial file.")
    SOURCE_META.update(source)
    # Verify writable access to the folders the workflow created using the same credential.
    output_meta = DRIVE.files().get(fileId=OUTPUT_FOLDER_ID, fields="id,name,mimeType,parents").execute(num_retries=4)
    checkpoint_meta = DRIVE.files().get(fileId=CHECKPOINT_FOLDER_ID, fields="id,name,mimeType,parents").execute(num_retries=4)
    if output_meta.get("mimeType") != "application/vnd.google-apps.folder" or checkpoint_meta.get("mimeType") != "application/vnd.google-apps.folder":
        raise RuntimeError("Configured Drive output/checkpoint IDs are not folders.")
    DRIVE_SYNC_READY = True
    log(f"Drive API ready; source bytes={int(source['size']):,}; output folder={output_meta['name']}; checkpoint folder={checkpoint_meta['name']}")


def update_progress(stage: str, **extra) -> None:
    global STAGE
    STAGE = stage
    LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
    record = {
        "task": "Billionaire Granny Arabic multi-speaker dubbing",
        "status": "IN_PROGRESS",
        "stage": stage,
        "started_at_utc": STARTED_AT,
        "updated_at_utc": now_utc(),
        "source_name": SOURCE_NAME,
        "source_file_id": SOURCE_ID,
        "output_drive_folder_id": OUTPUT_FOLDER_ID,
        **extra,
    }
    atomic_json(PROGRESS_PATH, record)
    log(f"STAGE={stage}")
    if DRIVE_SYNC_READY:
        try:
            upload_json("progress.json", OUTPUT_FOLDER_ID, record)
        except Exception as exc:
            log(f"WARNING: could not sync progress.json to Drive ({type(exc).__name__}); will retry at the next checkpoint.")


def safe_extract(tar: tarfile.TarFile, destination: Path) -> None:
    root = destination.resolve()
    for member in tar.getmembers():
        target = (destination / member.name).resolve()
        if not target.is_relative_to(root):
            raise RuntimeError(f"Checkpoint archive contains an unsafe path: {member.name}")
    tar.extractall(destination)


def load_checkpoint_index() -> None:
    global CHECKPOINT_INDEX
    existing = drive_find_child(CHECKPOINT_FOLDER_ID, "checkpoint_index.json")
    if existing:
        destination = WORK_DIR / "checkpoint_index.remote.json"
        drive_download(existing["id"], destination, int(existing.get("size") or 0), "checkpoint index")
        try:
            data = json.loads(destination.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("schema") == 1:
                CHECKPOINT_INDEX.update(data)
        except Exception:
            log("Checkpoint index JSON was invalid; rebuilding an index from uploaded checkpoint archives.")
    CHECKPOINT_INDEX.setdefault("batches", [])
    CHECKPOINT_INDEX.setdefault("uploaded_files", {})
    CHECKPOINT_INDEX.setdefault("next_batch", 1)
    if not LOCAL_INDEX_PATH.exists():
        atomic_json(LOCAL_INDEX_PATH, CHECKPOINT_INDEX)


def restore_checkpoints() -> None:
    """Restore verified checkpoint archives in sequence; latest metadata wins."""
    update_progress("restoring_drive_checkpoints")
    files = drive_list(
        f"'{CHECKPOINT_FOLDER_ID}' in parents and trashed = false",
        "files(id,name,mimeType,size,parents,modifiedTime,md5Checksum)"
    )
    archives = sorted(
        (item for item in files if item.get("name", "").startswith("checkpoint-") and item.get("name", "").endswith(".tar.gz")),
        key=lambda item: item["name"],
    )
    if not archives:
        log("No previous checkpoint archives found; starting with a clean dubbing cache.")
        return
    extract_root = WORK_DIR / "restore"
    extract_root.mkdir(parents=True, exist_ok=True)
    for number, item in enumerate(archives, 1):
        local_archive = extract_root / item["name"]
        drive_download(item["id"], local_archive, int(item.get("size") or 0), item["name"])
        with tarfile.open(local_archive, "r:gz") as archive:
            safe_extract(archive, DUB_DIR)
        local_archive.unlink(missing_ok=True)
        log(f"Restored checkpoint archive {number}/{len(archives)}: {item['name']}")
    shutil.rmtree(extract_root, ignore_errors=True)


def sync_checkpoint(force: bool = False) -> None:
    """Upload only newly completed raw TTS WAVs plus the latest atomic JSON checkpoints."""
    if DRIVE is None or not OUTPUT_FOLDER_ID or not CHECKPOINT_FOLDER_ID:
        return
    manifest_path = DUB_DIR / "translated_segments.json"
    metadata_paths = [
        "transcript_source.json", "speaker_profiles.json",
        "transcript_source_with_speakers.json", "translated_segments.json",
        "transcript_ar.json", "run_manifest.json",
    ]
    candidates: list[tuple[str, Path, str]] = []
    data = None
    if manifest_path.is_file():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            data = None
    if isinstance(data, dict):
        for segment in data.get("segments", []):
            if not isinstance(segment, dict):
                continue
            index = segment.get("index")
            voice = segment.get("voice_profile_id")
            expected_hash = segment.get("raw_sha256")
            if index is None or not voice or not expected_hash:
                continue
            relative = f"segments/line_{int(index):05d}_{voice}.wav"
            target = DUB_DIR / relative
            if not target.is_file() or target.stat().st_size < 1000:
                continue
            indexed_hash = CHECKPOINT_INDEX["uploaded_files"].get(relative)
            if indexed_hash == expected_hash:
                continue
            current_hash = sha256_file(target, target.name)
            if current_hash != expected_hash:
                log(f"WARNING: raw line WAV checksum does not match its checkpoint: {relative}; not backing up the unfinished file.")
                continue
            candidates.append((relative, target, current_hash))
    has_metadata = any((DUB_DIR / name).is_file() for name in metadata_paths)
    if not candidates and not force:
        return
    if not candidates and not has_metadata:
        return

    archive_root = WORK_DIR / "checkpoint_build"
    shutil.rmtree(archive_root, ignore_errors=True)
    archive_root.mkdir(parents=True, exist_ok=True)
    added_paths: list[str] = []
    for relative, target, checksum in candidates:
        destination = archive_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, destination)
        added_paths.append(relative)
    for name in metadata_paths:
        source = DUB_DIR / name
        if source.is_file():
            destination = archive_root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
    # The current batch can also restore the last progress summary for diagnosis.
    if PROGRESS_PATH.is_file():
        shutil.copy2(PROGRESS_PATH, archive_root / "progress.json")
    batch_number = int(CHECKPOINT_INDEX.get("next_batch") or 1)
    source_tag = str(SOURCE_META.get("md5Checksum") or "source")[:8]
    archive_name = f"checkpoint-{source_tag}-{batch_number:06d}.tar.gz"
    archive_path = WORK_DIR / archive_name
    with tarfile.open(archive_path, "w:gz", compresslevel=1) as archive:
        for item in sorted(archive_root.rglob("*")):
            if item.is_file():
                archive.add(item, arcname=item.relative_to(archive_root).as_posix())
    if archive_path.stat().st_size > 100:
        result = drive_upsert_local(archive_path, archive_name, CHECKPOINT_FOLDER_ID, "application/gzip")
        CHECKPOINT_INDEX.setdefault("batches", []).append({
            "name": archive_name, "file_id": result["id"],
            "size_bytes": int(result.get("size") or archive_path.stat().st_size),
            "created_at_utc": now_utc(), "paths": added_paths,
        })
        for relative, _target, checksum in candidates:
            CHECKPOINT_INDEX["uploaded_files"][relative] = checksum
        CHECKPOINT_INDEX["next_batch"] = batch_number + 1
        atomic_json(LOCAL_INDEX_PATH, CHECKPOINT_INDEX)
        upload_json("checkpoint_index.json", CHECKPOINT_FOLDER_ID, CHECKPOINT_INDEX)
        log(f"Drive checkpoint saved: {archive_name}; new voice WAVs={len(candidates)}; archive_bytes={archive_path.stat().st_size:,}")
    shutil.rmtree(archive_root, ignore_errors=True)
    archive_path.unlink(missing_ok=True)


def sync_logs_to_drive() -> None:
    if not DRIVE_SYNC_READY:
        return
    try:
        if LOG_PATH.is_file():
            drive_upsert_local(LOG_PATH, "progress.log", OUTPUT_FOLDER_ID, "text/plain")
        if PROGRESS_PATH.is_file():
            local = json.loads(PROGRESS_PATH.read_text(encoding="utf-8"))
            upload_json("progress.json", OUTPUT_FOLDER_ID, local)
    except Exception as exc:
        log(f"WARNING: Drive progress-log sync failed: {type(exc).__name__}: {exc}")


def run_stream(command: list[str], *, cwd: Path | None = None, env: dict | None = None,
               label: str | None = None, heartbeat=None, heartbeat_seconds: int = 300) -> None:
    log("Running: " + (label or " ".join(str(x) for x in command)))
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    with LOG_PATH.open("a", encoding="utf-8") as logfile:
        process = subprocess.Popen(
            [str(x) for x in command], cwd=str(cwd) if cwd else None, env=merged_env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", bufsize=1,
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
                        log(f"WARNING: periodic checkpoint sync failed; processing continues and will retry: {type(exc).__name__}: {exc}")
                    last_heartbeat = time.monotonic()
            # Drain final buffered output.
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
    if code != 0:
        raise RuntimeError(f"Command failed with exit code {code}: {label or command[0]}")


def download_source_and_audio() -> tuple[Path, dict]:
    source_size = int(SOURCE_META.get("size") or 0)
    if not SOURCE_LOCAL.is_file() or SOURCE_LOCAL.stat().st_size != source_size:
        update_progress("downloading_source_video", source_size_bytes=source_size)
        download_drive(SOURCE_ID, SOURCE_LOCAL, source_size, SOURCE_NAME)
    else:
        log("Reusing the already downloaded source video in this session.")
    source_hash = sha256_file(SOURCE_LOCAL, "source video")
    probe = capture_json([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,format_name:stream=codec_type,codec_name,width,height",
        "-of", "json", str(SOURCE_LOCAL)
    ], "Inspect source video")
    streams = probe.get("streams", [])
    duration = float((probe.get("format") or {}).get("duration") or 0)
    if duration < 60:
        raise RuntimeError(f"Source video duration is unexpectedly short ({duration:.2f} seconds).")
    if not any(item.get("codec_type") == "video" for item in streams):
        raise RuntimeError("Source file contains no video stream.")
    if not any(item.get("codec_type") == "audio" for item in streams):
        raise RuntimeError("Source file contains no audio stream.")
    SOURCE_META.update({"sha256": source_hash, "duration_seconds": duration})
    audio_drive_file = drive_find_child(OUTPUT_FOLDER_ID, SOURCE_AUDIO_NAME)
    if audio_drive_file:
        properties = audio_drive_file.get("appProperties") or {}
        if properties.get("source_sha256") == source_hash:
            expected = int(audio_drive_file.get("size") or 0)
            if not AUDIO_PATH.is_file() or AUDIO_PATH.stat().st_size != expected:
                drive_download(audio_drive_file["id"], AUDIO_PATH, expected, SOURCE_AUDIO_NAME)
            log("Reusing the extracted source audio checkpoint from Drive.")
        else:
            AUDIO_PATH.unlink(missing_ok=True)
    if not AUDIO_PATH.is_file() or AUDIO_PATH.stat().st_size < 1000:
        update_progress("extracting_audio", source_sha256=source_hash, duration_seconds=duration)
        temporary = AUDIO_PATH.with_suffix(".wav.part")
        temporary.unlink(missing_ok=True)
        run_stream([
            "ffmpeg", "-y", "-v", "error", "-i", str(SOURCE_LOCAL),
            "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
            "-c:a", "pcm_s16le", str(temporary)
        ], label="Extract mono 16 kHz audio without loading the video into RAM")
        if not temporary.is_file() or temporary.stat().st_size < 1000:
            raise RuntimeError("Audio extraction produced an empty WAV.")
        os.replace(temporary, AUDIO_PATH)
        audio_hash = sha256_file(AUDIO_PATH, "source audio")
        response = drive_upsert_local(
            AUDIO_PATH, SOURCE_AUDIO_NAME, OUTPUT_FOLDER_ID, "audio/wav",
            {"source_sha256": source_hash, "audio_sha256": audio_hash},
        )
        log(f"Source audio checkpoint uploaded to Drive ({int(response.get('size') or 0):,} bytes).")
    audio_probe = capture_json([
        "ffprobe", "-v", "error", "-show_entries", "format=duration,size",
        "-of", "json", str(AUDIO_PATH)
    ], "Validate extracted audio")
    audio_duration = float((audio_probe.get("format") or {}).get("duration") or 0)
    if abs(audio_duration - duration) > 4:
        raise RuntimeError(f"Audio duration mismatch: video={duration:.2f}s audio={audio_duration:.2f}s.")
    atomic_json(WORK_DIR / "source_probe.json", probe)
    return SOURCE_LOCAL, {
        "source_id": SOURCE_ID,
        "source_name": SOURCE_NAME,
        "source_sha256": source_hash,
        "source_md5": md5_file(SOURCE_LOCAL),
        "source_size_bytes": source_size,
        "source_modified_time": SOURCE_META.get("modifiedTime"),
        "source_duration_seconds": duration,
        "audio_sha256": sha256_file(AUDIO_PATH, "extracted audio"),
        "audio_duration_seconds": audio_duration,
        "video_probe": probe,
    }


def restore_latest_metadata() -> None:
    """Restore small latest metadata documents even when no new WAV was needed."""
    for name in (
        "transcript_source.json", "speaker_profiles.json",
        "transcript_source_with_speakers.json", "translated_segments.json",
        "transcript_ar.json", "run_manifest.json",
    ):
        remote = drive_find_child(OUTPUT_FOLDER_ID, f"latest_{name}")
        if remote:
            local = DUB_DIR / name
            drive_download(remote["id"], local, int(remote.get("size") or 0), f"latest_{name}")


def save_latest_metadata() -> None:
    for name in (
        "transcript_source.json", "speaker_profiles.json",
        "transcript_source_with_speakers.json", "translated_segments.json",
        "transcript_ar.json", "run_manifest.json",
    ):
        local = DUB_DIR / name
        if local.is_file():
            drive_upsert_local(local, f"latest_{name}", OUTPUT_FOLDER_ID, "application/json")


def ensure_repo_and_venv() -> None:
    update_progress("preparing_dependencies")
    repo = Path("/content/AI-Creative-Studio")
    pipeline = repo / "scripts" / "dub_arabic_multispeaker.py"
    if not repo.is_dir():
        run_stream([
            "git", "clone", "--depth", "1",
            "https://github.com/h776117073-eng/AI-Creative-Studio.git", str(repo)
        ], label="Download dubbing pipeline source")
    if not pipeline.is_file():
        raise FileNotFoundError(f"Dubbing pipeline is missing: {pipeline}")
    audar = repo / "third_party" / "Audar-TTS-V1"
    if not (audar / "audar_tts" / "__init__.py").is_file():
        if audar.exists():
            shutil.rmtree(audar)
        audar.parent.mkdir(parents=True, exist_ok=True)
        run_stream(["git", "clone", "--depth", "1", "https://github.com/AudarAI/Audar-TTS-V1.git", str(audar)],
                   label="Fetch Audar TTS inference code")
    venv = Path("/content/arabic-dub-venv")
    python = venv / "bin" / "python"
    if not python.is_file():
        if shutil.which("uv") is None:
            run_stream([sys.executable, "-m", "pip", "install", "--upgrade", "uv"], label="Install uv")
        run_stream(["uv", "python", "install", "3.11"], label="Install Python 3.11 for ML dependencies")
        run_stream(["uv", "venv", "--python", "3.11", str(venv)], label="Create isolated Python 3.11 environment")
        env = {
            "PIP_NO_CACHE_DIR": "1", "CMAKE_BUILD_PARALLEL_LEVEL": "2", "MAKEFLAGS": "-j2",
            "CMAKE_ARGS": "-DGGML_CUDA=OFF -DGGML_OPENMP=ON",
            "HF_HOME": str(LOCAL_ROOT / "cache" / "huggingface"),
            "TOKENIZERS_PARALLELISM": "false",
        }
        run_stream(["uv", "pip", "install", "--python", str(python),
                    "--index-url", "https://download.pytorch.org/whl/cpu", "torch", "torchaudio"],
                   env=env, label="Install CPU PyTorch for predictable memory consumption")
        packages = [
            "numpy<2", "soundfile", "scikit-learn>=1.4", "speechbrain>=1.0.3",
            "faster-whisper", "argostranslate", "deep-translator", "huggingface_hub",
            "llama-cpp-python", "neucodec", "librosa",
        ]
        run_stream(["uv", "pip", "install", "--python", str(python),
                    "--index-url", "https://pypi.org/simple", *packages],
                   env=env, label="Install ASR, diarization, translation and synthetic-voice dependencies")
    check = subprocess.run([
        str(python), "-c",
        "import numpy,soundfile,sklearn,speechbrain,faster_whisper,llama_cpp,neucodec; print('ml-imports-ok')"
    ], capture_output=True, text=True, errors="replace")
    if check.returncode != 0:
        raise RuntimeError("ML dependency import check failed: " + (check.stderr or check.stdout)[-2500:])
    log(check.stdout.strip() or "ML imports passed.")


def seconds_to_srt(value: float) -> str:
    milliseconds = max(0, int(round(value * 1000)))
    hours, rest = divmod(milliseconds, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    seconds, millis = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def create_srt(transcript_path: Path, output_path: Path) -> float:
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
    output_path.write_text(
        "\n\n".join(f"{i}\n{seconds_to_srt(start)} --> {seconds_to_srt(end)}\n{text}"
                    for i, (start, end, text) in enumerate(entries, 1)) + "\n",
        encoding="utf-8",
    )
    return arabic_chars / max(1, alphabetic_chars)


def render_and_upload_final(source: Path, info: dict, manifest: dict) -> dict:
    update_progress("rendering_final_video", source_sha256=info["source_sha256"])
    dub_audio = DUB_DIR / "dub_ar.wav"
    if not dub_audio.is_file() or dub_audio.stat().st_size < 1000:
        raise RuntimeError("Arabic dub audio missing; refusing to create a falsely complete MP4.")
    duration = float(info["source_duration_seconds"])
    FINAL_LOCAL.unlink(missing_ok=True)
    mux = [
        "ffmpeg", "-y", "-v", "error", "-i", str(source), "-i", str(dub_audio),
        "-filter_complex",
        "[0:a:0]volume=0.06[amb];[1:a:0]volume=1.0[ar];"
        "[amb][ar]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]",
        "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-t", f"{duration:.3f}", "-movflags", "+faststart", str(FINAL_LOCAL),
    ]
    result = subprocess.run(mux, capture_output=True, text=True, errors="replace")
    if result.returncode != 0 or not FINAL_LOCAL.is_file() or FINAL_LOCAL.stat().st_size < 1_000_000:
        FINAL_LOCAL.unlink(missing_ok=True)
        log("Video stream-copy mux failed; trying H.264 re-encode fallback.")
        run_stream([
            "ffmpeg", "-y", "-v", "error", "-i", str(source), "-i", str(dub_audio),
            "-filter_complex",
            "[0:a:0]volume=0.06[amb];[1:a:0]volume=1.0[ar];"
            "[amb][ar]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]",
            "-map", "0:v:0", "-map", "[aout]", "-c:v", "libx264", "-preset", "veryfast",
            "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-t", f"{duration:.3f}", "-movflags", "+faststart", str(FINAL_LOCAL),
        ], label="Re-encode video fallback and mux Arabic audio")
    probe = capture_json([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,format_name:stream=codec_type,codec_name,width,height,sample_rate,channels",
        "-of", "json", str(FINAL_LOCAL)
    ], "Validate final MP4 streams and duration")
    streams = probe.get("streams", [])
    final_duration = float((probe.get("format") or {}).get("duration") or 0)
    if not any(s.get("codec_type") == "video" for s in streams):
        raise RuntimeError("Final MP4 has no video stream.")
    if not any(s.get("codec_type") == "audio" and s.get("codec_name") == "aac" for s in streams):
        raise RuntimeError("Final MP4 has no AAC audio stream.")
    if abs(final_duration - duration) > 3.0:
        raise RuntimeError(f"Final duration differs by more than 3 seconds ({duration:.2f}s vs {final_duration:.2f}s).")
    run_stream(["ffmpeg", "-v", "error", "-i", str(FINAL_LOCAL), "-f", "null", "-"],
               label="Full decode verification of final MP4")
    final_sha = sha256_file(FINAL_LOCAL, "final MP4")
    final_md5 = md5_file(FINAL_LOCAL)
    local_srt = LOCAL_ROOT / SRT_NAME
    arabic_ratio = create_srt(DUB_DIR / "transcript_ar.json", local_srt)
    if arabic_ratio < 0.45:
        raise RuntimeError(f"Arabic transcript coverage check failed ({arabic_ratio:.1%}); refusing to label this output Arabic.")

    update_progress("uploading_final_video_to_drive", final_size_bytes=FINAL_LOCAL.stat().st_size, final_sha256=final_sha)
    existing_final = drive_find_child(OUTPUT_FOLDER_ID, FINAL_NAME)
    from googleapiclient.http import MediaFileUpload
    media = MediaFileUpload(str(FINAL_LOCAL), mimetype="video/mp4", resumable=True, chunksize=8 * 1024 * 1024)
    properties = {
        "source_sha256": info["source_sha256"],
        "final_sha256": final_sha,
        "dub_status": "verified",
    }
    body = {"name": FINAL_NAME, "appProperties": properties}
    if existing_final:
        request = DRIVE.files().update(
            fileId=existing_final["id"], body=body, media_body=media,
            fields="id,name,size,md5Checksum,parents,webViewLink,appProperties",
            supportsAllDrives=True,
        )
    else:
        body["parents"] = [OUTPUT_FOLDER_ID]
        request = DRIVE.files().create(
            body=body, media_body=media,
            fields="id,name,size,md5Checksum,parents,webViewLink,appProperties",
            supportsAllDrives=True,
        )
    uploaded = upload_request(request)
    if int(uploaded.get("size") or 0) != FINAL_LOCAL.stat().st_size:
        raise RuntimeError("Uploaded MP4 size does not match the local verified file.")
    if uploaded.get("md5Checksum") and uploaded["md5Checksum"].lower() != final_md5.lower():
        raise RuntimeError("Google Drive MP4 MD5 differs from the locally verified final file.")
    if OUTPUT_FOLDER_ID not in uploaded.get("parents", []):
        raise RuntimeError("Uploaded MP4 metadata does not confirm the expected Drive output folder.")

    srt_drive = drive_upsert_local(local_srt, SRT_NAME, OUTPUT_FOLDER_ID, "application/x-subrip")
    report = {
        "status": "AUDIO_DUB_FINAL_VERIFIED",
        "source_name": SOURCE_NAME,
        "source_file_id": SOURCE_ID,
        "source_sha256": info["source_sha256"],
        "source_size_bytes": info["source_size_bytes"],
        "source_modified_time": info.get("source_modified_time"),
        "source_duration_seconds": round(duration, 3),
        "source_language": manifest.get("source_language"),
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
        "final_file_name": FINAL_NAME,
        "final_file_id": uploaded["id"],
        "final_drive_link": uploaded.get("webViewLink"),
        "final_drive_size_bytes": int(uploaded["size"]),
        "final_sha256": final_sha,
        "final_md5": final_md5,
        "final_duration_seconds": round(final_duration, 3),
        "ffprobe_stream_check": "passed",
        "full_ffmpeg_decode": "passed",
        "drive_size_md5_parent_check": "passed",
        "subtitle_file_id": srt_drive.get("id"),
        "subtitle_link": srt_drive.get("webViewLink"),
        "source_audio_underlay": 0.06,
        "visual_lip_sync": {
            "status": "NOT_PERFORMED",
            "reason": "This repository's current multi-speaker pipeline aligns utterance timing but does not track faces and synthesize mouth motion for the active speaker. The final output is not represented as visually lip-synced."
        },
        "production_quality_note": "Automated multi-speaker Arabic audio dub, with time fitting and synthetic voices. Netflix-level quality is not certified without human linguistic/voice review and a separate visual lip-sync stage.",
        "limitations": manifest.get("limitations", []),
        "completed_at_utc": now_utc(),
    }
    atomic_json(LOCAL_ROOT / QUALITY_NAME, report)
    drive_upsert_local(LOCAL_ROOT / QUALITY_NAME, QUALITY_NAME, OUTPUT_FOLDER_ID, "application/json")
    save_latest_metadata()
    update_progress("audio_dub_final_verified", final_file_id=uploaded["id"], final_file=uploaded.get("webViewLink"),
                    final_size_bytes=int(uploaded["size"]), final_sha256=final_sha, visual_lip_sync="NOT_PERFORMED")
    sync_logs_to_drive()
    log(json.dumps(report, ensure_ascii=False, indent=2))
    return report


def main() -> int:
    try:
        LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
        WORK_DIR.mkdir(parents=True, exist_ok=True)
        DUB_DIR.mkdir(parents=True, exist_ok=True)
        initialize_drive()

        total_ram, available_ram = read_meminfo_gib()
        disk = shutil.disk_usage("/content")
        log(f"Colab RAM: total={total_ram:.1f} GiB, available={available_ram:.1f} GiB; disk free={disk.free/1024**3:.1f} GiB")
        if total_ram and total_ram < 16.0:
            raise RuntimeError(f"Only {total_ram:.1f} GiB RAM is available. High-memory Colab was not allocated; stopping before model loading.")
        if available_ram and available_ram < 10.0:
            raise RuntimeError(f"Only {available_ram:.1f} GiB RAM is currently available. Stopping before model loading.")
        if disk.free < 16 * 1024**3:
            raise RuntimeError("Less than 16 GiB local disk is free. Stopping before downloading the 2.48 GB source and model weights.")
        if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
            raise RuntimeError("ffmpeg/ffprobe are unavailable in this Colab runtime.")

        load_checkpoint_index()
        restore_checkpoints()
        restore_latest_metadata()
        source, source_info = download_source_and_audio()
        update_progress("preflight_passed", source_sha256=source_info["source_sha256"],
                        duration_seconds=source_info["source_duration_seconds"],
                        ram_total_gib=round(total_ram, 2), ram_available_start_gib=round(available_ram, 2))
        ensure_repo_and_venv()

        env = {
            "HF_HOME": str(LOCAL_ROOT / "cache" / "huggingface"),
            "TOKENIZERS_PARALLELISM": "false",
            "OMP_NUM_THREADS": "2",
            "OPENBLAS_NUM_THREADS": "2",
            "MKL_NUM_THREADS": "2",
            "CMAKE_BUILD_PARALLEL_LEVEL": "2",
        }
        update_progress("multi_speaker_arabic_dubbing",
                        source_sha256=source_info["source_sha256"],
                        source_duration_seconds=source_info["source_duration_seconds"],
                        asr_model=ASR_MODEL, translation_backend=TRANSLATION_BACKEND)
        def heartbeat() -> None:
            sync_checkpoint(force=False)
            sync_logs_to_drive()
        run_stream([
            str(Path("/content/arabic-dub-venv/bin/python")),
            "/content/AI-Creative-Studio/scripts/dub_arabic_multispeaker.py",
            "--audio", str(AUDIO_PATH),
            "--out-dir", str(DUB_DIR),
            "--asr-model", ASR_MODEL,
            "--translation-backend", TRANSLATION_BACKEND,
            "--source-sha256", source_info["source_sha256"],
            "--max-atempo", "1.35",
        ], cwd=Path("/content/AI-Creative-Studio"), env=env,
           label="Transcribe, cluster speakers, translate, synthesize multi-voice Arabic and resume from Drive checkpoints",
           heartbeat=heartbeat, heartbeat_seconds=300)

        manifest_path = DUB_DIR / "run_manifest.json"
        if not manifest_path.is_file():
            raise RuntimeError("Dubbing pipeline exited without run_manifest.json.")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("status") != "AUDIO_DUB_CREATED" or int(manifest.get("segment_count") or 0) < 1:
            raise RuntimeError("Dubbing manifest does not confirm a completed Arabic audio dub.")
        sync_checkpoint(force=True)
        sync_logs_to_drive()
        render_and_upload_final(source, source_info, manifest)
        return 0
    except Exception as exc:
        error = {
            "status": "FAILED_RESUMABLE",
            "stage": STAGE,
            "error_type": type(exc).__name__,
            "error": str(exc),
            "traceback": traceback.format_exc()[-12000:],
            "updated_at_utc": now_utc(),
            "resume_note": "Source audio, progress, metadata and completed raw voice-line checkpoints already uploaded to Drive are retained. Rerunning this workflow restores checkpoint archives before continuing.",
        }
        try:
            atomic_json(PROGRESS_PATH, error)
            log(f"ERROR: {type(exc).__name__}: {exc}")
            if DRIVE_SYNC_READY:
                try:
                    upload_json("progress.json", OUTPUT_FOLDER_ID, error)
                    sync_logs_to_drive()
                    sync_checkpoint(force=True)
                except Exception as sync_exc:
                    log(f"WARNING: failed to persist final error/checkpoint state: {type(sync_exc).__name__}: {sync_exc}")
        except Exception:
            pass
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        # Remove the transferred ADC file from the active VM even on failure.
        try:
            CREDENTIALS_PATH.unlink(missing_ok=True)
        except OSError:
            pass
        return 1
    finally:
        try:
            CREDENTIALS_PATH.unlink(missing_ok=True)
        except OSError:
            pass


_TASK_RESULT = main()
if _TASK_RESULT != 0:
    raise RuntimeError(f"Colab dubbing failed at stage {STAGE}. Check progress.json and progress.log in the Drive output folder.")
