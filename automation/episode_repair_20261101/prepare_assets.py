#!/usr/bin/env python3
"""Read-only Drive preflight and verified input staging for the isolated Colab repair workflow."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

OUTPUT = Path("output")
INPUTS = OUTPUT / "inputs"
DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
TARGET_SECONDS = 6153.995

ASSETS = [
    ("source", "13AL8R54GE-S41TsIbXGX1rhIa-Y0HZm-", "🔴 FULL - 女孩相亲认错人，将错就错与千亿霸总当天领证！ - Original Quality.mkv", "source_chinese.mkv"),
    ("current_dub", "15MkBM0m9YduRz4pim2Stp_9ruW5XbqKw", "الحلقة_مدبلجة_بالعربية.mkv", "current_dub.mkv"),
    ("reports", "1mVJpaVrR0Y9ikfeX_lynBCVwDBoUemxV", "تقارير_التحقق_والموائمة.zip", "reports.zip"),
    ("voice_archive", "1kW388RgJNpoVCFEE8HRU18x4sX250bBf", "الأصوات_العربية_المتبقية_06-10.zip", "voices_06_10.zip"),
]
INDIVIDUAL_VOICES = [
    ("01_لي_يانغ_Leda.wav", "1mrtadf_yTJtk9vv2OIEqCSyhi-O_VJjA", "voice_01.wav"),
    ("02_لو_مينغ_Achird.wav", "1n-E4VaPurnlbvaT5V_5taMXNHaGC8Ipl", "voice_02.wav"),
    ("03_تشوانغ_شيان_يوي_Kore.wav", "10cFLVZkb79xhYlBIYatBn_6s2hOjc4Os", "voice_03.wav"),
    ("04_فو_شاوتشينغ_Puck.wav", "1ZGttKXDYt6lzCtcCYU_2qr84ZgPXHDJq", "voice_04.wav"),
    ("05_شيا_مو_يان_Zephyr.wav", "11HSnZ57lpUBlvztteIXF58FLydtJOD_J", "voice_05.wav"),
]

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def load_drive_service():
    raw = os.environ.get("GOOGLE_DRIVE_CREDENTIALS_JSON", "").strip() or os.environ.get("COLAB_CREDENTIALS", "").strip()
    if not raw:
        raise RuntimeError("Missing GOOGLE_DRIVE_CREDENTIALS_JSON and COLAB_CREDENTIALS secrets.")
    try:
        info = json.loads(raw)
    except Exception:
        raise RuntimeError("Drive credential secret is not valid JSON; secret contents were not printed.") from None
    allowed = {"authorized_user", "service_account", "external_account", "impersonated_service_account"}
    if info.get("type") not in allowed:
        raise RuntimeError("Unsupported Google credential type; secret contents were not printed.")
    import google.auth
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    try:
        creds, _ = google.auth.load_credentials_from_dict(info, scopes=[DRIVE_SCOPE])
        if not creds.valid:
            creds.refresh(Request())
        if hasattr(creds, "has_scopes") and not creds.has_scopes([DRIVE_SCOPE]):
            raise RuntimeError("Credential does not grant the Google Drive read-only scope.")
        service = build("drive", "v3", credentials=creds, cache_discovery=False)
        # Prove the token can call the Drive API before any GPU session is allocated.
        service.about().get(fields="user").execute(num_retries=2)
    except Exception as exc:
        raise RuntimeError("Google Drive credential refresh/scope check failed: " + type(exc).__name__) from None
    print("DRIVE_AUTH=passed; credential type=" + str(info.get("type")) + "; token contents withheld.", flush=True)
    return service

def metadata(service, file_id: str) -> dict:
    return service.files().get(
        fileId=file_id,
        fields="id,name,mimeType,size,md5Checksum,trashed,videoMediaMetadata,capabilities(canDownload,canAddChildren)",
        supportsAllDrives=True,
    ).execute(num_retries=3)

def download(service, file_id: str, meta: dict, dest: Path) -> dict:
    from googleapiclient.http import MediaIoBaseDownload
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    if part.exists():
        part.unlink()
    request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
    with part.open("wb") as f:
        downloader = MediaIoBaseDownload(f, request, chunksize=8 * 1024 * 1024)
        done = False
        while not done:
            status, done = downloader.next_chunk(num_retries=4)
            if status:
                print("DOWNLOAD_PROGRESS=" + dest.name + ":" + str(int(status.progress() * 100)) + "%", flush=True)
    expected_size = int(meta.get("size") or 0)
    if expected_size and part.stat().st_size != expected_size:
        raise RuntimeError("Size mismatch for " + str(meta.get("name")))
    got_md5 = md5_file(part)
    if meta.get("md5Checksum") and got_md5.lower() != str(meta["md5Checksum"]).lower():
        raise RuntimeError("Drive MD5 mismatch for " + str(meta.get("name")))
    os.replace(part, dest)
    result = {
        "name": meta["name"], "size_bytes": dest.stat().st_size,
        "md5": got_md5, "sha256": sha256_file(dest),
        "local_path": str(dest), "remote_path": "/content/episode_repair_20261031/input/" + dest.name,
    }
    print("ASSET_VERIFIED=" + dest.name + "; bytes=" + str(result["size_bytes"]), flush=True)
    return result

def ffprobe_duration(path: Path) -> float:
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True, timeout=300,
    )
    return float(p.stdout.strip())

def zip_json(zf: zipfile.ZipFile, wanted: str) -> dict:
    hits = [n for n in zf.namelist() if Path(n).name == wanted]
    if len(hits) != 1:
        raise RuntimeError("Reports archive must contain exactly one " + wanted + "; found " + str(len(hits)))
    return json.loads(zf.read(hits[0]).decode("utf-8-sig"))

def main() -> int:
    OUTPUT.mkdir(exist_ok=True)
    INPUTS.mkdir(parents=True, exist_ok=True)
    report = {"status": "starting", "target_duration_seconds": TARGET_SECONDS, "files": {}, "errors": []}
    report_path = OUTPUT / "asset_preflight.json"
    try:
        service = load_drive_service()
        entries = []
        for key, file_id, expected_name, local_name in ASSETS:
            meta = metadata(service, file_id)
            if meta.get("trashed"):
                raise RuntimeError(key + " input is in Drive trash.")
            if meta.get("name") != expected_name:
                raise RuntimeError(key + " name mismatch: " + str(meta.get("name")))
            if meta.get("mimeType") == "application/vnd.google-apps.folder":
                raise RuntimeError(key + " unexpectedly resolves to a folder.")
            if not (meta.get("capabilities") or {}).get("canDownload", True):
                raise RuntimeError(key + " is not downloadable by this Drive identity.")
            entries.append((key, file_id, meta, INPUTS / local_name))
            report["files"][key] = {"name": meta.get("name"), "size_bytes": int(meta.get("size") or 0)}
        for name, file_id, remote_name in INDIVIDUAL_VOICES:
            meta = metadata(service, file_id)
            if meta.get("trashed") or meta.get("name") != name:
                raise RuntimeError("Individual WAV metadata mismatch for " + name)
            if not (meta.get("capabilities") or {}).get("canDownload", True):
                raise RuntimeError("Individual WAV is not downloadable: " + name)
            entries.append(("voice:" + name, file_id, meta, INPUTS / remote_name))
            report["files"]["voice:" + name] = {"name": meta.get("name"), "size_bytes": int(meta.get("size") or 0)}
        out_meta = metadata(service, "1SE3JYbB4c-pC1W-ymRK6S5CsFt-XidzA")
        if out_meta.get("mimeType") != "application/vnd.google-apps.folder" or out_meta.get("trashed"):
            raise RuntimeError("The requested final Drive destination is not an available folder.")
        report["destination"] = {
            "folder_id": out_meta["id"],
            "can_add_children": (out_meta.get("capabilities") or {}).get("canAddChildren"),
            "write_test": "not performed; no Drive writes are allowed before final QA",
        }
        total = sum(int(meta.get("size") or 0) for _, _, meta, _ in entries)
        free = shutil.disk_usage(INPUTS).free
        report["staging"] = {"expected_bytes": total, "free_bytes": free}
        if free < total * 1.15 + 2 * 1024**3:
            raise RuntimeError("Insufficient Actions disk space for a verified staging copy.")
        for key, file_id, meta, path in entries:
            report["files"][key] = download(service, file_id, meta, path)
        source = INPUTS / "source_chinese.mkv"
        dubbed = INPUTS / "current_dub.mkv"
        source_duration = ffprobe_duration(source)
        dubbed_duration = ffprobe_duration(dubbed)
        report["source_duration_seconds"] = source_duration
        report["current_dub_duration_seconds"] = dubbed_duration
        if abs(source_duration - TARGET_SECONDS) > 3.0:
            raise RuntimeError("Source duration is outside the 6153.995-second acceptance window.")
        if abs(source_duration - dubbed_duration) > 1.0:
            raise RuntimeError("Source and current Arabic dub durations do not match.")
        reports = INPUTS / "reports.zip"
        voices = INPUTS / "voices_06_10.zip"
        with zipfile.ZipFile(reports) as zf:
            bad = zf.testzip()
            if bad:
                raise RuntimeError("Corrupt report ZIP member: " + bad)
            required = {"render_manifest.json", "final_probe.json", "source_to_arabic_lines.json", "voice_line_timing.json"}
            basenames = {Path(n).name for n in zf.namelist()}
            if not required.issubset(basenames):
                raise RuntimeError("Reports ZIP is missing required timing/identity files.")
            render_manifest = zip_json(zf, "render_manifest.json")
            timing = zip_json(zf, "voice_line_timing.json")
        with zipfile.ZipFile(voices) as zf:
            bad = zf.testzip()
            if bad:
                raise RuntimeError("Corrupt voice ZIP member: " + bad)
            archive_wavs = {Path(n).name for n in zf.namelist() if n.lower().endswith(".wav")}
        tracks = timing.get("tracks", [])
        if len(tracks) != 10:
            raise RuntimeError("Voice timing report must describe exactly ten speaker masters.")
        required_track_files = {str(x.get("track_file") or "") for x in tracks}
        individual_names = {x[0] for x in INDIVIDUAL_VOICES}
        if len(required_track_files) != 10 or not individual_names.issubset(required_track_files):
            raise RuntimeError("The ten track names do not match the five standalone WAV masters.")
        available_names = archive_wavs | individual_names
        if not required_track_files.issubset(available_names):
            missing = sorted(required_track_files - available_names)
            raise RuntimeError("Voice archive/individual masters do not cover all timing tracks: " + ", ".join(missing))
        source_hash = report["files"]["source"]["sha256"]
        dub_hash = report["files"]["current_dub"]["sha256"]
        if render_manifest.get("source_video_sha256") and render_manifest["source_video_sha256"] != source_hash:
            raise RuntimeError("Source SHA256 differs from the saved render manifest.")
        if render_manifest.get("video_sha256") and render_manifest["video_sha256"] != dub_hash:
            raise RuntimeError("Current dub SHA256 differs from the saved render manifest.")
        report["voice_master_count"] = len(required_track_files)
        report["voice_archive_wav_count"] = len(archive_wavs)
        report["expected_utterance_count"] = sum(len(x.get("utterances", [])) for x in tracks)
        report["source_video_sha256"] = source_hash
        report["current_dub_sha256"] = dub_hash
        report["status"] = "passed"
        report["gpu_policy"] = "standard Colab T4 only; no high-memory request and no paid upgrade"
        report["render_policy"] = "no output is uploaded to Drive by this workflow"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("ASSET_PREFLIGHT=PASSED", flush=True)
        print(json.dumps({k: report.get(k) for k in ("status", "source_duration_seconds", "current_dub_duration_seconds", "voice_master_count", "expected_utterance_count", "staging")}, ensure_ascii=False), flush=True)
        return 0
    except Exception as exc:
        report["status"] = "failed"
        report["error_type"] = type(exc).__name__
        report["error"] = str(exc)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("ASSET_PREFLIGHT=FAILED", flush=True)
        print("ERROR_TYPE=" + type(exc).__name__, flush=True)
        print("ERROR=" + str(exc), flush=True)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
