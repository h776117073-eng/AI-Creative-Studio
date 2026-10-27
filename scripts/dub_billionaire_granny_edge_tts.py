#!/usr/bin/env python3
"""Memory-bounded Arabic dubbing for Billionaire Granny using a prior time-coded transcript.

Runs inside a real Google Colab runtime after the Drive mount succeeds.
The source video is downloaded to local Colab disk; translations, resumable TTS
checkpoints, subtitles, progress, final MP4 and its quality report are saved to
the mounted Drive. No full video/audio track is loaded into RAM.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

SOURCE_ID = "1sMis6qi_j3AsBvAEL2mliPRIKf0s3-uI"
SOURCE_NAME = "Billionaire Granny Takes Home Fainted Pregnant Woman - Original Quality.mkv"
DEFAULT_SOURCE_URL = "https://drive.google.com/file/d/1sMis6qi_j3AsBvAEL2mliPRIKf0s3-uI/view?usp=drivesdk"
SOURCE_URL = os.getenv("SOURCE_URL", DEFAULT_SOURCE_URL).strip()
METADATA_URL = os.getenv("METADATA_URL", "").strip()

DRIVE_ROOT = Path("/content/drive/MyDrive")
DRIVE_FOLDER = DRIVE_ROOT / "Netflix_Arabic_Dubs"
BASE_CHECKPOINT_DIR = DRIVE_FOLDER / "Billionaire_Granny_CEO_Checkpoints"
OUTPUT_FOLDER = DRIVE_FOLDER
WORK_ROOT = Path("/content/billionaire_granny_dubbing")
SOURCE_PATH = WORK_ROOT / SOURCE_NAME
AUDIO_PATH = WORK_ROOT / "source_audio_24k_mono.wav"
CLIPS_DIR = WORK_ROOT / "tts_clips"
LOCAL_OUTPUT = WORK_ROOT / "output"
LOCAL_PROGRESS = LOCAL_OUTPUT / "progress.json"
LOCAL_LOG = LOCAL_OUTPUT / "progress.log"
LOCAL_SEGMENTS = LOCAL_OUTPUT / "segments_ar.json"
LOCAL_SRT = LOCAL_OUTPUT / "Billionaire_Granny_CEO_Full_Arabic_Subtitles.srt"
LOCAL_REPORT = LOCAL_OUTPUT / "quality_report.json"
LOCAL_FINAL = LOCAL_OUTPUT / "Billionaire_Granny_CEO_Full_Arabic_Dub.mp4"

FINAL_NAME = "Billionaire_Granny_CEO_Full_Arabic_Dub.mp4"
SRT_NAME = "Billionaire_Granny_CEO_Full_Arabic_Subtitles.srt"
SEGMENTS_NAME = "Billionaire_Granny_CEO_Dubbing_Metadata.json"
REPORT_NAME = "Billionaire_Granny_CEO_Quality_Report.json"
PROGRESS_NAME = "Billionaire_Granny_CEO_Progress.json"

SAMPLE_RATE = 24000
STARTED_AT = datetime.now(timezone.utc).isoformat()
STAGE = "starting"
SOURCE_SHA256 = ""
METADATA_SHA256 = ""
CHECKPOINT_DIR: Path | None = None
VOICE_MAP = {
    "SPEAKER_00_HEROINE": "ar-SA-ZariyahNeural",
    "SPEAKER_01_GRANNY": "ar-EG-SalmaNeural",
    "SPEAKER_02_CEO": "ar-SA-HamedNeural",
    "SPEAKER_03_SUPPORT": "ar-EG-ShakirNeural",
}
VOICE_ROLE_FALLBACKS = {
    "البطلة الشابة": "ar-SA-ZariyahNeural",
    "البطلة": "ar-SA-ZariyahNeural",
    "الجدة": "ar-EG-SalmaNeural",
    "سيدة ناضجة": "ar-EG-SalmaNeural",
    "الرئيس التنفيذي": "ar-SA-HamedNeural",
    "البطل": "ar-SA-HamedNeural",
    "رجل": "ar-EG-ShakirNeural",
    "شخصية ثانوية": "ar-EG-ShakirNeural",
}

ARABIC_EMOTION_RULES = [
    ("whispers", re.compile(r"(بصوت منخفض|همس|لا يسمعنا أحد|بيننا سر|لا تخبر أحد|لا تخبري أحد|سر[اًًا])")),
    ("sad", re.compile(r"(آسف|آسفة|حزين|حزينة|اشتقت|وداعاً|وداعًا|فقدت|مات|ماتت|لم أعد أستطيع|أرجوك لا)")),
    ("angry", re.compile(r"(غاضب|غاضبة|اخرج|اخرجي|كيف تجرؤ|كيف تجرئين|أكره|مستحيل|اصمت|اصمتي|توقف فوراً|توقف فورًا)")),
    ("excited", re.compile(r"(رائع|مذهل|نجحنا|فزنا|أخيراً|أخيرًا|يا إلهي|لا أصدق|خبر رائع|!)")),
    ("laughs", re.compile(r"(هههه|هاها|يضحك|تضحك|قهقه|ضحك)")),
]


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    line = f"[{now_utc()}] {message}"
    print(line, flush=True)
    LOCAL_OUTPUT.mkdir(parents=True, exist_ok=True)
    with LOCAL_LOG.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
        handle.flush()


def atomic_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def copy_stream(src: Path, dst: Path, label: str) -> None:
    """Stream copies in fixed-size blocks; do not materialize large files in RAM."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    temp = dst.with_name(dst.name + ".part")
    total = src.stat().st_size
    moved = 0
    with src.open("rb") as reader, temp.open("wb") as writer:
        while True:
            block = reader.read(8 * 1024 * 1024)
            if not block:
                break
            writer.write(block)
            moved += len(block)
            if moved >= total or moved % (512 * 1024 * 1024) < len(block):
                log(f"{label}: {moved / max(total, 1) * 100:.1f}% ({moved:,}/{total:,} bytes)")
        writer.flush()
        os.fsync(writer.fileno())
    if temp.stat().st_size != total:
        raise RuntimeError(f"Size mismatch while copying {label}.")
    try:
        os.replace(temp, dst)
    except OSError:
        shutil.copyfile(temp, dst)
        temp.unlink(missing_ok=True)
    if dst.stat().st_size != total:
        raise RuntimeError(f"Destination size mismatch while copying {label}.")


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
                log(f"Hash {label}: {read / max(total, 1) * 100:.1f}%")
    return digest.hexdigest()


