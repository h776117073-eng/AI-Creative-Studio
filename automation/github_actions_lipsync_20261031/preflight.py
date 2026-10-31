#!/usr/bin/env python3
"""Drive and GitHub-hosted CPU runner preflight. Does not invoke Colab or render media."""
from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import subprocess
import tempfile
import traceback
import zipfile
from datetime import datetime, timezone
from pathlib import Path

SOURCE_ID = os.environ["EPISODE_SOURCE_ID"]
DUB_ID = os.environ["CURRENT_DUB_ID"]
REPORTS_ID = os.environ["TIMING_REPORTS_ID"]
VOICES_ID = os.environ["VOICE_ARCHIVE_ID"]
OUTPUT_ID = os.environ["OUTPUT_FOLDER_ID"]
DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"
REPORT_NAME = "github_actions_preflight_2026-10-31.json"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def metadata(service, file_id: str) -> dict:
    return service.files().get(
        fileId=file_id,
        fields="id,name,mimeType,size,md5Checksum,parents,trashed,videoMediaMetadata,capabilities(canDownload,canAddChildren),webViewLink",
        supportsAllDrives=True,
    ).execute()


def download_small(service, file_id: str, path: Path) -> None:
    from googleapiclient.http import MediaIoBaseDownload
    request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
    with path.open("wb") as stream:
        downloader = MediaIoBaseDownload(stream, request, chunksize=8 * 1024 * 1024)
        done = False
        while not done:
            _, done = downloader.next_chunk(num_retries=3)


def upload_report(service, output_id: str, path: Path) -> dict:
    from googleapiclient.http import MediaFileUpload
    query = (
        "name = '" + REPORT_NAME + "' and '" + output_id +
        "' in parents and trashed = false"
    )
    existing = service.files().list(
        q=query, pageSize=10, fields="files(id,name,size,parents)",
        supportsAllDrives=True, includeItemsFromAllDrives=True,
    ).execute().get("files", [])
    media = MediaFileUpload(str(path), mimetype="application/json", resumable=True)
    if existing:
        req = service.files().update(
            fileId=existing[0]["id"], media_body=media,
            fields="id,name,size,webViewLink", supportsAllDrives=True,
        )
    else:
        req = service.files().create(
            body={"name": REPORT_NAME, "parents": [output_id]},
            media_body=media, fields="id,name,size,webViewLink",
            supportsAllDrives=True,
        )
    result = None
    while result is None:
        _, result = req.next_chunk(num_retries=3)
    return result


