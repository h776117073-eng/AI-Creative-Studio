#!/usr/bin/env python3
"""Safely repair the existing Arabic dub using only the ten supplied WAV masters.

The task verifies source identity, downloads exact Drive assets, reconstructs timing
for the twelve omitted utterances from the saved source-to-script map (with a
conservative ASR-text fallback), mixes only those missing lines into the existing
dub audio, and writes a new version to a separate Drive folder. It never synthesizes
or substitutes a voice and never overwrites the current MKV.
"""
from __future__ import annotations

import collections
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
import zipfile
from difflib import SequenceMatcher
from pathlib import Path
from statistics import median

ROOT = Path("/content/episode_repair_20261031")
ASSET_DIR = ROOT / "assets"
VOICE_DIR = ROOT / "voices"
WORK_DIR = ROOT / "work"
CLIP_DIR = WORK_DIR / "missing_clips"
LOG_PATH = ROOT / "repair.log"
PROGRESS_PATH = ROOT / "progress.json"
AUDIT_PATH = ROOT / "asset_audit.json"
PLAN_PATH = ROOT / "timeline_plan.json"
QA_PATH = ROOT / "qa_report.json"
FINAL_PATH = ROOT / "الحلقة_مدبلجة_بالعربية_النهائية.mkv"
SESSION_DIR = Path("/content/.private")
ADC_PATH = SESSION_DIR / "google_adc.json"

FOLDER_ID = "1SE3JYbB4c-pC1W-ymRK6S5CsFt-XidzA"
SOURCE_ID = "13AL8R54GE-S41TsIbXGX1rhIa-Y0HZm-"
DUBBED_ID = "15MkBM0m9YduRz4pim2Stp_9ruW5XbqKw"
REPORTS_ID = "1mVJpaVrR0Y9ikfeX_lynBCVwDBoUemxV"
VOICE_ARCHIVE_ID = "1kW388RgJNpoVCFEE8HRU18x4sX250bBf"
INDIVIDUAL_VOICES = {
    "01_لي_يانغ_Leda.wav": "1mrtadf_yTJtk9vv2OIEqCSyhi-O_VJjA",
    "02_لو_مينغ_Achird.wav": "1n-E4VaPurnlbvaT5V_5taMXNHaGC8Ipl",
    "03_تشوانغ_شيان_يوي_Kore.wav": "10cFLVZkb79xhYlBIYatBn_6s2hOjc4Os",
    "04_فو_شاوتشينغ_Puck.wav": "1ZGttKXDYt6lzCtcCYU_2qr84ZgPXHDJq",
    "05_شيا_مو_يان_Zephyr.wav": "11HSnZ57lpUBlvztteIXF58FLydtJOD_J",
}

OUTPUT_FOLDER_NAME = "الحلقة_المدبلجة_بالعربية_النهائية_مراجعة_2026-10-31"
CHECKPOINT_FOLDER_NAME = "checkpoints"

DRIVE = None
OUTPUT_FOLDER_ID = None
CHECKPOINT_FOLDER_ID = None
STARTED = time.time()


def log(message: str) -> None:
    line = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " " + str(message)
    print(line, flush=True)
    ROOT.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def atomic_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    total = path.stat().st_size
    done = 0
    with path.open("rb") as f:
        while True:
            b = f.read(8 * 1024 * 1024)
            if not b:
                break
            h.update(b)
            done += len(b)
    log("SHA256 " + path.name + " " + str(done) + "/" + str(total))
    return h.hexdigest()


def drive_api():
    global DRIVE
    if not ADC_PATH.is_file():
        raise RuntimeError("Google ADC file is missing on the Colab runtime.")
    from google.auth import load_credentials_from_file
    from googleapiclient.discovery import build
    credentials, _ = load_credentials_from_file(str(ADC_PATH))
    DRIVE = build("drive", "v3", credentials=credentials, cache_discovery=False)
    return DRIVE


def drive_meta(file_id: str) -> dict:
    return DRIVE.files().get(
        fileId=file_id,
        fields="id,name,mimeType,size,md5Checksum,parents,trashed,videoMediaMetadata,webViewLink",
        supportsAllDrives=True,
    ).execute(num_retries=4)