def update_progress(stage: str, **extra) -> None:
    global STAGE
    STAGE = stage
    row = {
        "task": "Billionaire Granny Arabic dubbing",
        "status": "IN_PROGRESS",
        "stage": stage,
        "started_at_utc": STARTED_AT,
        "updated_at_utc": now_utc(),
        "source_file_id": SOURCE_ID,
        "source_sha256": SOURCE_SHA256 or None,
        "metadata_sha256": METADATA_SHA256 or None,
        **extra,
    }
    atomic_json(LOCAL_PROGRESS, row)
    log(f"STAGE={stage}")
    try:
        copy_stream(LOCAL_PROGRESS, DRIVE_FOLDER / PROGRESS_NAME, "Drive progress update")
    except Exception as exc:
        log(f"WARNING: Drive progress sync failed ({type(exc).__name__}); local progress remains available.")


def run_stream(command: list[str], *, cwd: Path | None = None, env: dict | None = None,
               label: str | None = None) -> None:
    log("Running: " + (label or command[0]))
    full_env = os.environ.copy()
    if env:
        full_env.update(env)
    with LOCAL_LOG.open("a", encoding="utf-8") as output:
        process = subprocess.Popen(
            [str(item) for item in command],
            cwd=str(cwd) if cwd else None,
            env=full_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            errors="replace",
            bufsize=1,
        )
        assert process.stdout is not None
        try:
            for line in process.stdout:
                print(line, end="", flush=True)
                output.write(line)
                output.flush()
            code = process.wait()
        except Exception:
            if process.poll() is None:
                process.kill()
            process.wait()
            raise
    if code:
        raise RuntimeError(f"Command failed with exit code {code}: {label or command[0]}")


def mem_info_gib() -> tuple[float, float]:
    values = {}
    for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
        key, _, rest = line.partition(":")
        if rest.strip().endswith("kB"):
            values[key] = int(rest.strip().split()[0]) / (1024 * 1024)
    return float(values.get("MemTotal", 0)), float(values.get("MemAvailable", 0))


def probe_json(command: list[str], label: str) -> dict:
    log("Running: " + label)
    result = subprocess.run(command, capture_output=True, text=True, errors="replace")
    if result.returncode:
        raise RuntimeError(f"{label} failed: {(result.stderr or result.stdout)[-2000:]}")
    return json.loads(result.stdout)


def ensure_drive_writable() -> None:
    if not DRIVE_ROOT.is_dir():
        raise RuntimeError(
            "Google Drive is not mounted at /content/drive/MyDrive. "
            "The run stopped before downloading the video or installing TTS models."
        )
    DRIVE_FOLDER.mkdir(parents=True, exist_ok=True)
    BASE_CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    marker = DRIVE_FOLDER / ".colab_dub_write_probe.tmp"
    try:
        marker.write_text("ok", encoding="utf-8")
        marker.unlink()
    except Exception as exc:
        raise RuntimeError(f"Google Drive mounted but the output folder is not writable: {type(exc).__name__}") from exc


def download_metadata() -> tuple[dict, list[dict]]:
    global METADATA_SHA256
    if not METADATA_URL:
        raise RuntimeError("METADATA_URL is empty; the previous 864-segment transcript is required.")
    update_progress("downloading_prior_segment_metadata")
    response = requests.get(METADATA_URL, timeout=90)
    response.raise_for_status()
    raw = response.content
    if len(raw) < 10_000 or len(raw) > 10_000_000:
        raise RuntimeError(f"Metadata size is unexpected: {len(raw):,} bytes.")
    METADATA_SHA256 = hashlib.sha256(raw).hexdigest()
    metadata = json.loads(raw.decode("utf-8"))
    segments = metadata.get("segments")
    if not isinstance(segments, list) or len(segments) < 800:
        raise RuntimeError("The prior segment metadata does not contain the expected time-coded dialogue.")
    if metadata.get("target_language") not in (None, "ar"):
        raise RuntimeError(f"Unexpected target language in existing metadata: {metadata.get('target_language')!r}")
    for i, seg in enumerate(segments):
        if not isinstance(seg, dict) or not str(seg.get("text", "")).strip():
            raise RuntimeError(f"Transcript segment {i} is missing source text.")
        if float(seg.get("end", 0)) <= float(seg.get("start", -1)):
            raise RuntimeError(f"Transcript segment {i} has invalid timestamps.")
    speakers = sorted({str(seg.get("speaker", "SPEAKER_UNKNOWN")) for seg in segments})
    log(f"Loaded {len(segments)} time-coded source segments and {len(speakers)} existing speaker clusters.")
    log("Metadata source language: " + str(metadata.get("detected_source_language", "unknown")))
    atomic_json(LOCAL_OUTPUT / "metadata_source_summary.json", {
        "video_id": metadata.get("video_id"),
        "title": metadata.get("title"),
        "duration_seconds": metadata.get("duration_seconds"),
        "source_language": metadata.get("detected_source_language"),
        "segments": len(segments),
        "speakers": speakers,
        "metadata_sha256": METADATA_SHA256,
    })
    return metadata, segments


