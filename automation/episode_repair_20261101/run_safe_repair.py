#!/usr/bin/env python3
"""Execute the existing repair runner from a verified local Colab transfer manifest."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import traceback
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path("/content/episode_repair_20261031")
RUNNER_PATH = ROOT / "runner.py"
STATUS_PATH = ROOT / "run_status.json"
TARGET_SECONDS = 6153.995

def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()

def probe(path: Path) -> dict:
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
        capture_output=True, text=True, check=True, timeout=300,
    )
    return json.loads(p.stdout)

def full_decode(path: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-xerror", "-i", str(path), "-f", "null", "-"],
        capture_output=True, text=True, check=True, timeout=7200,
    )

def extract_review_samples(video: Path, duration: float) -> list[str]:
    samples = ROOT / "review_samples"
    samples.mkdir(parents=True, exist_ok=True)
    starts = [0.0, max(0.0, duration / 2 - 6.0), max(0.0, duration - 12.0)]
    made = []
    for label, start in zip(("beginning", "middle", "ending"), starts):
        audio = samples / (label + "_12s.mp3")
        subprocess.run(
            ["ffmpeg", "-y", "-ss", str(start), "-i", str(video), "-t", "12",
             "-vn", "-ac", "2", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "160k", str(audio)],
            capture_output=True, text=True, check=True, timeout=180,
        )
        frame = samples / (label + "_frame.jpg")
        subprocess.run(
            ["ffmpeg", "-y", "-ss", str(start + 3.0), "-i", str(video), "-frames:v", "1",
             "-vf", "scale=640:-1", "-q:v", "3", str(frame)],
            capture_output=True, text=True, check=True, timeout=120,
        )
        made.extend([str(audio), str(frame)])
    return made

def local_download(url: str, dest: Path, expected_sha256: str | None = None) -> Path:
    parsed = urlparse(url)
    if parsed.scheme != "file":
        raise RuntimeError("Only the uploaded local Colab input files are accepted by this isolated workflow.")
    source = Path(unquote(parsed.path))
    if not source.is_file():
        raise FileNotFoundError("Uploaded Colab input is missing: " + str(source))
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    shutil.copyfile(source, tmp)
    if expected_sha256 and digest(tmp) != expected_sha256:
        tmp.unlink(missing_ok=True)
        raise RuntimeError("SHA256 mismatch for local transfer " + dest.name)
    tmp.replace(dest)
    return dest

def main() -> int:
    status = {
        "status": "starting",
        "target_duration_seconds": TARGET_SECONDS,
        "visual_lip_animation": "not performed by the existing repair runner; source picture stream is copied unchanged",
        "human_audio_review": "pending; three audio excerpts are exported for review",
        "drive_upload": "disabled until all acceptance checks and human review are completed",
    }
    try:
        if not RUNNER_PATH.is_file():
            raise FileNotFoundError("Repair runner was not uploaded to the Colab session.")
        spec = importlib.util.spec_from_file_location("episode_repair_runner", RUNNER_PATH)
        if spec is None or spec.loader is None:
            raise RuntimeError("Could not load repair runner.")
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        runner.download_signed_url = local_download
        runner.main()
        qa_path = runner.QA_PATH
        if not qa_path.is_file():
            raise RuntimeError("Repair runner returned without a QA report.")
        qa = json.loads(qa_path.read_text(encoding="utf-8"))
        if qa.get("status") != "rendered_and_technical_checks_passed":
            raise RuntimeError("Repair runner did not pass its technical QA status.")
        mkv = runner.FINAL_PATH
        if not mkv.is_file() or mkv.stat().st_size < 100_000_000:
            raise RuntimeError("Technical QA passed without a complete-size output MKV.")
        mkv_probe = probe(mkv)
        mkv_duration = float(mkv_probe.get("format", {}).get("duration") or 0)
        if abs(mkv_duration - TARGET_SECONDS) > 3.0:
            raise RuntimeError("Output duration is outside the 6153.995-second acceptance window.")
        full_decode(mkv)
        video_stream = next((x for x in mkv_probe.get("streams", []) if x.get("codec_type") == "video"), {})
        audio_stream = next((x for x in mkv_probe.get("streams", []) if x.get("codec_type") == "audio"), {})
        video_codec = str(video_stream.get("codec_name") or "").lower()
        audio_codec = str(audio_stream.get("codec_name") or "").lower()
        if video_codec not in {"h264", "hevc", "av1"} or audio_codec not in {"aac", "mp3", "ac3", "eac3"}:
            status.update({
                "status": "technical_mkv_passed_mp4_remux_blocked",
                "mkv": {"bytes": mkv.stat().st_size, "duration_seconds": mkv_duration, "sha256": digest(mkv)},
                "reason": "The copied video/audio codecs are not in the safe MP4 stream-copy allowlist; full re-encoding is not attempted.",
            })
            STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print("REPAIR_STATUS=MP4_REMUX_BLOCKED", flush=True)
            return 2
        mp4 = ROOT / "الحلقة_مدبلجة_بالعربية_المرشحة_للمراجعة.mp4"
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(mkv), "-map", "0:v:0", "-map", "0:a:0",
             "-c", "copy", "-movflags", "+faststart", str(mp4)],
            capture_output=True, text=True, check=True, timeout=7200,
        )
        mp4_probe = probe(mp4)
        mp4_duration = float(mp4_probe.get("format", {}).get("duration") or 0)
        if abs(mp4_duration - TARGET_SECONDS) > 3.0:
            raise RuntimeError("MP4 remux duration is outside the 6153.995-second acceptance window.")
        mp4_video = next((x for x in mp4_probe.get("streams", []) if x.get("codec_type") == "video"), {})
        mp4_audio = next((x for x in mp4_probe.get("streams", []) if x.get("codec_type") == "audio"), {})
        if (mp4_video.get("width"), mp4_video.get("height")) != (1080, 1920):
            raise RuntimeError("MP4 dimensions are not 1080x1920.")
        if mp4_audio.get("sample_rate") != "48000" or int(mp4_audio.get("channels") or 0) != 2:
            raise RuntimeError("MP4 audio is not 48 kHz stereo.")
        full_decode(mp4)
        review_files = extract_review_samples(mp4, mp4_duration)
        qa["mp4"] = {
            "filename": mp4.name, "size_bytes": mp4.stat().st_size,
            "sha256": digest(mp4), "duration_seconds": mp4_duration,
            "video_codec": mp4_video.get("codec_name"), "audio_codec": mp4_audio.get("codec_name"),
            "full_decode": "passed", "duration_tolerance_seconds": 3.0,
        }
        qa["visual_lip_animation"] = "not performed; the existing repair runner copies the original picture stream unchanged"
        qa["audio_review"] = "technical decode passed; human listening review remains required"
        qa["music_and_effects_review"] = "not certified by automated checks; human review remains required"
        qa["drive_upload"] = "not performed; final acceptance gate remains closed"
        qa["review_sample_files"] = review_files
        qa_path.write_text(json.dumps(qa, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        status.update({
            "status": "TECHNICAL_QA_PASSED_MANUAL_REVIEW_REQUIRED",
            "mkv": {"bytes": mkv.stat().st_size, "duration_seconds": mkv_duration, "sha256": digest(mkv)},
            "mp4": {"path": str(mp4), "bytes": mp4.stat().st_size, "duration_seconds": mp4_duration, "sha256": digest(mp4)},
            "full_decode": "passed for MKV and MP4",
            "ffprobe": "passed",
            "visual_lip_animation": "not performed; picture copied unchanged",
            "human_review": "required for Arabic dialogue, lip timing, music and sound effects",
            "review_sample_files": review_files,
        })
        STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("REPAIR_STATUS=TECHNICAL_QA_PASSED_MANUAL_REVIEW_REQUIRED", flush=True)
        return 0
    except Exception as exc:
        status.update({
            "status": "failed_or_blocked",
            "error_type": type(exc).__name__,
            "error": str(exc),
            "traceback": traceback.format_exc()[-7000:],
        })
        STATUS_PATH.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("REPAIR_STATUS=FAILED_OR_BLOCKED", flush=True)
        print("ERROR_TYPE=" + type(exc).__name__, flush=True)
        print("ERROR=" + str(exc), flush=True)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