def find_folder(parent_id: str, name: str) -> str | None:
    q = (
        "'" + parent_id + "' in parents and name = '" + name.replace("'", "\\'") +
        "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    res = DRIVE.files().list(
        q=q, pageSize=20, fields="files(id,name,parents)",
        supportsAllDrives=True, includeItemsFromAllDrives=True,
    ).execute(num_retries=4)
    fs = res.get("files", [])
    return fs[0]["id"] if fs else None


def create_folder(parent_id: str, name: str) -> str:
    got = find_folder(parent_id, name)
    if got:
        return got
    r = DRIVE.files().create(
        body={"name": name, "mimeType": "application/vnd.google-apps.folder", "parents": [parent_id]},
        fields="id,name,parents", supportsAllDrives=True,
    ).execute(num_retries=4)
    return r["id"]


def upload_drive_file(path: Path, name: str, parent_id: str, mime: str) -> dict:
    from googleapiclient.http import MediaFileUpload
    q = (
        "'" + parent_id + "' in parents and name = '" + name.replace("'", "\\'") +
        "' and trashed = false"
    )
    res = DRIVE.files().list(
        q=q, pageSize=10, fields="files(id,name,size,md5Checksum)",
        supportsAllDrives=True, includeItemsFromAllDrives=True,
    ).execute(num_retries=4)
    existing = res.get("files", [])
    media = MediaFileUpload(str(path), mimetype=mime, resumable=True, chunksize=8 * 1024 * 1024)
    body = {"name": name}
    if existing:
        req = DRIVE.files().update(
            fileId=existing[0]["id"], body=body, media_body=media,
            fields="id,name,size,md5Checksum,webViewLink", supportsAllDrives=True,
        )
    else:
        body["parents"] = [parent_id]
        req = DRIVE.files().create(
            body=body, media_body=media,
            fields="id,name,size,md5Checksum,webViewLink", supportsAllDrives=True,
        )
    response = None
    while response is None:
        status, response = req.next_chunk(num_retries=5)
        if status:
            log("Drive upload " + name + " " + str(int(status.progress() * 100)) + "%")
    return response


def sync_json(path: Path, folder_id: str, mime: str = "application/json") -> None:
    try:
        upload_drive_file(path, path.name, folder_id, mime)
    except Exception as e:
        log("WARNING: could not sync " + path.name + ": " + repr(e))


def update_progress(stage: str, **fields) -> None:
    obj = {"stage": stage, "updated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "elapsed_seconds": round(time.time() - STARTED, 1), **fields}
    atomic_json(PROGRESS_PATH, obj)
    if CHECKPOINT_FOLDER_ID:
        sync_json(PROGRESS_PATH, CHECKPOINT_FOLDER_ID)


def download_drive(file_id: str, dest: Path, metadata: dict | None = None) -> Path:
    from googleapiclient.http import MediaIoBaseDownload
    dest.parent.mkdir(parents=True, exist_ok=True)
    meta = metadata or drive_meta(file_id)
    expected = int(meta.get("size") or 0)
    if dest.exists() and expected and dest.stat().st_size == expected:
        log("Reusing verified-size local file " + dest.name)
        return dest
    part = dest.with_suffix(dest.suffix + ".part")
    if part.exists():
        part.unlink()
    req = DRIVE.files().get_media(fileId=file_id, supportsAllDrives=True)
    last = 0
    with part.open("wb") as f:
        dl = MediaIoBaseDownload(f, req, chunksize=8 * 1024 * 1024)
        done = False
        while not done:
            status, done = dl.next_chunk(num_retries=5)
            size = f.tell()
            if size - last >= 128 * 1024 * 1024 or done:
                log("Downloading " + dest.name + ": " + str(size) + "/" + str(expected))
                last = size
    if expected and part.stat().st_size != expected:
        raise RuntimeError("Drive size mismatch for " + dest.name + ": expected " + str(expected) +
                           ", got " + str(part.stat().st_size))
    os.replace(part, dest)
    return dest


def run(cmd: list[str], label: str, timeout: int | None = None) -> subprocess.CompletedProcess:
    log("RUN " + label + ": " + " ".join(str(x) for x in cmd[:8]))
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       text=True, errors="replace", timeout=timeout)
    tail = (p.stdout or "")[-4000:]
    if tail:
        log(label + " output tail:\n" + tail)
    if p.returncode:
        raise RuntimeError(label + " failed with exit=" + str(p.returncode) + ": " + tail[-1800:])
    return p