def ensure_gdown() -> None:
    try:
        import gdown  # noqa: F401
        return
    except Exception:
        pass
    run_stream([sys.executable, "-m", "pip", "install", "--no-cache-dir", "gdown"], label="Install Google Drive downloader")


def obtain_source() -> tuple[Path, dict]:
    global SOURCE_SHA256
    update_progress("downloading_source_video")
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    if not SOURCE_PATH.is_file() or SOURCE_PATH.stat().st_size < 1_000_000_000:
        ensure_gdown()
        part = SOURCE_PATH.with_suffix(".mkv.part")
        part.unlink(missing_ok=True)
        run_stream([
            sys.executable, "-m", "gdown", "--fuzzy", "--continue",
            SOURCE_URL, "--output", str(part),
        ], label="Download the shared Drive source video to local Colab disk")
        if not part.is_file() or part.stat().st_size < 1_000_000_000:
            raise RuntimeError("The Google Drive download appears incomplete or smaller than expected.")
        os.replace(part, SOURCE_PATH)
    source_size = SOURCE_PATH.stat().st_size
    if source_size < 1_000_000_000:
        raise RuntimeError(f"Unexpected source file size: {source_size:,} bytes.")
    SOURCE_SHA256 = sha256_file(SOURCE_PATH, "source video")
    info = probe_json([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,format_name:stream=codec_type,codec_name,width,height",
        "-of", "json", str(SOURCE_PATH),
    ], "Validate the downloaded source")
    streams = info.get("streams", [])
    duration = float((info.get("format") or {}).get("duration") or 0)
    if duration < 7000 or not any(s.get("codec_type") == "video" for s in streams) or not any(s.get("codec_type") == "audio" for s in streams):
        raise RuntimeError("Source duration or audio/video streams failed validation.")
    log(f"Source video validated: {duration:.2f}s, {source_size:,} bytes.")
    return SOURCE_PATH, {
        "source_name": SOURCE_NAME,
        "source_file_id": SOURCE_ID,
        "source_sha256": SOURCE_SHA256,
        "source_size_bytes": source_size,
        "duration_seconds": duration,
        "ffprobe": info,
    }


def save_translation_checkpoint(segments: list[dict], source_meta: dict) -> None:
    payload = {
        "schema": 1,
        "source_file_id": SOURCE_ID,
        "source_sha256": SOURCE_SHA256,
        "metadata_sha256": METADATA_SHA256,
        "updated_at_utc": now_utc(),
        "segments": segments,
        "translation_complete": all(str(s.get("ar_text", "")).strip() for s in segments),
    }
    atomic_json(LOCAL_SEGMENTS, payload)
    copy_stream(LOCAL_SEGMENTS, CHECKPOINT_DIR / "segments_ar.json", "Drive translation checkpoint")


def translate_segments(segments: list[dict], source_meta: dict) -> list[dict]:
    from deep_translator import GoogleTranslator

    update_progress("translating_dialogue_to_arabic", segment_count=len(segments))
    saved_path = CHECKPOINT_DIR / "segments_ar.json"
    if saved_path.is_file():
        try:
            saved = json.loads(saved_path.read_text(encoding="utf-8"))
            if saved.get("source_sha256") == SOURCE_SHA256 and saved.get("metadata_sha256") == METADATA_SHA256:
                prior = saved.get("segments") or []
                if len(prior) == len(segments):
                    for i, row in enumerate(prior):
                        if row.get("text") == segments[i].get("text") and row.get("start") == segments[i].get("start"):
                            segments[i]["ar_text"] = row.get("ar_text", "")
                            segments[i]["emotion"] = row.get("emotion", "")
                            segments[i]["tts_rate"] = row.get("tts_rate", "+0%")
                            segments[i]["tts_pitch"] = row.get("tts_pitch", "+0Hz")
                    log(f"Restored {sum(bool(s.get('ar_text')) for s in segments)}/{len(segments)} translated segments from Drive.")
        except Exception as exc:
            log(f"Existing translation checkpoint could not be read ({type(exc).__name__}); translating missing segments.")

    def translate_one(item: tuple[int, str]) -> tuple[int, str, str | None]:
        index, source_text = item
        error_type = None
        for attempt in range(4):
            try:
                translator = GoogleTranslator(source="auto", target="ar")
                result = translator.translate(source_text.strip())
                if result and result.strip():
                    return index, result.strip(), None
                error_type = "empty translation"
            except Exception as exc:
                error_type = type(exc).__name__
            time.sleep(min(1.5 * (attempt + 1), 6))
        return index, "", error_type or "translation failed"

    missing = [(i, str(seg["text"])) for i, seg in enumerate(segments) if not str(seg.get("ar_text", "")).strip()]
    log(f"Translations missing at start: {len(missing)}.")
    done_since_checkpoint = 0
    errors = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = [pool.submit(translate_one, item) for item in missing]
        for completed, future in enumerate(as_completed(futures), 1):
            index, arabic_text, error = future.result()
            if arabic_text:
                segments[index]["ar_text"] = arabic_text
                done_since_checkpoint += 1
            else:
                errors.append({"index": index + 1, "error_type": error})
            if done_since_checkpoint >= 25:
                save_translation_checkpoint(segments, source_meta)
                update_progress("translating_dialogue_to_arabic",
                                translated=sum(bool(s.get("ar_text")) for s in segments),
                                total=len(segments), translation_errors=len(errors))
                done_since_checkpoint = 0
            if completed % 50 == 0 or completed == len(futures):
                log(f"Translation responses processed: {completed}/{len(futures)}.")
    # Fill emotion and voice/prosody hints after translation.
    for seg in segments:
        text = str(seg.get("ar_text", "")).strip()
        for tag, pattern in ARABIC_EMOTION_RULES:
            if pattern.search(text):
                emotion = tag
                break
        else:
            emotion = "neutral"
        if emotion == "whispers":
            rate, pitch = "-7%", "-2Hz"
        elif emotion == "sad":
            rate, pitch = "-5%", "-2Hz"
        elif emotion == "angry":
            rate, pitch = "+6%", "+2Hz"
        elif emotion == "excited":
            rate, pitch = "+7%", "+3Hz"
        elif emotion == "laughs":
            rate, pitch = "+4%", "+1Hz"
        else:
            rate, pitch = "+0%", "+0Hz"
        seg["emotion"] = emotion
        seg["tts_rate"] = rate
        seg["tts_pitch"] = pitch

    if errors:
        log(f"Translation failure count: {len(errors)}; details are only written to the private Drive checkpoint.")
    if any(not str(seg.get("ar_text", "")).strip() for seg in segments):
        atomic_json(CHECKPOINT_DIR / "translation_errors.json", errors)
        save_translation_checkpoint(segments, source_meta)
        raise RuntimeError(
            f"{sum(not str(s.get('ar_text', '').strip()) for s in segments)} source segments could not be translated. "
            "The translated segments already saved to Drive can be reused on the next run."
        )

    alphabetic = arabic_chars = 0
    for seg in segments:
        for char in str(seg.get("ar_text", "")):
            if char.isalpha():
                alphabetic += 1
                if "\u0600" <= char <= "\u06ff" or "\ufb50" <= char <= "\ufdff" or "\ufe70" <= char <= "\ufeff":
                    arabic_chars += 1
    ratio = arabic_chars / max(1, alphabetic)
    if ratio < 0.60:
        raise RuntimeError(f"Arabic-text coverage is too low ({ratio:.1%}); refusing to label the task as translated.")
    save_translation_checkpoint(segments, source_meta)
    update_progress("translation_complete", translated=len(segments), arabic_text_coverage=round(ratio, 4))
    log(f"Arabic text coverage verified: {ratio:.1%}.")
    return segments