def main() -> None:
    report = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "pipeline": "github-actions-cpu-preflight",
        "colab_used": False,
        "repository_visibility": os.getenv("GITHUB_REPOSITORY_VISIBILITY", "unknown"),
        "runner": {
            "os": platform.platform(),
            "python": platform.python_version(),
            "cpu_count": os.cpu_count(),
            "ram_bytes": None,
            "disk_free_bytes": shutil.disk_usage(Path.cwd()).free,
            "ffmpeg": None,
            "gpu": "not used; CPU-only runner",
        },
        "inputs": {},
        "drive_auth": {"status": "not_checked"},
        "zip_integrity": {},
        "model": {
            "status": "not_configured",
            "note": "No Wav2Lip ONNX weights are committed to this repository. Model/license validation is a separate gate.",
        },
        "status": "failed",
    }

    meminfo = Path("/proc/meminfo")
    if meminfo.exists():
        for line in meminfo.read_text().splitlines():
            if line.startswith("MemTotal:"):
                report["runner"]["ram_bytes"] = int(line.split()[1]) * 1024
                break

    try:
        ffmpeg = subprocess.run(
            ["ffmpeg", "-version"], capture_output=True, text=True, check=True
        )
        report["runner"]["ffmpeg"] = ffmpeg.stdout.splitlines()[0]
    except Exception:
        report["runner"]["ffmpeg"] = "missing"

    raw = (
        os.getenv("GOOGLE_DRIVE_CREDENTIALS_JSON")
        or os.getenv("COLAB_CREDENTIALS_JSON")
        or os.getenv("COLAB_CREDENTIALS")
    )
    if not raw:
        report["drive_auth"] = {
            "status": "missing_secret",
            "detail": "Add GOOGLE_DRIVE_CREDENTIALS_JSON or restore the existing COLAB_CREDENTIALS secret with Drive scope. No Colab runtime is launched.",
        }
        raise RuntimeError("No Google Drive OAuth JSON secret is available to this workflow.")

    try:
        info = json.loads(raw)
        if info.get("type") not in {
            "authorized_user", "service_account", "external_account",
            "impersonated_service_account",
        }:
            raise ValueError("Unsupported Google credential type")
        import google.auth
        from google.auth.transport.requests import Request
        creds, _ = google.auth.load_credentials_from_dict(
            info, scopes=[DRIVE_SCOPE]
        )
        creds.refresh(Request())
        from googleapiclient.discovery import build
        service = build("drive", "v3", credentials=creds, cache_discovery=False)
        who = service.about().get(fields="user(displayName,emailAddress)").execute()
        report["drive_auth"] = {
            "status": "passed",
            "credential_type": info.get("type"),
            "account": (who.get("user") or {}).get("emailAddress"),
            "scope_test": "drive API read/write",
        }
    except Exception as exc:
        report["drive_auth"] = {
            "status": "failed",
            "error_type": type(exc).__name__,
            "detail": "Credential refresh or Drive scope validation failed. Token material is intentionally omitted.",
        }
        raise RuntimeError(
            "Google Drive authentication/scope validation failed: " + type(exc).__name__
        ) from None

    ids = {
        "source_video": SOURCE_ID,
        "current_dub": DUB_ID,
        "timing_reports": REPORTS_ID,
        "voice_archive": VOICES_ID,
        "output_folder": OUTPUT_ID,
    }
    for label, file_id in ids.items():
        item = metadata(service, file_id)
        if item.get("trashed"):
            raise RuntimeError(label + " is in Trash.")
        report["inputs"][label] = {
            "id": item.get("id"),
            "name": item.get("name"),
            "mime_type": item.get("mimeType"),
            "size_bytes": int(item["size"]) if item.get("size") else None,
            "md5": item.get("md5Checksum"),
            "duration_ms": int((item.get("videoMediaMetadata") or {}).get("durationMillis") or 0) or None,
            "can_download": (item.get("capabilities") or {}).get("canDownload"),
            "can_add_children": (item.get("capabilities") or {}).get("canAddChildren"),
            "web_view_link": item.get("webViewLink"),
        }

    if report["inputs"]["output_folder"].get("mime_type") != "application/vnd.google-apps.folder":
        raise RuntimeError("Output ID is not a Drive folder.")
    if not report["inputs"]["output_folder"].get("can_add_children"):
        raise RuntimeError("Drive OAuth identity cannot write to the output folder.")
    if not report["inputs"]["source_video"].get("can_download"):
        raise RuntimeError("Source video is not downloadable by this Drive identity.")
    if not report["inputs"]["current_dub"].get("can_download"):
        raise RuntimeError("Current dub is not downloadable by this Drive identity.")

    with tempfile.TemporaryDirectory(prefix="episode-preflight-") as td:
        temp = Path(td)
        for label, file_id in (("timing_reports", REPORTS_ID), ("voice_archive", VOICES_ID)):
            p = temp / (label + ".zip")
            download_small(service, file_id, p)
            with zipfile.ZipFile(p) as zf:
                bad = zf.testzip()
                names = zf.namelist()
                if bad:
                    raise RuntimeError(label + " ZIP CRC failure: " + bad)
            report["zip_integrity"][label] = {
                "status": "passed",
                "size_bytes": p.stat().st_size,
                "sha256": sha256(p),
                "file_count": len(names),
                "filenames": names[:40],
            }

        report["status"] = "preflight_passed_model_gate_pending"
        out = temp / REPORT_NAME
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        uploaded = upload_report(service, OUTPUT_ID, out)
        report["drive_report"] = {
            "id": uploaded.get("id"),
            "name": uploaded.get("name"),
            "web_view_link": uploaded.get("webViewLink"),
        }

    print(json.dumps(report, ensure_ascii=False, indent=2))
    print("PREFLIGHT_STATUS=" + report["status"])


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("PREFLIGHT_STATUS=FAILED")
        print("ERROR_TYPE=" + type(exc).__name__)
        print("ERROR=" + str(exc))
        raise