def probe(path: Path) -> dict:
    p = run(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
            "ffprobe " + path.name, timeout=180)
    return json.loads(p.stdout)


def clean_ar(text: str) -> str:
    text = re.sub(r"[\u064B-\u065F\u0670\u0640]", "", str(text or ""))
    text = re.sub(r"[ًٌٍَُِّْٰـ]", "", text)
    text = re.sub(r"[^\w\u0600-\u06FF\s]", " ", text, flags=re.UNICODE)
    return " ".join(text.split()).lower()


def similarity(a: str, b: str) -> float:
    aa, bb = clean_ar(a), clean_ar(b)
    if not aa or not bb:
        return 0.0
    seq = SequenceMatcher(None, aa, bb).ratio()
    ta, tb = set(aa.split()), set(bb.split())
    jac = len(ta & tb) / max(1, len(ta | tb))
    return 0.55 * seq + 0.45 * jac


def translate_zh_ar(text: str) -> str:
    import requests
    url = "https://translate.googleapis.com/translate_a/single"
    r = requests.get(url, params={"client": "gtx", "sl": "zh-CN", "tl": "ar", "dt": "t", "q": text},
                     timeout=25, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    d = r.json()
    return "".join(x[0] for x in (d[0] or []) if x and x[0])


def ensure_tools() -> None:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        run(["bash", "-lc", "apt-get update -qq && apt-get install -y -qq ffmpeg"], "install ffmpeg", timeout=900)
    try:
        import torch
    except Exception:
        run([sys.executable, "-m", "pip", "install", "-q", "torch"], "install torch", timeout=1200)
        import torch
    if not torch.cuda.is_available():
        raise RuntimeError("Colab runtime has no CUDA GPU; refusing CPU processing.")
    gpu = torch.cuda.get_device_name(0)
    if "T4" not in gpu.upper():
        raise RuntimeError("Requested T4 but runtime provided " + gpu + ". No media processing started.")
    log("GPU VERIFIED: " + gpu + "; VRAM GiB=" +
        str(round(torch.cuda.get_device_properties(0).total_memory / (1024 ** 3), 2)))


def voice_path_for(track_file: str) -> Path:
    hits = list(VOICE_DIR.rglob(track_file))
    if len(hits) != 1:
        raise RuntimeError("Expected exactly one WAV for " + track_file + ", found " + str(len(hits)))
    return hits[0]


def mapped_groups(assignments: list[dict]) -> dict:
    groups = collections.defaultdict(list)
    for row in assignments:
        sid = row.get("speaker_script_id")
        idx = int(row.get("utterance_index") or 0)
        if sid and sid != "unmatched" and idx > 0:
            groups[(sid, idx)].append(row)
    return groups


def build_unmatched_clusters(rows: list[dict], wanted_source_speaker: str | None,
                             lo: float, hi: float) -> list[dict]:
    items = []
    for r in rows:
        if r.get("speaker_script_id") != "unmatched":
            continue
        if wanted_source_speaker and r.get("source_speaker_id") != wanted_source_speaker:
            continue
        st, en = float(r.get("source_start") or 0), float(r.get("source_end") or 0)
        if en <= lo - 0.3 or st >= hi + 0.3:
            continue
        items.append(r)
    items.sort(key=lambda x: float(x.get("source_start") or 0))
    clusters = []
    cur = None
    for r in items:
        st, en = float(r["source_start"]), float(r["source_end"])
        sid = r.get("source_speaker_id")
        if cur and sid == cur["source_speaker_id"] and st - cur["end"] <= 1.15 and en - cur["start"] <= 28:
            cur["end"] = max(cur["end"], en)
            cur["rows"].append(r)
            cur["text"] += str(r.get("source_text") or "")
        else:
            cur = {"source_speaker_id": sid, "start": st, "end": en,
                   "rows": [r], "text": str(r.get("source_text") or "")}
            clusters.append(cur)
    return [c for c in clusters if c["text"].strip() and lo - 0.3 <= c["start"] <= hi + 0.3]


def infer_missing_times(tracks: list[dict], assignments: list[dict], groups: dict,
                        rendered_keys: set) -> list[dict]:
    all_rows = assignments
    per_track_source = {}
    for t in tracks:
        sid = t["speaker_id"]
        c = collections.Counter()
        for r in all_rows:
            if r.get("speaker_script_id") == sid and r.get("source_speaker_id"):
                c[r["source_speaker_id"]] += 1
        per_track_source[sid] = c.most_common(1)[0][0] if c else None

    inferred = []
    for t in tracks:
        sid = t["speaker_id"]
        utterances = t.get("utterances", [])
        mapped_times = {}
        for idx in range(1, int(t.get("expected_utterance_count") or len(utterances)) + 1):
            rows = groups.get((sid, idx), [])
            if rows:
                mapped_times[idx] = (
                    min(float(r["source_start"]) for r in rows),
                    max(float(r["source_end"]) for r in rows),
                )
        for u in utterances:
            idx = int(u["utterance_index"])
            key = (sid, idx)
            if key in rendered_keys:
                continue
            voice_start = float(u.get("track_start_seconds") or 0)
            voice_end = float(u.get("track_end_seconds") or 0)
            if voice_end <= voice_start:
                inferred.append({"speaker_script_id": sid, "utterance_index": idx,
                                 "status": "blocked_invalid_voice_window"})
                continue
            if groups.get(key):
                rows = groups[key]
                start = min(float(r["source_start"]) for r in rows)
                end = max(float(r["source_end"]) for r in rows)
                conf = median(float(r.get("confidence") or 0) for r in rows)
                inferred.append({"speaker_script_id": sid, "utterance_index": idx,
                                 "status": "mapped_from_assignment", "source_start": start,
                                 "source_end": end, "mapping_confidence": conf,
                                 "voice_start": voice_start, "voice_end": voice_end,
                                 "text": u.get("text", "")})
                continue

            prevs = [(i, x[1]) for i, x in mapped_times.items() if i < idx]
            nexts = [(i, x[0]) for i, x in mapped_times.items() if i > idx]
            lo = max((x[1] for x in prevs), default=0.0)
            hi = min((x[1] for x in nexts), default=6153.9)
            source_speaker = per_track_source.get(sid)
            candidates = build_unmatched_clusters(all_rows, source_speaker, lo, hi)
            # Narrow a very wide interval with chronological neighbors in the same speaker track.
            if candidates:
                voice_duration = voice_end - voice_start
                scored = []
                for c in candidates:
                    dur = c["end"] - c["start"]
                    dur_fit = math.exp(-abs(math.log(max(dur, 0.2) / max(voice_duration, 0.2))))
                    try:
                        ar = translate_zh_ar(c["text"])
                        sim = similarity(ar, u.get("text", ""))
                    except Exception as exc:
                        log("Translation fallback unavailable for " + sid + "/" + str(idx) +
                            ": " + type(exc).__name__)
                        sim = 0.0
                        ar = ""
                    score = 0.72 * sim + 0.28 * dur_fit
                    scored.append((score, sim, dur_fit, c, ar))
                scored.sort(key=lambda x: x[0], reverse=True)
                best = scored[0]
                second = scored[1][0] if len(scored) > 1 else 0.0
                if best[1] >= 0.43 and best[0] - second >= 0.07:
                    c = best[3]
                    inferred.append({"speaker_script_id": sid, "utterance_index": idx,
                                     "status": "inferred_from_unmatched_asr_translation",
                                     "source_start": c["start"], "source_end": c["end"],
                                     "mapping_confidence": best[0], "translation_similarity": best[1],
                                     "duration_fit": best[2], "candidate_translation": best[4],
                                     "source_text": c["text"], "voice_start": voice_start,
                                     "voice_end": voice_end, "text": u.get("text", "")})
                    continue
            inferred.append({"speaker_script_id": sid, "utterance_index": idx,
                             "status": "blocked_no_confident_source_match",
                             "search_window": [lo, hi], "source_speaker_id": source_speaker,
                             "candidate_count": len(candidates), "voice_start": voice_start,
                             "voice_end": voice_end, "text": u.get("text", "")})
    return inferred


def make_contact_sheet(video: Path, out: Path, duration: float) -> dict:
    from PIL import Image, ImageDraw
    samples = [duration * f for f in (0.03, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 0.97)]
    thumbs = []
    for i, ts in enumerate(samples):
        frame = WORK_DIR / ("frame_" + str(i).zfill(2) + ".jpg")
        run(["ffmpeg", "-y", "-ss", str(ts), "-i", str(video), "-frames:v", "1",
             "-vf", "scale=320:-1", "-q:v", "4", str(frame)], "extract frame " + str(i), timeout=90)
        im = Image.open(frame).convert("RGB")
        thumbs.append((ts, im.copy()))
    w, h = 320, max(x[1].height for x in thumbs) + 30
    sheet = Image.new("RGB", (w * 3, h * math.ceil(len(thumbs) / 3)), "white")
    draw = ImageDraw.Draw(sheet)
    for i, (ts, im) in enumerate(thumbs):
        x, y = (i % 3) * w, (i // 3) * h
        sheet.paste(im, (x, y + 24))
        draw.text((x + 5, y + 5), "t=" + str(round(ts, 1)) + "s", fill="black")
    sheet.save(out, quality=88)
    # Verify frames are not empty/black.
    means = [sum(im.convert("L").getdata()) / max(1, im.width * im.height) for _, im in thumbs]
    return {"sampled_frames": len(thumbs), "timestamps_seconds": samples,
            "mean_luma": means, "black_frame_samples": sum(1 for x in means if x < 4.0)}


def main() -> None:
    global OUTPUT_FOLDER_ID, CHECKPOINT_FOLDER_ID
    ROOT.mkdir(parents=True, exist_ok=True)
    for p in (ASSET_DIR, VOICE_DIR, WORK_DIR, CLIP_DIR):
        p.mkdir(parents=True, exist_ok=True)

    update_progress("starting")
    ensure_tools()
    drive_api()
    parent = drive_meta(FOLDER_ID)
    if parent.get("name") != "دبلجة الحلقة الجديدة":
        raise RuntimeError("Audio folder ID/name verification failed.")
    OUTPUT_FOLDER_ID = create_folder(FOLDER_ID, OUTPUT_FOLDER_NAME)
    CHECKPOINT_FOLDER_ID = create_folder(OUTPUT_FOLDER_ID, CHECKPOINT_FOLDER_NAME)
    log("Drive output folder ready: " + OUTPUT_FOLDER_ID)

    update_progress("verifying_drive_identities")
    source_meta = drive_meta(SOURCE_ID)
    dubbed_meta = drive_meta(DUBBED_ID)
    if source_meta.get("name") != "🔴 FULL - 女孩相亲认错人，将错就错与千亿霸总当天领证！ - Original Quality.mkv":
        raise RuntimeError("Source ID did not resolve to the expected Chinese episode.")
    if dubbed_meta.get("name") != "الحلقة_مدبلجة_بالعربية.mkv":
        raise RuntimeError("Dubbed video ID did not resolve to the expected current Arabic dub.")
    if source_meta.get("mimeType") != "video/matroska" or dubbed_meta.get("mimeType") != "video/matroska":
        raise RuntimeError("Unexpected source/dubbed video MIME type.")
    sd = float(source_meta.get("videoMediaMetadata", {}).get("durationMillis", 0)) / 1000
    dd = float(dubbed_meta.get("videoMediaMetadata", {}).get("durationMillis", 0)) / 1000
    if abs(sd - dd) > 1.0 or abs(sd - 6154.0) > 3.0:
        raise RuntimeError("Source/dub duration mismatch: " + str(sd) + " vs " + str(dd))

    update_progress("downloading_assets", source_duration=sd, dubbed_duration=dd)
    reports_zip = download_drive(REPORTS_ID, ASSET_DIR / "reports.zip")
    voices_zip = download_drive(VOICE_ARCHIVE_ID, ASSET_DIR / "voices_06_10.zip")
    source_video = download_drive(SOURCE_ID, ASSET_DIR / "source_chinese.mkv", source_meta)
    dubbed_video = download_drive(DUBBED_ID, ASSET_DIR / "current_dub.mkv", dubbed_meta)
    individual_paths = {}
    for name, fid in INDIVIDUAL_VOICES.items():
        meta = drive_meta(fid)
        if meta.get("name") != name:
            raise RuntimeError("Voice file ID/name mismatch for " + name)
        individual_paths[name] = download_drive(fid, VOICE_DIR / name, meta)

    with zipfile.ZipFile(reports_zip) as z:
        z.extractall(ASSET_DIR / "reports")
    with zipfile.ZipFile(voices_zip) as z:
        z.extractall(VOICE_DIR)
    report_dir = ASSET_DIR / "reports"
    manifest = json.loads((report_dir / "render_manifest.json").read_text(encoding="utf-8-sig"))
    final_probe = json.loads((report_dir / "final_probe.json").read_text(encoding="utf-8-sig"))
    mapping = json.loads((report_dir / "source_to_arabic_lines.json").read_text(encoding="utf-8-sig"))
    voice_timing = json.loads((report_dir / "voice_line_timing.json").read_text(encoding="utf-8-sig"))

    voice_paths = {}
    for t in voice_timing.get("tracks", []):
        fn = t["track_file"]
        voice_paths[fn] = voice_path_for(fn)
    if len(voice_paths) != 10:
        raise RuntimeError("The report must resolve exactly ten supplied voice masters.")
    for fn, p in voice_paths.items():
        if not p.is_file() or p.stat().st_size == 0:
            raise RuntimeError("Missing/empty WAV: " + fn)

    update_progress("verifying_hashes")
    source_hash = sha256(source_video)
    dubbed_hash = sha256(dubbed_video)
    expected_source_hash = manifest.get("source_video_sha256")
    expected_dub_hash = manifest.get("video_sha256")
    if expected_source_hash and source_hash != expected_source_hash:
        raise RuntimeError("The downloaded source video SHA256 does not match the report's source identity.")
    if expected_dub_hash and dubbed_hash != expected_dub_hash:
        raise RuntimeError("The downloaded current dubbed video SHA256 does not match its render manifest.")
    source_probe = probe(source_video)
    dubbed_probe = probe(dubbed_video)

    groups = mapped_groups(mapping.get("assignments", []))
    rendered_keys = {(x.get("speaker_script_id"), int(x.get("utterance_index") or 0))
                     for x in manifest.get("lines", [])}
    expected_count = sum(len(t.get("utterances", [])) for t in voice_timing.get("tracks", []))
    expected_keys = {(t["speaker_id"], int(u["utterance_index"]))
                     for t in voice_timing.get("tracks", []) for u in t.get("utterances", [])}
    missing_keys = sorted(expected_keys - rendered_keys)
    missing_plan = infer_missing_times(voice_timing.get("tracks", []),
                                       mapping.get("assignments", []), groups, rendered_keys)
    status_counts = collections.Counter(x["status"] for x in missing_plan)

    audit = {
        "status": "assets_verified",
        "source": {"id": SOURCE_ID, "name": source_meta["name"], "bytes": source_video.stat().st_size,
                   "duration_seconds": sd, "sha256": source_hash, "probe": source_probe.get("format", {})},
        "current_dub": {"id": DUBBED_ID, "name": dubbed_meta["name"], "bytes": dubbed_video.stat().st_size,
                        "duration_seconds": dd, "sha256": dubbed_hash, "probe": dubbed_probe.get("format", {})},
        "report_counts": {k: manifest.get(k) for k in
                          ["matched_line_count", "source_assignments_count", "unmatched_assignments",
                           "low_confidence_assignments", "timing_overrun_count"]},
        "voice_master_count": len(voice_paths),
        "voice_master_names": sorted(voice_paths),
        "expected_utterance_count": expected_count,
        "rendered_utterance_count": len(rendered_keys),
        "missing_utterance_count": len(missing_keys),
        "missing_utterances": [{"speaker_script_id": x[0], "utterance_index": x[1]} for x in missing_keys],
        "missing_timeline_status_counts": dict(status_counts),
        "background_method_from_original_render": manifest.get("background_method"),
        "video_codec_from_original_render": manifest.get("video_codec"),
    }
    atomic_json(AUDIT_PATH, audit)
    update_progress("assets_verified", **{k: audit[k] for k in
                    ["expected_utterance_count", "rendered_utterance_count", "missing_utterance_count"]})
    sync_json(AUDIT_PATH, OUTPUT_FOLDER_ID)

    plan = {
        "schema": 1,
        "source_video_sha256": source_hash,
        "current_dub_sha256": dubbed_hash,
        "expected_utterances": expected_count,
        "already_rendered": len(rendered_keys),
        "missing_utterances": missing_plan,
        "summary": dict(status_counts),
        "policy": "Only source-assigned or uniquely matched missing lines may be mixed. No TTS, no alternate voices.",
    }
    atomic_json(PLAN_PATH, plan)
    sync_json(PLAN_PATH, OUTPUT_FOLDER_ID)

    unresolved = [x for x in missing_plan if x["status"] not in
                  ("mapped_from_assignment", "inferred_from_unmatched_asr_translation")]
    if unresolved:
        qa = {
            "status": "BLOCKED_UNRESOLVED_DIALOGUE_TIMING",
            "reason": "At least one missing utterance has no sufficiently confident source-time match. No final video was rendered.",
            "unresolved_count": len(unresolved),
            "unresolved": unresolved,
            "assets_verified": True,
            "source_duration_seconds": sd,
            "dubbed_duration_seconds": dd,
            "voice_masters": len(voice_paths),
        }
        atomic_json(QA_PATH, qa)
        sync_json(QA_PATH, OUTPUT_FOLDER_ID)
        update_progress("blocked_unresolved_timing", unresolved_count=len(unresolved))
        raise RuntimeError("Safe stop: missing lines remain without a reliable source-time match. See timeline_plan.json.")

    # Validate every missing clip window and prepare audio snippets without re-synthesizing.
    clips = []
    for item in missing_plan:
        sid, idx = item["speaker_script_id"], int(item["utterance_index"])
        track = next(t for t in voice_timing["tracks"] if t["speaker_id"] == sid)
        utterance = next(u for u in track["utterances"] if int(u["utterance_index"]) == idx)
        wav = voice_paths[track["track_file"]]
        source_start = float(item["source_start"])
        source_end = float(item["source_end"])
        voice_start = float(utterance["track_start_seconds"])
        voice_end = float(utterance["track_end_seconds"])
        voice_duration = voice_end - voice_start
        target_duration = source_end - source_start
        if source_start < 0 or source_end > sd + 0.25 or target_duration <= 0.15:
            raise RuntimeError("Invalid source timing for " + sid + "/" + str(idx))
        speed = voice_duration / target_duration
        if not 0.70 <= speed <= 1.45:
            raise RuntimeError("Unsafe speech time-stretch for " + sid + "/" + str(idx) +
                               ": atempo=" + str(round(speed, 3)))
        for old in manifest.get("lines", []):
            if old.get("speaker_script_id") == sid and int(old.get("utterance_index") or 0) == idx:
                continue
            ov = max(0.0, min(source_end, float(old["source_end"])) -
                     max(source_start, float(old["source_start"])))
            if ov > min(1.0, 0.35 * target_duration):
                raise RuntimeError("Candidate missing line overlaps an existing line; manual check needed: " +
                                   sid + "/" + str(idx))
        clip = CLIP_DIR / (sid + "_" + str(idx).zfill(2) + ".wav")
        run(["ffmpeg", "-y", "-ss", str(voice_start), "-i", str(wav), "-t", str(voice_duration),
             "-vn", "-af", "atempo=" + str(speed), "-ar", "48000", "-ac", "2",
             "-c:a", "pcm_s16le", str(clip)], "prepare missing voice " + sid + "/" + str(idx), timeout=240)
        clips.append({"file": str(clip), "start": source_start, "duration": target_duration,
                      "speaker": sid, "utterance_index": idx, "atempo": speed})

    update_progress("mixing_missing_lines", missing_clip_count=len(clips))
    # Keep the already-rendered picture and mix, then insert only missing Arabic speech.
    inputs = ["ffmpeg", "-y", "-i", str(dubbed_video)]
    for c in clips:
        inputs += ["-i", c["file"]]
    labels = []
    filters = ["[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[base]"]
    for i, c in enumerate(clips, start=1):
        delay = int(round(c["start"] * 1000))
        label = "m" + str(i)
        filters.append("[" + str(i) + ":a]adelay=" + str(delay) + "|" + str(delay) + "[" + label + "]")
        labels.append("[" + label + "]")
    mix_inputs = "[base]" + "".join(labels)
    filters.append(mix_inputs + "amix=inputs=" + str(len(clips) + 1) +
                   ":duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[mix]")
    cmd = inputs + ["-filter_complex", ";".join(filters), "-map", "0:v:0", "-map", "[mix]",
                    "-map_metadata", "0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                    "-ar", "48000", "-ac", "2", "-shortest", "-f", "matroska", str(FINAL_PATH)]
    run(cmd, "render repaired final MKV", timeout=14400)
    if not FINAL_PATH.is_file() or FINAL_PATH.stat().st_size < 100_000_000:
        raise RuntimeError("Final render missing or unexpectedly small.")

    update_progress("quality_assurance")
    final_probe = probe(FINAL_PATH)
    # Full decode catches corrupt packets without re-encoding the picture.
    run(["ffmpeg", "-v", "error", "-i", str(FINAL_PATH), "-f", "null", "-"],
        "full video/audio decode QA", timeout=7200)
    final_duration = float(final_probe.get("format", {}).get("duration") or 0)
    streams = final_probe.get("streams", [])
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), {})
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), {})
    if abs(final_duration - sd) > 1.0:
        raise RuntimeError("Final video duration does not match source.")
    if video_stream.get("width") != 1080 or video_stream.get("height") != 1920:
        raise RuntimeError("Final frame geometry changed unexpectedly.")
    if audio_stream.get("sample_rate") != "48000" or int(audio_stream.get("channels") or 0) != 2:
        raise RuntimeError("Final audio is not 48 kHz stereo.")
    frame_qa = make_contact_sheet(FINAL_PATH, ROOT / "contact_sheet.jpg", final_duration)
    final_hash = sha256(FINAL_PATH)

    qa = {
        "status": "rendered_and_technical_checks_passed",
        "final_filename": FINAL_PATH.name,
        "final_size_bytes": FINAL_PATH.stat().st_size,
        "final_sha256": final_hash,
        "duration_seconds": final_duration,
        "video_codec": video_stream.get("codec_name"),
        "width": video_stream.get("width"), "height": video_stream.get("height"),
        "audio_codec": audio_stream.get("codec_name"),
        "sample_rate": audio_stream.get("sample_rate"), "channels": audio_stream.get("channels"),
        "full_decode": "passed",
        "sampled_visual_frames": frame_qa,
        "added_missing_utterances": len(clips),
        "voice_replacement_or_synthesis": "none; used only the ten existing WAV masters",
        "visual_lip_animation": "not applied; picture stream copied unchanged",
        "lip_timing": "added lines placed at source speech intervals; phoneme-level facial animation is not claimed",
        "audio_review_limit": "technical decode/levels/timing checks completed; human listening review is not available in this automated runner",
    }
    atomic_json(QA_PATH, qa)

    # Create output folder/checkpoint record first; upload final using resumable Drive API.
    update_progress("uploading_final", final_bytes=FINAL_PATH.stat().st_size)
    uploaded = upload_drive_file(FINAL_PATH, FINAL_PATH.name, OUTPUT_FOLDER_ID, "video/x-matroska")
    remote_meta = DRIVE.files().get(
        fileId=uploaded["id"], fields="id,name,size,md5Checksum,webViewLink",
        supportsAllDrives=True,
    ).execute(num_retries=4)
    if int(remote_meta.get("size") or 0) != FINAL_PATH.stat().st_size:
        raise RuntimeError("Uploaded final MKV size does not match local output.")
    atomic_json(QA_PATH, {**qa, "drive_file_id": uploaded["id"],
                          "drive_web_view_link": remote_meta.get("webViewLink"),
                          "drive_md5": remote_meta.get("md5Checksum")})
    sync_json(QA_PATH, OUTPUT_FOLDER_ID)
    sync_json(ROOT / "contact_sheet.jpg", OUTPUT_FOLDER_ID, "image/jpeg")
    update_progress("completed", final_file_id=uploaded["id"], final_sha256=final_hash)
    log("FINAL_RENDER_COMPLETE " + str(remote_meta.get("webViewLink")))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        log("TASK_FAILED " + type(exc).__name__ + ": " + str(exc))
        atomic_json(QA_PATH, {"status": "failed_or_blocked", "error_type": type(exc).__name__,
                              "error": str(exc), "elapsed_seconds": round(time.time() - STARTED, 1)})
        if CHECKPOINT_FOLDER_ID:
            sync_json(QA_PATH, CHECKPOINT_FOLDER_ID)
            sync_json(PROGRESS_PATH, CHECKPOINT_FOLDER_ID)
        log(traceback.format_exc()[-6000:])
        raise