def choose_voice(segment: dict) -> str:
    speaker = str(segment.get("speaker", ""))
    if speaker in VOICE_MAP:
        return VOICE_MAP[speaker]
    role = str(segment.get("role_ar", ""))
    for key, voice in VOICE_ROLE_FALLBACKS.items():
        if key in role:
            return voice
    voice = str(segment.get("default_voice", ""))
    if voice.startswith("ar-"):
        return voice
    return "ar-EG-ShakirNeural"


def verify_voice_availability(segments: list[dict]) -> None:
    import edge_tts

    async def get_names() -> set[str]:
        voices = await edge_tts.list_voices()
        return {str(row.get("ShortName", "")) for row in voices}

    names = asyncio.run(get_names())
    requested = {choose_voice(s) for s in segments}
    missing = sorted(requested - names)
    if missing:
        raise RuntimeError("Required Arabic neural voices are unavailable in this Edge-TTS session: " + ", ".join(missing))
    log("Arabic neural voices verified: " + ", ".join(sorted(requested)))


def load_clip_manifest(path: Path) -> dict:
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"schema": 1, "source_sha256": SOURCE_SHA256, "metadata_sha256": METADATA_SHA256, "clips": {}}


def restore_tts_checkpoints() -> dict:
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    for archive_drive in sorted(CHECKPOINT_DIR.glob("tts_checkpoint_*.tar.gz")):
        archive_local = WORK_ROOT / archive_drive.name
        try:
            copy_stream(archive_drive, archive_local, archive_drive.name)
            with tarfile.open(archive_local, "r:gz") as tar:
                root = CLIPS_DIR.resolve()
                for member in tar.getmembers():
                    dest = (CLIPS_DIR / member.name).resolve()
                    if not dest.is_relative_to(root):
                        raise RuntimeError("Unsafe path in TTS checkpoint.")
                tar.extractall(CLIPS_DIR)
        except Exception as exc:
            log(f"WARNING: checkpoint restore skipped for {archive_drive.name} ({type(exc).__name__}).")
        finally:
            archive_local.unlink(missing_ok=True)
    manifest_path = CLIPS_DIR / "clip_manifest.json"
    manifest = load_clip_manifest(manifest_path)
    if manifest.get("source_sha256") != SOURCE_SHA256 or manifest.get("metadata_sha256") != METADATA_SHA256:
        manifest = {"schema": 1, "source_sha256": SOURCE_SHA256, "metadata_sha256": METADATA_SHA256, "clips": {}}
    return manifest


def checkpoint_new_clips(new_indices: list[int], manifest: dict, batch_no: int) -> None:
    if not new_indices:
        return
    manifest_path = CLIPS_DIR / "clip_manifest.json"
    atomic_json(manifest_path, manifest)
    archive_path = WORK_ROOT / f"tts_checkpoint_{batch_no:05d}.tar.gz"
    with tarfile.open(archive_path, "w:gz", compresslevel=1) as tar:
        for index in new_indices:
            clip = CLIPS_DIR / f"clip_{index + 1:05d}.mp3"
            if clip.is_file():
                tar.add(clip, arcname=clip.name)
        tar.add(manifest_path, arcname=manifest_path.name)
    copy_stream(archive_path, CHECKPOINT_DIR / archive_path.name, archive_path.name)
    archive_path.unlink(missing_ok=True)
    log(f"Drive TTS checkpoint saved: {batch_no}; new clips={len(new_indices)}.")


