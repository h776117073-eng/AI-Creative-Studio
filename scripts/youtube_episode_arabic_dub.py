#!/usr/bin/env python3
"""Authorized YouTube -> Arabic multi-speaker dub on Google Colab.

Pipeline: yt-dlp download, faster-whisper word-timed ASR, SpeechBrain speaker
embeddings/clustering, Arabic translation, Microsoft Edge neural TTS with
WordBoundary metadata, Demucs vocal/instrumental separation, chunked audio mix,
MP4 mux, and resumable Google Drive checkpoints.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tarfile
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path("/content/youtube_arabic_dub")
WORK = ROOT / "work"
CLIPS = WORK / "clips"
LOG = ROOT / "run.log"
PROGRESS = ROOT / "progress.json"
CONFIG_PATH = Path("/content/dub_config.json")
CREDENTIALS_PATH = Path("/content/.private/google_adc.json")
SAMPLE_RATE = 16000
MAX_TEMPO = 1.25
CHUNK_SECONDS = 45


def log(message: str) -> None:
    line = f"[{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}] {message}"
    print(line, flush=True)
    ROOT.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def atomic_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def run(cmd: list[str], timeout: int | None = None, cwd: Path | None = None) -> None:
    log("$ " + " ".join(str(x) for x in cmd))
    start = time.time()
    with subprocess.Popen(
        [str(x) for x in cmd], cwd=str(cwd) if cwd else None,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        errors="replace", bufsize=1
    ) as proc:
        assert proc.stdout is not None
        for line in proc.stdout:
            print(line.rstrip(), flush=True)
            ROOT.mkdir(parents=True, exist_ok=True)
            with LOG.open("a", encoding="utf-8") as f:
                f.write(line)
            if timeout and time.time() - start > timeout:
                proc.kill()
                raise TimeoutError(f"Command exceeded {timeout}s")
        code = proc.wait()
    if code:
        raise RuntimeError(f"Command failed with exit code {code}: {cmd[0]}")


def probe_duration(path: Path) -> float:
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True, capture_output=True, text=True
    )
    value = float(p.stdout.strip())
    if value <= 0:
        raise RuntimeError("Video duration is invalid")
    return value


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(2 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


class DriveStore:
    def __init__(self, parent_id: str):
        import google.auth
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload
        from google.auth.transport.requests import Request
        creds, _ = google.auth.load_credentials_from_file(str(CREDENTIALS_PATH))
        if not creds.valid and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        self.api = build("drive", "v3", credentials=creds, cache_discovery=False)
        self.MediaFileUpload = MediaFileUpload
        self.MediaIoBaseDownload = MediaIoBaseDownload
        self.parent_id = parent_id
        self.folder_id = self.ensure_folder("checkpoints", parent_id)

    def ensure_folder(self, name: str, parent: str) -> str:
        safe = name.replace("'", "\\'")
        q = (f"name='{safe}' and '{parent}' in parents and "
             "mimeType='application/vnd.google-apps.folder' and trashed=false")
        data = self.api.files().list(
            q=q, pageSize=50, fields="files(id,name)",
            supportsAllDrives=True, includeItemsFromAllDrives=True
        ).execute(num_retries=3)
        if data.get("files"):
            return data["files"][0]["id"]
        item = self.api.files().create(
            body={"name": name, "mimeType": "application/vnd.google-apps.folder", "parents": [parent]},
            fields="id,name", supportsAllDrives=True
        ).execute(num_retries=3)
        return item["id"]

    def find(self, name: str, parent: str | None = None):
        parent = parent or self.folder_id
        safe = name.replace("'", "\\'")
        q = f"name='{safe}' and '{parent}' in parents and trashed=false"
        data = self.api.files().list(
            q=q, pageSize=20, fields="files(id,name,size,md5Checksum)",
            supportsAllDrives=True, includeItemsFromAllDrives=True
        ).execute(num_retries=3)
        return data.get("files", [])

    def upload(self, path: Path, name: str | None = None, parent: str | None = None):
        parent = parent or self.folder_id
        name = name or path.name
        matches = self.find(name, parent)
        media = self.MediaFileUpload(
            str(path), mimetype="application/octet-stream", resumable=True,
            chunksize=32 * 1024 * 1024
        )
        if matches:
            request = self.api.files().update(
                fileId=matches[0]["id"], media_body=media, fields="id,name,size,md5Checksum",
                supportsAllDrives=True
            )
        else:
            request = self.api.files().create(
                body={"name": name, "parents": [parent]},
                media_body=media, fields="id,name,size,md5Checksum", supportsAllDrives=True
            )
        response = None
        while response is None:
            status, response = request.next_chunk(num_retries=5)
            if status:
                log(f"Drive upload {name}: {status.progress() * 100:.1f}%")
        return response

    def download(self, file_id: str, destination: Path) -> None:
        from googleapiclient.http import MediaIoBaseDownload
        req = self.api.files().get_media(fileId=file_id, supportsAllDrives=True)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("wb") as f:
            downloader = MediaIoBaseDownload(f, req, chunksize=16 * 1024 * 1024)
            done = False
            while not done:
                _, done = downloader.next_chunk(num_retries=4)

    def restore_checkpoints(self) -> None:
        q = f"'{self.folder_id}' in parents and trashed=false"
        data = self.api.files().list(
            q=q, pageSize=1000, fields="files(id,name)",
            supportsAllDrives=True, includeItemsFromAllDrives=True
        ).execute(num_retries=3)
        for item in sorted(data.get("files", []), key=lambda x: x["name"]):
            if not item["name"].startswith("tts_checkpoint_") or not item["name"].endswith(".tar.gz"):
                continue
            archive = WORK / item["name"]
            try:
                self.download(item["id"], archive)
                with tarfile.open(archive, "r:gz") as tar:
                    for member in tar.getmembers():
                        target = (CLIPS / member.name).resolve()
                        if CLIPS.resolve() not in target.parents and target != CLIPS.resolve():
                            raise RuntimeError("Unsafe checkpoint archive path")
                    tar.extractall(CLIPS)
                log(f"Restored {item['name']} from Drive")
            finally:
                archive.unlink(missing_ok=True)


def update_progress(stage: str, **fields) -> None:
    payload = {"stage": stage, "updated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **fields}
    atomic_json(PROGRESS, payload)
    log("STAGE=" + stage)


def download_source(url: str) -> Path:
    WORK.mkdir(parents=True, exist_ok=True)
    base = WORK / "source.%(ext)s"
    run([
        "yt-dlp", "--no-playlist", "--newline", "--retries", "10",
        "--fragment-retries", "10", "--merge-output-format", "mp4",
        "-f", "bv*+ba/b", "-o", str(base), url
    ], timeout=7200)
    candidates = [
        p for p in WORK.glob("source.*")
        if p.is_file() and p.suffix.lower() not in {".json", ".part", ".ytdl"}
    ]
    if not candidates:
        raise RuntimeError("yt-dlp completed but no downloaded video was found")
    source = max(candidates, key=lambda p: p.stat().st_size)
    if source.stat().st_size < 1_000_000:
        raise RuntimeError("Downloaded video is unexpectedly small")
    return source


def autocorr_pitch(samples: np.ndarray) -> float | None:
    x = np.asarray(samples, dtype=np.float32).reshape(-1)
    if len(x) < int(SAMPLE_RATE * 0.25):
        return None
    f0s = []
    frame = int(SAMPLE_RATE * 0.025)
    for pos in np.linspace(0, max(0, len(x) - frame), num=min(18, max(1, len(x) // frame)), dtype=int):
        y = x[pos:pos + frame]
        if len(y) != frame or float(np.sqrt(np.mean(y * y))) < 0.008:
            continue
        y = y - y.mean()
        corr = np.correlate(y, y, mode="full")[len(y)-1:]
        low, high = max(1, int(SAMPLE_RATE / 350)), min(len(corr)-1, int(SAMPLE_RATE / 70))
        if high > low:
            lag = low + int(np.argmax(corr[low:high]))
            hz = SAMPLE_RATE / lag
            if 70 <= hz <= 350:
                f0s.append(hz)
    return float(np.median(f0s)) if f0s else None


def transcribe(audio_path: Path, digest: str, device: str) -> tuple[list[dict], str]:
    cache = WORK / "asr.json"
    if cache.is_file():
        old = json.loads(cache.read_text(encoding="utf-8"))
        if old.get("audio_sha256") == digest and old.get("segments"):
            log(f"Restored ASR checkpoint: {len(old['segments'])} segments")
            return old["segments"], old.get("language", "unknown")
    from faster_whisper import WhisperModel
    model_name = "medium" if device == "cuda" else "small"
    compute = "float16" if device == "cuda" else "int8"
    log(f"Loading faster-whisper {model_name} on {device}/{compute}")
    model = WhisperModel(model_name, device=device, compute_type=compute)
    iterator, info = model.transcribe(
        str(audio_path), beam_size=3, vad_filter=True,
        word_timestamps=True, condition_on_previous_text=True
    )
    segments = []
    for raw in iterator:
        text = re.sub(r"\s+", " ", (raw.text or "")).strip()
        if not text:
            continue
        words = []
        for w in (raw.words or []):
            wt = (w.word or "").strip()
            if wt:
                words.append({"text": wt, "start": float(w.start), "end": float(w.end)})
        segments.append({
            "index": len(segments), "start": float(raw.start), "end": float(raw.end),
            "text": text, "words": words
        })
        if len(segments) % 100 == 0:
            log(f"ASR segments: {len(segments)}")
    if not segments:
        raise RuntimeError("Whisper did not detect speech; refusing to make an empty dub")
    language = str(info.language or "unknown")
    atomic_json(cache, {"audio_sha256": digest, "language": language, "segments": segments})
    return segments, language


def diarize(audio_path: Path, segments: list[dict], device: str) -> tuple[list[dict], dict]:
    cache = WORK / "speaker_profiles.json"
    if cache.is_file():
        old = json.loads(cache.read_text(encoding="utf-8"))
        if old.get("segment_count") == len(segments) and old.get("segments"):
            log(f"Restored speaker checkpoint: {old.get('speaker_count')} speakers")
            return old["segments"], old["profiles"]
    import torch
    from speechbrain.inference.speaker import EncoderClassifier
    from sklearn.cluster import AgglomerativeClustering

    wav, sr = sf.read(str(audio_path), dtype="float32")
    if wav.ndim > 1:
        wav = wav.mean(axis=1)
    if sr != SAMPLE_RATE:
        raise RuntimeError("Diarization audio must be 16 kHz mono")
    encoder = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir=str(WORK / "models" / "speechbrain-ecapa"),
        run_opts={"device": device}
    )
    positions, vectors, pitches = [], [], {}
    for i, seg in enumerate(segments):
        a = max(0, int(seg["start"] * SAMPLE_RATE))
        b = min(len(wav), int(seg["end"] * SAMPLE_RATE))
        crop = wav[a:b]
        pitches[i] = autocorr_pitch(crop)
        if len(crop) < int(SAMPLE_RATE * 0.85):
            continue
        tensor = torch.from_numpy(crop.copy()).float().unsqueeze(0).to(device)
        with torch.no_grad():
            emb = encoder.encode_batch(tensor).squeeze().detach().cpu().numpy().astype(np.float32)
        emb /= max(float(np.linalg.norm(emb)), 1e-9)
        positions.append(i)
        vectors.append(emb)
        if len(vectors) % 100 == 0:
            log(f"Speaker embeddings: {len(vectors)}")
    if not vectors:
        raise RuntimeError("No sufficiently long speech turns for speaker diarization")
    matrix = np.stack(vectors)
    if len(matrix) == 1:
        labels = np.array([0])
    elif len(matrix) == 2:
        labels = np.array([0, 1])
    else:
        labels = AgglomerativeClustering(
            n_clusters=None, distance_threshold=0.34, metric="cosine", linkage="average"
        ).fit_predict(matrix)
        if len(set(labels.tolist())) > 12:
            labels = AgglomerativeClustering(
                n_clusters=12, metric="cosine", linkage="average"
            ).fit_predict(matrix)
    assigned = {pos: int(label) for pos, label in zip(positions, labels)}
    for i in range(len(segments)):
        if i not in assigned:
            near = min(positions, key=lambda j: abs(segments[j]["start"] - segments[i]["start"]))
            assigned[i] = assigned[near]
    clusters = sorted(set(assigned.values()), key=lambda c: min(
        segments[i]["start"] for i, label in assigned.items() if label == c
    ))
    normalized = {old: f"speaker_{i+1:02d}" for i, old in enumerate(clusters)}
    counts = defaultdict(lambda: {"turns": 0, "duration": 0.0, "pitch": []})
    enriched = []
    for i, seg in enumerate(segments):
        sid = normalized[assigned[i]]
        item = dict(seg)
        item["speaker_id"] = sid
        enriched.append(item)
        p = counts[sid]
        p["turns"] += 1
        p["duration"] += max(0.0, seg["end"] - seg["start"])
        if pitches[i]:
            p["pitch"].append(pitches[i])
    profiles = {}
    total_speech = sum(p["duration"] for p in counts.values()) or 1
    for sid, p in counts.items():
        median = float(np.median(p["pitch"])) if p["pitch"] else None
        if median is None:
            gender = "غير محسوم صوتيًا"
            age = "غير قابل للتقدير من العينة"
        elif median >= 175:
            gender = "نبرة أنثوية مرجحة (تقدير صوتي)"
            age = "نبرة عالية/يافعة محتملة؛ لا تثبت العمر الحقيقي"
        elif median <= 150:
            gender = "نبرة ذكورية مرجحة (تقدير صوتي)"
            age = "نبرة منخفضة/ناضجة محتملة؛ لا تثبت العمر الحقيقي"
        else:
            gender = "نبرة متوسطة غير حاسمة"
            age = "غير قابل للتحديد بدقة من الصوت وحده"
        share = p["duration"] / total_speech
        role = ("الشخصية الأكثر حضورًا (تقديريًا)" if share >= 0.30 else
                "شخصية مساندة (تقديريًا)" if share >= 0.10 else "متحدث ثانوي (تقديريًا)")
        profiles[sid] = {
            "turns": p["turns"], "speech_seconds": round(p["duration"], 2),
            "speech_share": round(share, 4), "median_pitch_hz": round(median, 1) if median else None,
            "voice_presentation": gender, "perceived_age_hint": age, "role_estimate": role
        }
    atomic_json(cache, {"segment_count": len(enriched), "speaker_count": len(profiles),
                         "segments": enriched, "profiles": profiles})
    log(f"Speaker diarization complete: {len(profiles)} clusters")
    return enriched, profiles


def choose_voices(profiles: dict) -> dict:
    import edge_tts
    available = asyncio.run(edge_tts.list_voices())
    arabic = [v for v in available if str(v.get("ShortName", "")).startswith("ar-")
              and "Neural" in str(v.get("ShortName", ""))]
    if not arabic:
        raise RuntimeError("Microsoft Edge TTS returned no Arabic neural voices")
    female = [v for v in arabic if str(v.get("Gender", "")).lower() == "female"]
    male = [v for v in arabic if str(v.get("Gender", "")).lower() == "male"]
    # Prefer clear, commonly available Saudi/Egyptian Arabic neural voices.
    def rank(v):
        name = v["ShortName"]
        return (0 if any(x in name for x in ("ar-SA-", "ar-EG-", "ar-AE-")) else 1, name)
    female.sort(key=rank)
    male.sort(key=rank)
    any_pool = sorted(arabic, key=rank)
    used = {"female": 0, "male": 0, "any": 0}
    mapping = {}
    for sid, p in sorted(profiles.items()):
        group = "female" if "أنثوية" in p["voice_presentation"] else "male" if "ذكورية" in p["voice_presentation"] else "any"
        pool = female if group == "female" else male if group == "male" else any_pool
        if not pool:
            pool, group = any_pool, "any"
        idx = used[group]
        voice = pool[idx % len(pool)]
        used[group] += 1
        reuse = idx >= len(pool)
        # If the catalog is exhausted, retain a distinct pitch/rate treatment per character.
        pitch_step = ((idx // max(1, len(pool))) % 5) - 2 if reuse else 0
        mapping[sid] = {
            "voice": voice["ShortName"], "voice_gender": voice.get("Gender"),
            "locale": voice.get("Locale"), "voice_reused": reuse,
            "pitch": f"{pitch_step:+d}Hz", "rate": "+0%"
        }
    return mapping


def translate_text(text: str, translator, source_language: str) -> str:
    if source_language == "ar":
        return text
    last = None
    for attempt in range(4):
        try:
            result = translator.translate(text)
            if not result or not str(result).strip():
                raise RuntimeError("Empty translation")
            return re.sub(r"\s+", " ", str(result)).strip()
        except Exception as exc:
            last = exc
            time.sleep(min(6, 1.5 ** attempt))
    raise RuntimeError(f"Arabic translation failed: {type(last).__name__ if last else 'unknown'}")


async def synth_one(item: dict, path: Path, voice_info: dict) -> dict:
    import edge_tts
    communicator = edge_tts.Communicate(
        item["arabic"], voice_info["voice"], rate=voice_info["rate"],
        pitch=voice_info["pitch"], boundary="WordBoundary"
    )
    boundaries = []
    with path.open("wb") as audio:
        async for message in communicator.stream():
            if message["type"] == "audio":
                audio.write(message["data"])
            elif message["type"] == "WordBoundary":
                boundaries.append({
                    "text": message.get("text", ""),
                    "offset": float(message.get("offset", 0)) / 10_000_000,
                    "duration": float(message.get("duration", 0)) / 10_000_000
                })
    if not path.is_file() or path.stat().st_size < 100:
        raise RuntimeError("Microsoft TTS returned an empty speech clip")
    return {"boundaries": boundaries}


def make_checkpoint(indices: list[int], manifest: dict, drive: DriveStore) -> None:
    archive = WORK / f"tts_checkpoint_{indices[0]:06d}_{indices[-1]:06d}.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for idx in indices:
            for suffix in (".mp3", ".wav", ".json"):
                path = CLIPS / f"{idx:06d}{suffix}"
                if path.is_file():
                    tar.add(path, arcname=path.name)
        tar.add(CLIPS / "clip_manifest.json", arcname="clip_manifest.json")
    drive.upload(archive, archive.name)
    archive.unlink(missing_ok=True)
    atomic_json(CLIPS / "clip_manifest.json", manifest)


def synthesize_all(segments: list[dict], profiles: dict, voices: dict,
                   source_language: str, drive: DriveStore) -> list[dict]:
    from deep_translator import GoogleTranslator
    translator = GoogleTranslator(source="auto", target="ar")
    CLIPS.mkdir(parents=True, exist_ok=True)
    manifest_path = CLIPS / "clip_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {"items": {}}
    translated = []

    # Reuse full per-segment metadata, translation and generated speech when fingerprints match.
    for pos, seg in enumerate(segments):
        idx = int(seg["index"])
        sid = seg["speaker_id"]
        fingerprint = hashlib.sha256((seg["text"] + sid + voices[sid]["voice"]).encode("utf-8")).hexdigest()
        meta = CLIPS / f"{idx:06d}.json"
        wav = CLIPS / f"{idx:06d}.wav"
        mp3 = CLIPS / f"{idx:06d}.mp3"
        entry = manifest["items"].get(str(idx), {})
        data = {}
        if meta.is_file():
            try:
                cached = json.loads(meta.read_text(encoding="utf-8"))
                if cached.get("fingerprint") == fingerprint:
                    data = cached
            except Exception:
                data = {}
        if not data:
            arabic = entry.get("arabic") if entry.get("fingerprint") == fingerprint else None
            if not arabic:
                arabic = translate_text(seg["text"], translator, source_language)
            data = {
                "index": idx, "start": seg["start"], "end": seg["end"],
                "speaker_id": sid, "source": seg["text"], "arabic": arabic,
                "fingerprint": fingerprint
            }
        data["index"] = idx
        data["start"] = seg["start"]
        data["end"] = seg["end"]
        data["speaker_id"] = sid
        data["source"] = seg["text"]
        data["fingerprint"] = fingerprint
        translated.append(data)
        if not (wav.is_file() and wav.stat().st_size > 500 and data.get("tts_words")):
            atomic_json(meta, data)

        if (pos + 1) % 100 == 0:
            log(f"Translation and checkpoint scan: {pos + 1}/{len(segments)} segments")

    translated.sort(key=lambda x: x["index"])
    atomic_json(WORK / "arabic_segments.json", {"segments": translated, "source_language": source_language})
    update_progress("translation_complete", segments=len(translated), speakers=len(profiles))
    drive.upload(WORK / "arabic_segments.json", "arabic_segments.json", drive.parent_id)

    async def worker(item):
        idx = item["index"]
        sid = item["speaker_id"]
        mp3 = CLIPS / f"{idx:06d}.mp3"
        result = await synth_one(item, mp3, voices[sid])
        return idx, result

    async def produce():
        todo = []
        for item in translated:
            idx = item["index"]
            wav = CLIPS / f"{idx:06d}.wav"
            if not (wav.is_file() and wav.stat().st_size > 500 and item.get("tts_words")):
                todo.append(item)
        log(f"Microsoft Edge Neural TTS: {len(translated)-len(todo)} cached, {len(todo)} pending")
        sem = asyncio.Semaphore(4)

        async def limited(item):
            async with sem:
                return await worker(item)

        for start in range(0, len(todo), 32):
            batch = todo[start:start+32]
            results = await asyncio.gather(*(limited(x) for x in batch))
            batch_indices = []
            for idx, meta_data in results:
                item = next(x for x in translated if x["index"] == idx)
                mp3 = CLIPS / f"{idx:06d}.mp3"
                wav = CLIPS / f"{idx:06d}.wav"
                duration = probe_duration(mp3)
                window = max(0.35, float(item["end"])-float(item["start"]))
                tempo = min(MAX_TEMPO, max(1.0, duration / window))
                run(["ffmpeg", "-y", "-v", "error", "-i", str(mp3),
                     "-af", f"atempo={tempo:.5f}", "-ac", "1", "-ar", "24000",
                     "-c:a", "pcm_s16le", str(wav)], timeout=180)
                item["atempo"] = tempo
                item["tts_words"] = meta_data["boundaries"]
                item["clip_duration"] = duration / tempo
                atomic_json(CLIPS / f"{idx:06d}.json", item)
                manifest["items"][str(idx)] = {
                    "fingerprint": item["fingerprint"], "arabic": item["arabic"],
                    "voice": voices[item["speaker_id"]]["voice"], "attempo": tempo
                }
                batch_indices.append(idx)
            atomic_json(manifest_path, manifest)
            log(f"TTS batch complete: {min(start+len(batch), len(todo))}/{len(todo)} new clips")
            drive.upload(manifest_path, "clip_manifest.json")
            make_checkpoint(batch_indices, manifest, drive)
        return

    asyncio.run(produce())
    # Refresh cached metadata after synthesis so word timings and clip lengths are available to the mixer.
    for item in translated:
        meta = json.loads((CLIPS / f"{item['index']:06d}.json").read_text(encoding="utf-8"))
        item.update(meta)
    return translated

def write_word_srt(segments: list[dict], output: Path) -> None:
    def stamp(seconds: float) -> str:
        millis = max(0, int(seconds * 1000))
        h, millis = divmod(millis, 3_600_000)
        m, millis = divmod(millis, 60_000)
        s, ms = divmod(millis, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    rows = []
    n = 1
    for item in segments:
        start = float(item["start"])
        tempo = float(item.get("attempo", item.get("atempo", 1.0)))
        boundaries = item.get("tts_words", [])
        for word in boundaries:
            text = re.sub(r"\s+", " ", str(word.get("text", ""))).strip()
            if not text:
                continue
            a = start + float(word["offset"]) / max(tempo, 1.0)
            b = a + max(0.08, float(word["duration"]) / max(tempo, 1.0))
            rows.append((a, b, text))
    rows.sort(key=lambda x: x[0])
    with output.open("w", encoding="utf-8") as f:
        for a, b, text in rows:
            f.write(f"{n}\n{stamp(a)} --> {stamp(b)}\n{text}\n\n")
            n += 1


def separate_background(stereo_audio: Path, outdir: Path, device: str) -> Path:
    target = outdir / "separated" / "htdemucs" / stereo_audio.stem / "no_vocals.wav"
    if target.is_file() and target.stat().st_size > 100_000:
        log("Reusing Demucs accompaniment stem")
        return target
    outdir.mkdir(parents=True, exist_ok=True)
    dev = "cuda" if device == "cuda" else "cpu"
    run([
        "python", "-m", "demucs", "-n", "htdemucs", "--two-stems=vocals",
        "--segment", "7.5", "--shifts", "0", "--overlap", "0.1",
        "-d", dev, "-o", str(outdir / "separated"), str(stereo_audio)
    ], timeout=21600)
    if not target.is_file() or target.stat().st_size < 100_000:
        raise RuntimeError("Demucs did not create the accompaniment/no_vocals stem")
    return target


def build_mix(segments: list[dict], background: Path, duration: float, output: Path) -> None:
    chunks = []
    for chunk_no, start in enumerate(np.arange(0, duration, CHUNK_SECONDS)):
        length = min(CHUNK_SECONDS, duration - float(start))
        candidates = []
        for item in segments:
            clip = CLIPS / f"{int(item['index']):06d}.wav"
            if not clip.is_file():
                continue
            a = float(item["start"])
            b = a + float(item.get("clip_duration", 0.0))
            if b > start and a < start + length:
                candidates.append((clip, a, b))
        voice_chunk = WORK / f"voice_{chunk_no:05d}.wav"
        if candidates:
            cmd = ["ffmpeg", "-y", "-v", "error"]
            for clip, _, _ in candidates:
                cmd.extend(["-i", str(clip)])
            filters = []
            labels = []
            for i, (clip, a, b) in enumerate(candidates):
                skip = max(0.0, float(start) - a)
                delay = max(0, int((a - float(start)) * 1000))
                filters.append(f"[{i}:a]atrim=start={skip:.4f},asetpts=PTS-STARTPTS,adelay={delay}|{delay},volume=1.0[v{i}]")
                labels.append(f"[v{i}]")
            filters.append("".join(labels) + f"amix=inputs={len(candidates)}:duration=longest:normalize=0,alimiter=limit=0.94,apad,atrim=duration={length:.4f}[out]")
            cmd += ["-filter_complex", ";".join(filters), "-map", "[out]",
                    "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(voice_chunk)]
            run(cmd, timeout=300)
        else:
            run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
                 "anullsrc=r=48000:cl=stereo", "-t", f"{length:.4f}",
                 "-c:a", "pcm_s16le", str(voice_chunk)], timeout=120)
        mix_chunk = WORK / f"mix_{chunk_no:05d}.wav"
        run(["ffmpeg", "-y", "-v", "error", "-ss", f"{float(start):.4f}",
             "-t", f"{length:.4f}", "-i", str(background), "-i", str(voice_chunk),
             "-filter_complex",
             "[0:a]volume=0.78[bg];[1:a]volume=1.0[vo];[bg][vo]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.96[out]",
             "-map", "[out]", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le",
             str(mix_chunk)], timeout=300)
        chunks.append(mix_chunk)
        if chunk_no % 10 == 0:
            update_progress("mixing_audio", completed_chunks=chunk_no+1,
                            total_chunks=math.ceil(duration / CHUNK_SECONDS))
    concat = WORK / "mix_concat.txt"
    concat.write_text("".join(f"file '{p.as_posix()}'\n" for p in chunks), encoding="utf-8")
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", str(concat), "-c:a", "pcm_s16le", str(output)], timeout=1800)


def upload_outputs(drive: DriveStore, files: list[Path]) -> None:
    for path in files:
        if path.is_file():
            drive.upload(path, path.name, drive.parent_id)


def main() -> None:
    if not CONFIG_PATH.is_file():
        raise FileNotFoundError(CONFIG_PATH)
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    url = str(config["youtube_url"])
    video_id = str(config["video_id"])
    drive_parent = str(config["drive_output_folder_id"])
    WORK.mkdir(parents=True, exist_ok=True)
    CLIPS.mkdir(parents=True, exist_ok=True)
    CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
    drive = DriveStore(drive_parent)
    drive.restore_checkpoints()
    # The Google ADC file is used only by this Colab VM and is never copied to the repository.
    update_progress("starting", video_id=video_id, output_folder_id=drive_parent)
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("FFmpeg/FFprobe are required in the Colab runtime")
    source = download_source(url)
    duration = probe_duration(source)
    update_progress("download_complete", source_file=source.name,
                    duration_seconds=round(duration, 2), size_bytes=source.stat().st_size)
    log(f"Downloaded source: {source.name}; duration={duration/60:.1f} minutes")
    stereo_audio = WORK / "source_44100_stereo.wav"
    mono_audio = WORK / "source_16k_mono.wav"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(source), "-vn",
         "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(stereo_audio)], timeout=3600)
    run(["ffmpeg", "-y", "-v", "error", "-i", str(source), "-vn",
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", str(mono_audio)], timeout=1800)
    digest = sha256(mono_audio)
    device = "cuda"
    try:
        import torch
        if not torch.cuda.is_available():
            device = "cpu"
    except Exception:
        device = "cpu"
    log(f"Compute device: {device}")
    update_progress("transcribing", duration_seconds=round(duration, 2), device=device)
    segments, language = transcribe(mono_audio, digest, device)
    drive.upload(WORK / "asr.json", "asr.json", drive.parent_id)
    update_progress("diarizing", source_language=language, asr_segments=len(segments))
    segments, profiles = diarize(mono_audio, segments, device)
    voices = choose_voices(profiles)
    for sid in profiles:
        profiles[sid]["microsoft_edge_voice"] = voices[sid]
    atomic_json(WORK / "speaker_profiles.json", {
        "speaker_count": len(profiles), "profiles": profiles, "segments": segments
    })
    drive.upload(WORK / "speaker_profiles.json", "speaker_profiles.json", drive.parent_id)
    update_progress("speakers_identified", speaker_count=len(profiles),
                    speaker_profiles=profiles)
    translated = synthesize_all(segments, profiles, voices, language, drive)
    update_progress("tts_complete", speaker_count=len(profiles), segments=len(translated),
                    word_boundary_segments=sum(bool(x.get("tts_words")) for x in translated))
    try:
        background = separate_background(stereo_audio, WORK, device)
        separation_status = "Demucs htdemucs: vocals separated; accompaniment stem used as music/SFX bed"
    except Exception as exc:
        log(f"WARNING: Demucs separation failed: {type(exc).__name__}: {exc}")
        background = stereo_audio
        separation_status = f"Fallback: original audio reduced in mix; separation failed ({type(exc).__name__})"
    dubbed_audio = WORK / "arabic_dubbed_mix.wav"
    update_progress("mixing_audio", separation=separation_status)
    build_mix(translated, background, duration, dubbed_audio)
    srt = ROOT / "Arabic_word_timed_subtitles.srt"
    write_word_srt(translated, srt)
    final = ROOT / f"{video_id}_Arabic_Dub.mp4"
    update_progress("rendering_video", dubbed_audio=str(dubbed_audio))
    run(["ffmpeg", "-y", "-v", "error", "-i", str(source), "-i", str(dubbed_audio),
         "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
         "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(final)], timeout=7200)
    if not final.is_file() or final.stat().st_size < 1_000_000:
        raise RuntimeError("Final MP4 failed size validation")
    run(["ffmpeg", "-v", "error", "-i", str(final), "-f", "null", "-"], timeout=7200)
    word_count = sum(len(x.get("tts_words", [])) for x in translated)
    report = {
        "status": "FINAL_VERIFIED", "video_id": video_id,
        "source_url": url, "duration_seconds": round(duration, 2),
        "speaker_count": len(profiles), "speaker_profiles": profiles,
        "segments_translated_and_voiced": len(translated),
        "tts_word_boundary_count": word_count,
        "timing_method": "Microsoft Edge TTS WordBoundary offsets mapped to source utterance starts; clip fitting capped at 1.25x",
        "background_audio": separation_status,
        "visual_lip_sync": "Not performed; no heavy face animation. Audio and word timings aligned to dialogue turns.",
        "age_gender_caveat": "Voice presentation and perceived-age hints are acoustic estimates only, not verified actor demographics.",
        "quality_notes": [
            "Review translation and diarization, especially overlapping dialogue and short turns.",
            "Words are timed from TTS WordBoundary events; source speech utterances anchor the translation.",
            "A synthetic voice is assigned per detected speaker; Microsoft voice catalog limits may require reuse if the number of speakers exceeds available Arabic Neural voices."
        ],
        "final_file": final.name, "final_size_bytes": final.stat().st_size,
        "final_sha256": sha256(final), "subtitles_file": srt.name
    }
    report_path = ROOT / "quality_report.json"
    atomic_json(report_path, report)
    atomic_json(ROOT / "progress.json", {"stage": "complete", "status": "FINAL_VERIFIED",
                                         "updated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    upload_outputs(drive, [final, srt, report_path, PROGRESS, LOG])
    log("SUCCESS: final MP4, word-level subtitles, speaker report and quality report uploaded to Google Drive")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
