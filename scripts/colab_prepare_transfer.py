#!/usr/bin/env python3
"""Prepare safe, chunked Colab output for GitHub Actions artifact upload."""
from __future__ import annotations
import hashlib
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("/content/dub-output")
TRANSFER = Path("/content/dub-transfer")
FINAL_NAME = "Billionaire_Granny_CEO_Full_Arabic_Dub.mp4"
REPORT_NAME = "Billionaire_Granny_CEO_Quality_Report.json"
CHUNK_SIZE = 128 * 1024 * 1024
MANIFEST_PATH = TRANSFER / "transfer_manifest.json"

def utc_now():
    return datetime.now(timezone.utc).isoformat()

def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def safe_name(relative: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "__", relative.replace("/", "__").replace("\\", "__"))
    return cleaned[:180] or "file.bin"

def chunk_file(src: Path, logical_name: str, *, is_final: bool = False) -> dict:
    total = src.stat().st_size
    file_hash = hashlib.sha256()
    parts = []
    index = 0
    with src.open("rb") as reader:
        while True:
            first = reader.read(CHUNK_SIZE)
            if not first:
                break
            part_name = f"video_part_{index:04d}.bin" if is_final else f"payload_{safe_name(logical_name)}_part_{index:04d}.bin"
            target = TRANSFER / part_name
            part_hash = hashlib.sha256()
            written = 0
            with target.open("wb") as writer:
                block = first
                while block:
                    writer.write(block)
                    part_hash.update(block)
                    file_hash.update(block)
                    written += len(block)
                    block = reader.read(min(8 * 1024 * 1024, CHUNK_SIZE - written)) if written < CHUNK_SIZE else b""
                writer.flush()
                os.fsync(writer.fileno())
            if target.stat().st_size != written:
                raise RuntimeError(f"Transfer chunk size check failed: {part_name}")
            parts.append({
                "name": part_name,
                "remote_path": f"/content/dub-transfer/{part_name}",
                "size_bytes": written,
                "sha256": part_hash.hexdigest(),
            })
            index += 1
    if sum(p["size_bytes"] for p in parts) != total:
        raise RuntimeError(f"Chunk total mismatch for {logical_name}")
    return {
        "name": logical_name,
        "size_bytes": total,
        "sha256": file_hash.hexdigest(),
        "parts": parts,
    }

def copy_sidecar(src: Path, relative: str) -> dict:
    name = f"sidecar__{safe_name(relative)}"
    target = TRANSFER / name
    shutil.copyfile(src, target)
    if target.stat().st_size != src.stat().st_size:
        raise RuntimeError(f"Sidecar copy size mismatch: {relative}")
    return {
        "name": relative,
        "remote_path": f"/content/dub-transfer/{name}",
        "transfer_name": name,
        "size_bytes": target.stat().st_size,
        "sha256": sha256_path(target),
    }

def main():
    if not OUT.is_dir():
        raise FileNotFoundError(f"Colab output directory is missing: {OUT}")
    shutil.rmtree(TRANSFER, ignore_errors=True)
    TRANSFER.mkdir(parents=True, exist_ok=True)

    final_path = OUT / FINAL_NAME
    report_path = OUT / REPORT_NAME
    report = {}
    if report_path.is_file():
        try:
            report = json.loads(report_path.read_text(encoding="utf-8"))
        except Exception:
            report = {}
    checks = report.get("checks") or {}
    report_size_matches = report.get("final_size_bytes") == final_path.stat().st_size if final_path.is_file() else False
    report_hash_matches = report.get("final_sha256") == sha256_path(final_path) if final_path.is_file() else False
    final_verified = (
        final_path.is_file()
        and final_path.stat().st_size > 100_000_000
        and report.get("status") == "AUDIO_DUB_FINAL_VERIFIED"
        and report_size_matches
        and report_hash_matches
        and (report.get("ffprobe_stream_check") == "passed" or checks.get("ffprobe_stream_check") == "passed")
        and (report.get("full_ffmpeg_decode") == "passed" or checks.get("full_ffmpeg_decode") == "passed")
    )

    if final_verified:
        include_files = []
        for item in sorted(OUT.iterdir()):
            if item.is_file() and item.name != FINAL_NAME:
                include_files.append(item)
        # The successful final video is split into pieces so the Colab CLI never has to
        # materialize a 2.5 GB base64 response in one request.
        final_record = chunk_file(final_path, FINAL_NAME, is_final=True)
        sidecars = [copy_sidecar(item, item.name) for item in include_files]
        status = "FINAL_VERIFIED"
    else:
        final_record = None
        # On failure, transfer logs, partial translations and local checkpoints for diagnosis/resumption.
        include_files = [item for item in sorted(OUT.rglob("*")) if item.is_file() and ".part" not in item.name]
        sidecars = []
        large_files = []
        for item in include_files:
            relative = item.relative_to(OUT).as_posix()
            if item.stat().st_size > CHUNK_SIZE:
                large_files.append(chunk_file(item, relative, is_final=False))
            else:
                sidecars.append(copy_sidecar(item, relative))
        status = "PARTIAL_RESUMABLE"

    manifest = {
        "schema": 1,
        "status": status,
        "source_file_id": "youtube:XuuU73TYTLY",
        "source_url": "https://youtu.be/XuuU73TYTLY",
        "created_at_utc": utc_now(),
        "chunk_size_bytes": CHUNK_SIZE,
        "final_video": final_record,
        "sidecars": sidecars,
        "large_files": large_files if not final_verified else [],
        "expected_full_dub_status": "AUDIO_DUB_FINAL_VERIFIED",
        "no_drive_mount_used": True,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "transfer_status": status,
        "manifest": str(MANIFEST_PATH),
        "final_size_bytes": final_record["size_bytes"] if final_record else None,
        "final_sha256": final_record["sha256"] if final_record else None,
        "video_parts": len(final_record["parts"]) if final_record else 0,
        "sidecars": len(sidecars),
        "large_checkpointed_files": len(manifest.get("large_files", [])),
    }, ensure_ascii=False, indent=2), flush=True)

if __name__ == "__main__":
    main()