async def _synth_one(index: int, segment: dict, semaphore: asyncio.Semaphore,
                     manifest: dict, manifest_lock: asyncio.Lock) -> tuple[int, bool]:
    import edge_tts

    arabic_text = str(segment.get("ar_text", "")).strip()
    if not arabic_text:
        return index, False
    voice = choose_voice(segment)
    rate = str(segment.get("tts_rate", "+0%"))
    pitch = str(segment.get("tts_pitch", "+0Hz"))
    fingerprint = hashlib.sha256(f"{arabic_text}\n{voice}\n{rate}\n{pitch}".encode("utf-8")).hexdigest()
    clip = CLIPS_DIR / f"clip_{index + 1:05d}.mp3"
    old = manifest.get("clips", {}).get(str(index))
    if clip.is_file() and clip.stat().st_size > 200 and old and old.get("fingerprint") == fingerprint:
        return index, True

    async with semaphore:
        for attempt in range(4):
            temp = clip.with_suffix(".mp3.part")
            try:
                communicator = edge_tts.Communicate(arabic_text, voice, rate=rate, pitch=pitch)
                await communicator.save(str(temp))
                if temp.is_file() and temp.stat().st_size > 200:
                    os.replace(temp, clip)
                    clip_hash = sha256_file(clip, clip.name)
                    async with manifest_lock:
                        manifest.setdefault("clips", {})[str(index)] = {
                            "fingerprint": fingerprint,
                            "sha256": clip_hash,
                            "voice": voice,
                            "emotion": segment.get("emotion", "neutral"),
                            "rate": rate,
                            "pitch": pitch,
                            "bytes": clip.stat().st_size,
                        }
                    return index, True
            except Exception as exc:
                error_type = type(exc).__name__
                log(f"TTS retry {attempt + 1}/4 for segment {index + 1}: {error_type}.")
            await asyncio.sleep(min(1.5 * (attempt + 1), 6))
            temp.unlink(missing_ok=True)
    return index, False


async def synthesize_all(segments: list[dict], manifest: dict) -> dict:
    update_progress("synthesizing_arabic_voice_segments", segments=len(segments))
    semaphore = asyncio.Semaphore(12)
    manifest_lock = asyncio.Lock()
    tasks = [_synth_one(i, seg, semaphore, manifest, manifest_lock) for i, seg in enumerate(segments)]
    new_indices = []
    batch_no = 1 + sum(1 for _ in CHECKPOINT_DIR.glob("tts_checkpoint_*.tar.gz"))
    ok_count = 0
    for finished, coro in enumerate(asyncio.as_completed(tasks), 1):
        index, succeeded = await coro
        if succeeded:
            ok_count += 1
            if manifest.get("clips", {}).get(str(index), {}).get("fingerprint") is not None:
                local_clip = CLIPS_DIR / f"clip_{index + 1:05d}.mp3"
                # A restored checkpoint can be present before synthesis. Only archive newly created files
                # that have not yet been persisted by an earlier checkpoint.
                if index not in new_indices and not any(
                    rec.get("sha256") == manifest.get("clips", {}).get(str(index), {}).get("sha256")
                    for rec in []
                ):
                    new_indices.append(index)
        if finished % 25 == 0 or finished == len(tasks):
            checkpoint_new_clips(new_indices, manifest, batch_no)
            new_indices.clear()
            batch_no += 1
            update_progress("synthesizing_arabic_voice_segments",
                            finished=finished, total=len(tasks), successful=ok_count)
            log(f"TTS completed: {finished}/{len(tasks)}; successful clips={ok_count}.")
    missing = [
        i + 1 for i, seg in enumerate(segments)
        if not (CLIPS_DIR / f"clip_{i + 1:05d}.mp3").is_file()
        or (CLIPS_DIR / f"clip_{i + 1:05d}.mp3").stat().st_size <= 200
    ]
    if missing:
        atomic_json(CHECKPOINT_DIR / "tts_missing_segments.json", missing)
        raise RuntimeError(f"TTS failed for {len(missing)} segments; no final video will be published until these are regenerated.")
    atomic_json(CLIPS_DIR / "clip_manifest.json", manifest)
    return manifest


def fmt_srt_time(value: float) -> str:
    ms = max(0, int(round(float(value) * 1000)))
    hours, rem = divmod(ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    seconds, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def create_subtitles(segments: list[dict]) -> float:
    rows = []
    chars = arabic_chars = 0
    for i, seg in enumerate(segments, 1):
        text = str(seg.get("ar_text", "")).strip()
        if not text:
            continue
        for c in text:
            if c.isalpha():
                chars += 1
                if "\u0600" <= c <= "\u06ff" or "\ufb50" <= c <= "\ufdff" or "\ufe70" <= c <= "\ufeff":
                    arabic_chars += 1
        start = max(0.0, float(seg["start"]))
        end = max(start + 0.08, float(seg["end"]))
        role = str(seg.get("role_ar", seg.get("speaker", ""))).strip()
        rows.append(f"{len(rows) + 1}\n{fmt_srt_time(start)} --> {fmt_srt_time(end)}\n[{role}] {text}")
    LOCAL_SRT.write_text("\n\n".join(rows) + "\n", encoding="utf-8")
    return arabic_chars / max(1, chars)


def render_dub_track(segments: list[dict], duration: float) -> Path:
    import numpy as np
    import soundfile as sf

    update_progress("aligning_voice_clips_and_mixing")
    # The source track is PCM16 mono and is read sequentially. The dub track is
    # a disk-backed memmap, so several hours of audio never sit in RAM at once.
    if not AUDIO_PATH.is_file():
        run_stream([
            "ffmpeg", "-y", "-v", "error", "-i", str(SOURCE_PATH),
            "-map", "0:a:0", "-vn", "-af", "pan=mono|c0=0.5*c0+0.5*c1",
            "-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", str(AUDIO_PATH),
        ], label="Extract low-memory 24 kHz mono original ambience track")
    bg_info = sf.info(str(AUDIO_PATH))
    total_samples = int(round(float(duration) * SAMPLE_RATE))
    if bg_info.samplerate != SAMPLE_RATE or bg_info.channels != 1 or bg_info.frames < total_samples * 0.98:
        raise RuntimeError("The extracted original ambience track has unexpected sample rate/channels/duration.")

    track_path = WORK_ROOT / "dub_track_float32.memmap"
    dub_track = np.memmap(track_path, dtype=np.float32, mode="w+", shape=(bg_info.frames,))
    dub_track[:] = 0.0
    intervals = []
    used = 0
    for i, seg in enumerate(segments):
        clip_path = CLIPS_DIR / f"clip_{i + 1:05d}.mp3"
        wav_path = CLIPS_DIR / f"clip_{i + 1:05d}.wav"
        start_seconds = max(0.0, float(seg["start"]))
        end_seconds = max(start_seconds + 0.08, float(seg["end"]))
        target_duration = max(0.25, end_seconds - start_seconds)
        try:
            # Mutagen reads MP3 frame metadata without loading decoded audio into RAM.
            from mutagen.mp3 import MP3
            clip_duration = float(MP3(str(clip_path)).info.length)
        except Exception:
            clip_duration = 0.0
        if clip_duration <= 0:
            raise RuntimeError(f"Could not read the duration of TTS clip {i + 1}.")
        atempo = min(1.35, max(1.0, clip_duration / target_duration))
        filters = f"atempo={atempo:.4f}" if atempo > 1.01 else "anull"
        convert = subprocess.run([
            "ffmpeg", "-y", "-v", "error", "-i", str(clip_path),
            "-af", filters, "-ar", str(SAMPLE_RATE), "-ac", "1",
            "-c:a", "pcm_s16le", str(wav_path),
        ], capture_output=True, text=True, errors="replace")
        if convert.returncode or not wav_path.is_file():
            raise RuntimeError(f"Could not prepare TTS clip {i + 1}: {(convert.stderr or '')[-400:]}")
        clip_samples, _ = sf.read(str(wav_path), dtype="float32")
        start_sample = int(round(start_seconds * SAMPLE_RATE))
        if start_sample >= total_samples:
            continue
        end_sample = min(total_samples, start_sample + len(clip_samples))
        if end_sample <= start_sample:
            continue
        clip_samples = clip_samples[:end_sample - start_sample]
        dub_track[start_sample:end_sample] += clip_samples
        intervals.append((start_sample, end_sample))
        used += 1
        if (i + 1) % 100 == 0:
            dub_track.flush()
            log(f"Voice clips aligned: {i + 1}/{len(segments)}; placed={used}.")

    dub_track.flush()
    # Stream-mix 10-second blocks. Original dialogue/music stays at low volume;
    # the new Arabic dialogue is prominent, with a lower bed during speaking.
    mixed_path = WORK_ROOT / "final_master_arabic.wav"
    interval_idx = 0
    block_frames = SAMPLE_RATE * 10
    with sf.SoundFile(str(AUDIO_PATH), "r") as bg, sf.SoundFile(
        str(mixed_path), "w", samplerate=SAMPLE_RATE, channels=1, subtype="PCM_16"
    ) as out:
        cursor = 0
        while cursor < bg_info.frames:
            frames = min(block_frames, bg_info.frames - cursor)
            background = bg.read(frames, dtype="float32")
            overlay = np.asarray(dub_track[cursor:cursor + frames], dtype=np.float32)
            envelope = np.full(frames, 0.12, dtype=np.float32)
            block_end = cursor + frames
            while interval_idx < len(intervals) and intervals[interval_idx][1] <= cursor:
                interval_idx += 1
            j = interval_idx
            while j < len(intervals) and intervals[j][0] < block_end:
                a, b = intervals[j]
                lo = max(a, cursor) - cursor
                hi = min(b, block_end) - cursor
                if hi > lo:
                    envelope[lo:hi] = 0.04
                j += 1
            mixed = np.clip(background * envelope + overlay * 1.08, -0.98, 0.98)
            out.write(mixed.astype(np.float32))
            cursor += frames
            if cursor % (SAMPLE_RATE * 600) < frames:
                log(f"Streaming audio mix: {cursor / max(1, bg_info.frames) * 100:.1f}%.")
    del dub_track
    track_path.unlink(missing_ok=True)
    log(f"Built master Arabic audio track: {mixed_path.stat().st_size:,} bytes.")
    return mixed_path


def render_and_verify(source: Path, source_info: dict, metadata: dict,
                      segments: list[dict], manifest: dict) -> dict:
    update_progress("rendering_final_mp4")
    audio_master = render_dub_track(segments, float(source_info["duration_seconds"]))
    LOCAL_FINAL.unlink(missing_ok=True)
    first = subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-i", str(source), "-i", str(audio_master),
        "-filter_complex",
        "[0:a:0]volume=0.12[original];[1:a:0]volume=1.0[arabic];"
        "[original][arabic]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]",
        "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k", "-t", f"{float(source_info['duration_seconds']):.3f}",
        "-movflags", "+faststart", str(LOCAL_FINAL),
    ], capture_output=True, text=True, errors="replace")
    if first.returncode or not LOCAL_FINAL.is_file() or LOCAL_FINAL.stat().st_size < 1_000_000_000:
        LOCAL_FINAL.unlink(missing_ok=True)
        log("Video stream-copy mux failed; trying H.264 fallback.")
        run_stream([
            "ffmpeg", "-y", "-v", "error", "-i", str(source), "-i", str(audio_master),
            "-filter_complex",
            "[0:a:0]volume=0.12[original];[1:a:0]volume=1.0[arabic];"
            "[original][arabic]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]",
            "-map", "0:v:0", "-map", "[aout]", "-c:v", "libx264", "-preset", "veryfast",
            "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-t", f"{float(source_info['duration_seconds']):.3f}", "-movflags", "+faststart", str(LOCAL_FINAL),
        ], label="Re-encode source video and mux finished Arabic audio")

    final_probe = probe_json([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,format_name:stream=codec_type,codec_name,width,height,sample_rate,channels",
        "-of", "json", str(LOCAL_FINAL),
    ], "Validate the final MP4")
    streams = final_probe.get("streams", [])
    final_duration = float((final_probe.get("format") or {}).get("duration") or 0)
    if not any(s.get("codec_type") == "video" for s in streams):
        raise RuntimeError("Final MP4 is missing its video stream.")
    if not any(s.get("codec_type") == "audio" and s.get("codec_name") == "aac" for s in streams):
        raise RuntimeError("Final MP4 is missing an AAC audio stream.")
    if abs(final_duration - float(source_info["duration_seconds"])) > 3:
        raise RuntimeError(f"Final duration differs from the source by more than 3 seconds ({final_duration:.2f}s).")
    run_stream(["ffmpeg", "-v", "error", "-i", str(LOCAL_FINAL), "-f", "null", "-"],
               label="Full decode verification of the final MP4")
    arabic_ratio = create_subtitles(segments)
    if arabic_ratio < 0.60:
        raise RuntimeError(f"Arabic subtitle text coverage is too low ({arabic_ratio:.1%}).")
    if len(manifest.get("clips", {})) < len(segments):
        raise RuntimeError("TTS manifest does not contain a completed clip record for every source segment.")

    final_sha = sha256_file(LOCAL_FINAL, "final MP4")
    source_probe = source_info.get("ffprobe", {})
    speaker_profiles = {}
    for seg in segments:
        key = str(seg.get("speaker", "SPEAKER_UNKNOWN"))
        if key not in speaker_profiles:
            speaker_profiles[key] = {
                "role_ar": seg.get("role_ar", key),
                "synthetic_voice": choose_voice(seg),
                "segments": 0,
            }
        speaker_profiles[key]["segments"] += 1
    report = {
        "status": "AUDIO_DUB_FINAL_VERIFIED",
        "source_name": SOURCE_NAME,
        "source_file_id": SOURCE_ID,
        "source_sha256": source_info["source_sha256"],
        "source_size_bytes": source_info["source_size_bytes"],
        "source_duration_seconds": round(float(source_info["duration_seconds"]), 3),
        "source_dimensions": {
            "width": next((s.get("width") for s in source_probe.get("streams", []) if s.get("codec_type") == "video"), None),
            "height": next((s.get("height") for s in source_probe.get("streams", []) if s.get("codec_type") == "video"), None),
        },
        "source_language": metadata.get("detected_source_language", "en"),
        "target_language": "ar",
        "transcription_source": "reused prior 864-segment transcript with source timestamps",
        "speaker_identification": "reused existing speaker clusters; fixed distinct Arabic synthetic voice per cluster",
        "segment_count": len(segments),
        "speaker_count": len(speaker_profiles),
        "speaker_profiles": speaker_profiles,
        "tts_engine": "Microsoft Edge neural TTS via edge-tts",
        "expressive_delivery": "heuristic prosody per translated segment; Edge-TTS voice service does not provide guaranteed emotion control",
        "emotion_distribution": {
            tag: sum(1 for seg in segments if seg.get("emotion") == tag)
            for tag in sorted({str(seg.get("emotion", "neutral")) for seg in segments})
        },
        "timing_alignment": "Each synthesized line is positioned at the source segment start; FFmpeg atempo up to 1.35x is used where a clip exceeds the source time window.",
        "arabic_text_coverage": round(arabic_ratio, 4),
        "generated_tts_segments": len(manifest.get("clips", {})),
        "final_filename": FINAL_NAME,
        "final_size_bytes": LOCAL_FINAL.stat().st_size,
        "final_sha256": final_sha,
        "final_duration_seconds": round(final_duration, 3),
        "ffprobe_stream_check": "passed",
        "full_ffmpeg_decode": "passed",
        "original_audio_underlay": 0.12,
        "visual_lip_sync": {
            "status": "NOT_PERFORMED",
            "reason": "This pipeline aligns dubbed audio to dialogue timestamps but does not detect faces and synthesize lip/mouth movement in the video."
        },
        "production_quality_note": "Automated full-length Arabic multi-speaker audio dub, with separate synthetic neural voices, timestamp fitting, and reduced original audio bed. Not certified as Netflix-level without human translation/audio QC and a separate visual lip-sync process.",
        "completed_at_utc": now_utc(),
    }
    atomic_json(LOCAL_REPORT, report)
    atomic_json(LOCAL_OUTPUT / "source_info.json", source_info)
    atomic_json(LOCAL_OUTPUT / "run_manifest.json", {
        "source_file_id": SOURCE_ID,
        "source_sha256": SOURCE_SHA256,
        "metadata_sha256": METADATA_SHA256,
        "segments": len(segments),
        "speaker_count": len(speaker_profiles),
        "status": "AUDIO_DUB_FINAL_VERIFIED",
        "completed_at_utc": now_utc(),
    })
    # Copy video and small sidecars to the mounted Drive only after local checks pass.
    update_progress("uploading_final_outputs_to_drive", final_size_bytes=LOCAL_FINAL.stat().st_size)
    drive_final = DRIVE_FOLDER / FINAL_NAME
    copy_stream(LOCAL_FINAL, drive_final, "Final MP4 upload to Google Drive")
    drive_sha = sha256_file(drive_final, "final MP4 on Drive")
    if drive_sha != final_sha:
        raise RuntimeError("SHA-256 mismatch for the uploaded Drive MP4.")
    copy_stream(LOCAL_SRT, DRIVE_FOLDER / SRT_NAME, "Arabic subtitles to Drive")
    copy_stream(LOCAL_SEGMENTS, DRIVE_FOLDER / SEGMENTS_NAME, "Dubbing metadata to Drive")
    copy_stream(LOCAL_REPORT, DRIVE_FOLDER / REPORT_NAME, "Quality report to Drive")
    atomic_json(DRIVE_FOLDER / "Billionaire_Granny_CEO_Run_Manifest.json", {
        "status": "AUDIO_DUB_FINAL_VERIFIED",
        "source_sha256": SOURCE_SHA256,
        "final_sha256": drive_sha,
        "final_size_bytes": drive_final.stat().st_size,
        "final_path": str(drive_final),
        "subtitle_path": str(DRIVE_FOLDER / SRT_NAME),
        "report_path": str(DRIVE_FOLDER / REPORT_NAME),
        "completed_at_utc": now_utc(),
    })
    report["drive_file"] = str(drive_final)
    report["drive_sha256"] = drive_sha
    report["drive_copy_checksum"] = "passed"
    atomic_json(LOCAL_REPORT, report)
    copy_stream(LOCAL_REPORT, DRIVE_FOLDER / REPORT_NAME, "Final quality report update to Drive")
    update_progress("audio_dub_final_verified",
                    final_path=str(drive_final),
                    final_size_bytes=drive_final.stat().st_size,
                    final_sha256=drive_sha,
                    final_duration_seconds=round(final_duration, 3))
    log(json.dumps({
        "status": report["status"],
        "final_path": str(drive_final),
        "final_size_bytes": report["final_size_bytes"],
        "final_sha256": drive_sha,
        "source_duration_seconds": report["source_duration_seconds"],
        "final_duration_seconds": report["final_duration_seconds"],
        "speaker_count": report["speaker_count"],
        "segment_count": report["segment_count"],
        "arabic_text_coverage": report["arabic_text_coverage"],
        "ffprobe_stream_check": report["ffprobe_stream_check"],
        "full_ffmpeg_decode": report["full_ffmpeg_decode"],
        "drive_copy_checksum": report["drive_copy_checksum"],
        "visual_lip_sync": report["visual_lip_sync"],
    }, ensure_ascii=False, indent=2))
    return report


def create_subtitles(segments: list[dict]) -> float:
    rows = []
    chars = arabic_chars = 0
    for seg in segments:
        text = str(seg.get("ar_text", "")).strip()
        if not text:
            continue
        for c in text:
            if c.isalpha():
                chars += 1
                if "\u0600" <= c <= "\u06ff" or "\ufb50" <= c <= "\ufdff" or "\ufe70" <= c <= "\ufeff":
                    arabic_chars += 1
        start = max(0.0, float(seg["start"]))
        end = max(start + 0.08, float(seg["end"]))
        role = str(seg.get("role_ar", seg.get("speaker", ""))).strip()
        rows.append(f"{len(rows) + 1}\n{fmt_srt_time(start)} --> {fmt_srt_time(end)}\n[{role}] {text}")
    LOCAL_SRT.write_text("\n\n".join(rows) + "\n", encoding="utf-8")
    return arabic_chars / max(1, chars)


def main() -> int:
    try:
        LOCAL_OUTPUT.mkdir(parents=True, exist_ok=True)
        WORK_ROOT.mkdir(parents=True, exist_ok=True)
        CLIPS_DIR.mkdir(parents=True, exist_ok=True)
        ensure_drive_writable()
        total_ram, available_ram = mem_info_gib()
        disk = shutil.disk_usage("/content")
        log(f"Colab resources: total RAM={total_ram:.1f} GiB; available RAM={available_ram:.1f} GiB; local disk free={disk.free / (1024**3):.1f} GiB.")
        if total_ram < 10:
            raise RuntimeError(f"Runtime has only {total_ram:.1f} GiB RAM; stop before starting a long task.")
        if available_ram < 8:
            raise RuntimeError(f"Runtime has only {available_ram:.1f} GiB free RAM; stop before starting a long task.")
        if disk.free < 14 * 1024**3:
            raise RuntimeError(f"Runtime has less than 14 GiB free local disk; stop before downloading the source.")
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            raise RuntimeError("FFmpeg/FFprobe are not available in the Colab runtime.")

        # Fetch the small transcript metadata first, validate it, and only then download the 2.48 GB video.
        metadata, segments = download_metadata()
        source, source_info = obtain_source()
        global CHECKPOINT_DIR
        CHECKPOINT_DIR = BASE_CHECKPOINT_DIR / SOURCE_SHA256[:12]
        CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

        update_progress("preparing_low_memory_tts_dependencies")
        run_stream([
            sys.executable, "-m", "pip", "install", "--no-cache-dir",
            "edge-tts", "deep-translator", "soundfile", "scipy", "numpy", "mutagen",
        ], label="Install neural TTS, translation, and disk-streaming audio libraries")
        import edge_tts  # noqa: F401

        verify_voice_availability(segments)
        segments = translate_segments(segments, source_info)
        manifest = restore_tts_checkpoints()
        manifest = asyncio.run(synthesize_all(segments, manifest))
        if not (CLIPS_DIR / "clip_manifest.json").is_file():
            atomic_json(CLIPS_DIR / "clip_manifest.json", manifest)
        report = render_and_verify(source, source_info, metadata, segments, manifest)
        return 0
    except Exception as exc:
        error = {
            "status": "FAILED_RESUMABLE",
            "stage": STAGE,
            "error_type": type(exc).__name__,
            "error": str(exc),
            "traceback": traceback.format_exc()[-10000:],
            "updated_at_utc": now_utc(),
            "source_sha256": SOURCE_SHA256 or None,
            "metadata_sha256": METADATA_SHA256 or None,
            "resume_note": "The translated text and completed TTS checkpoint archives are copied to Drive in the checkpoint folder whenever the stage reaches a checkpoint. Rerun the workflow to restore completed work.",
        }
        try:
            atomic_json(LOCAL_PROGRESS, error)
            log(f"ERROR: {type(exc).__name__}: {exc}")
            if DRIVE_ROOT.is_dir():
                atomic_json(DRIVE_FOLDER / PROGRESS_NAME, error)
                if CHECKPOINT_DIR and CHECKPOINT_DIR.is_dir():
                    atomic_json(CHECKPOINT_DIR / "last_error.json", error)
        except Exception:
            pass
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        raise


if __name__ == "__main__":
    main()
