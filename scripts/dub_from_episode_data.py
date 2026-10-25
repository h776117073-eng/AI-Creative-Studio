#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Resumable Arabic dubbing from the supplied episode_data bundle.

Translations, speaker IDs, emotions, and word timings are loaded from the prepared
dataset. Source-voice references are extracted from the actual episode when a
candidate window exists. Dataset confidence limitations are written to the report.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dub_arabic_multispeaker import (
    GGUF_NAME, MODEL_ID, OUT_SR, prepare_refs, synthesize_audar, fit_segment,
    mix_audio_chunks, atomic_json, load_json, media_duration, sha256_file,
)

def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)

def read_jsonl(path: Path) -> list[dict[str, Any]]:
    items = []
    with path.open("r", encoding="utf-8-sig") as f:
        for n, line in enumerate(f, 1):
            if line.strip():
                try:
                    value = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise RuntimeError(f"Invalid JSONL: {path.name}:{n}: {exc}") from exc
                if isinstance(value, dict):
                    items.append(value)
    return items

def run(cmd: list[str], timeout: int = 300) -> None:
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       text=True, timeout=timeout)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"Command failed ({cmd[0]}): {(exc.stderr or exc.stdout or '')[-2000:]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Command timed out: {cmd[0]} after {timeout}s") from exc

def norm(x: Any) -> str:
    return re.sub(r"\s+", " ", str(x or "")).strip()

def emotion_tag(emotion: str, style: str, text: str) -> str | None:
    e = (emotion or "").lower().replace("-", "_")
    s = (style or "").lower()
    # Only use the limited delivery markers present in this TTS model's examples.
    if "whisper" in s or "همس" in s or e in {"whisper", "whispering"}:
        return "[whispers]"
    if e in {"laugh", "laughter", "laughing", "amused_laughter"} or re.search(r"(هههه|هاها|يضحك|تضحك)", text):
        return "[laughs]"
    if e in {"excited", "happy", "joy", "joyful", "enthusiastic"}:
        return "[excited]"
    if e in {"curious", "curiosity", "surprised", "surprise"}:
        return "[curious]"
    if e in {"sarcastic", "sarcasm", "scheming", "mischievous"}:
        return "[mischievously]"
    if e in {"sad", "sadness", "grief", "sorrow"}:
        return "[sighs]"
    return None

def extract_ref(audio_path: Path, wav_path: Path, start: float, duration: float) -> None:
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-ss", f"{max(0.0, start):.3f}", "-t", f"{duration:.3f}",
         "-i", str(audio_path), "-vn", "-ac", "1", "-ar", str(OUT_SR),
         "-c:a", "pcm_s16le", str(wav_path)], timeout=180)

def build_voice_bank(audio_path: Path, data_dir: Path, out_dir: Path, asr_name: str):
    from faster_whisper import WhisperModel

    profiles = read_json(data_dir / "speakers.json").get("speakers", [])
    sample_data = read_json(data_dir / "audio_samples" / "samples_manifest.json").get("speakers", {})
    refs_dir = out_dir / "voice_refs"
    refs_dir.mkdir(parents=True, exist_ok=True)
    fallback = prepare_refs(out_dir)
    asr = WhisperModel(asr_name, device="cpu", compute_type="int8")
    refs: dict[str, tuple[Path, str]] = {}
    voice_ids: dict[str, str] = {}
    info: dict[str, Any] = {}

    for p in profiles:
        sid = norm(p.get("speaker_id"))
        if not sid:
            continue
        gender = norm(p.get("apparent_vocal_gender")).lower()
        role = norm(p.get("role_name_ar"))
        # These IDs explicitly combine several actors in the supplied dataset.
        grouped = sid in {"SPEAKER_009", "SPEAKER_010"} or "multiple" in gender or "mixed" in gender
        fallback_id = "demo_male_1" if "male" in gender and "female" not in gender else "demo_female_1"
        candidates = sample_data.get(sid, {}).get("candidate_windows", [])
        candidates = [x for x in candidates if isinstance(x, dict)
                      and x.get("start_sec") is not None and x.get("duration_sec") is not None
                      and 3.5 <= float(x.get("duration_sec") or 0) <= 15.0]
        candidates.sort(key=lambda x: abs(float(x.get("duration_sec") or 0) - 8.0))
        picked = candidates[0] if candidates else None

        if grouped or picked is None:
            refs[sid] = fallback[fallback_id]
            voice_ids[sid] = fallback_id
            info[sid] = {
                "role_name_ar": role, "voice_reference_type": "publisher_synthetic_fallback",
                "voice_profile_id": fallback_id,
                "reason": "The dataset groups multiple people under this ID or has no suitable source sample.",
            }
            continue

        wav = refs_dir / f"{sid}_reference.wav"
        try:
            start = float(picked["start_sec"])
            duration = float(picked["duration_sec"])
            extract_ref(audio_path, wav, start, duration)
            transcript = ""
            language = "unknown"
            try:
                chunks, asr_info = asr.transcribe(
                    str(wav), beam_size=1, vad_filter=False, condition_on_previous_text=False
                )
                transcript = norm(" ".join(c.text for c in chunks))
                language = str(getattr(asr_info, "language", "unknown") or "unknown")
            except Exception:
                pass
            caption = norm(picked.get("original_text"))
            ref_text = transcript if len(transcript) >= 3 else caption
            if not ref_text:
                raise RuntimeError("No reference transcript")
            refs[sid] = (wav, ref_text)
            voice_ids[sid] = sid
            info[sid] = {
                "role_name_ar": role,
                "voice_reference_type": "source_video_audio_sample",
                "voice_profile_id": sid,
                "reference_file": str(wav),
                "reference_start_sec": start,
                "reference_duration_sec": duration,
                "reference_text": ref_text[:500],
                "reference_text_source": "ASR on reference clip" if transcript else "caption fallback",
                "reference_asr_language": language,
                "reference_confidence": "candidate window from contextual data; audio identity not independently confirmed",
            }
            print(f"Prepared source-voice reference {sid} ({duration:.1f}s)", flush=True)
        except Exception as exc:
            refs[sid] = fallback[fallback_id]
            voice_ids[sid] = fallback_id
            info[sid] = {
                "role_name_ar": role, "voice_reference_type": "publisher_synthetic_fallback",
                "voice_profile_id": fallback_id, "reason": f"Source reference unavailable: {type(exc).__name__}",
            }
    return refs, voice_ids, info

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True, help="16 kHz mono WAV extracted from the source video")
    ap.add_argument("--episode-data-dir", required=True, help="Extracted episode_data directory")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--asr-model", choices=["tiny", "base", "small"], default="small")
    ap.add_argument("--max-atempo", type=float, default=1.45)
    ap.add_argument("--source-sha256", default="")
    args = ap.parse_args()
    if not (1.0 <= args.max_atempo <= 1.6):
        raise SystemExit("--max-atempo must be between 1.0 and 1.6")

    started = time.time()
    audio_path = Path(args.audio).resolve()
    data_dir = Path(args.episode_data_dir).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    required = ["episode_metadata.json", "segments.jsonl", "words.jsonl", "speakers.json",
                "characters.json", "emotion_timeline.jsonl", "arabic_translation.jsonl",
                "lip_sync_plan.jsonl", "scenes.jsonl", "audio_samples/samples_manifest.json", "manifest.json"]
    missing = [x for x in required if not (data_dir / x).is_file()]
    if missing:
        raise SystemExit("Prepared episode_data is missing: " + ", ".join(missing))
    if not audio_path.is_file() or audio_path.stat().st_size < 1000:
        raise SystemExit(f"Audio input missing or too small: {audio_path}")

    audio_hash = sha256_file(audio_path)
    data_hash = sha256_file(data_dir / "manifest.json")
    duration = media_duration(audio_path)
    metadata = read_json(data_dir / "episode_metadata.json")
    segments = sorted(read_jsonl(data_dir / "segments.jsonl"),
                      key=lambda s: (float(s.get("start_sec") or 0), norm(s.get("segment_id"))))
    translations = {norm(x.get("segment_id")): x for x in read_jsonl(data_dir / "arabic_translation.jsonl")}
    emotions = {norm(x.get("segment_id")): x for x in read_jsonl(data_dir / "emotion_timeline.jsonl")}
    word_votes: dict[str, Counter[str]] = defaultdict(Counter)
    word_weights: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    words = read_jsonl(data_dir / "words.jsonl")
    for word in words:
        sid, emotion = norm(word.get("segment_id")), norm(word.get("primary_emotion")).lower()
        if sid and emotion:
            try:
                weight = max(0.1, float(word.get("emotion_intensity") or 0.5))
            except (TypeError, ValueError):
                weight = 0.5
            word_votes[sid][emotion] += 1
            word_weights[sid][emotion] += weight

    checkpoint = load_json(out_dir / "translated_segments.json")
    prior = {}
    if isinstance(checkpoint, dict) and checkpoint.get("audio_sha256") == audio_hash \
            and checkpoint.get("data_manifest_sha256") == data_hash \
            and checkpoint.get("tts_engine") == "Audar-TTS-V1-Flash-Q4_K_M_SOURCE_REFS":
        prior = {norm(x.get("segment_id")): x for x in checkpoint.get("segments", []) if x.get("segment_id")}

    refs, voice_ids, voice_info = build_voice_bank(audio_path, data_dir, out_dir, args.asr_model)
    import torch
    from huggingface_hub import hf_hub_download
    from llama_cpp import Llama
    from neucodec import NeuCodec

    print("Loading Audar-TTS-V1-Flash Q4_K_M and NeuCodec on CPU", flush=True)
    model_dir = out_dir / "models" / "audar-flash"
    model_dir.mkdir(parents=True, exist_ok=True)
    gguf_path = hf_hub_download(repo_id=MODEL_ID, filename=GGUF_NAME, local_dir=str(model_dir))
    llm = Llama(model_path=gguf_path, n_ctx=4096, n_gpu_layers=0, verbose=False)
    codec = NeuCodec.from_pretrained("neuphonic/neucodec").eval()

    line_dir = out_dir / "segments"
    line_dir.mkdir(parents=True, exist_ok=True)
    output_segments = []
    exported_segments = []
    reused = generated = missing_text = ambiguous = 0
    timing_overruns = []
    for ix, s in enumerate(segments):
        seg_id = norm(s.get("segment_id")) or f"SEG_{ix+1:04d}"
        start = max(0.0, float(s.get("start_sec") or 0.0))
        end = min(duration, max(start + 0.08, float(s.get("end_sec") or start + 0.08)))
        trans = translations.get(seg_id, {})
        emotion_record = emotions.get(seg_id, {})
        original = norm(s.get("original_text"))
        proposed = norm(trans.get("proposed_arabic_translation") or s.get("arabic_translation"))
        short = norm(trans.get("shorter_arabic_alternative") or s.get("arabic_short_alternative"))
        overlap = bool((s.get("overlap_status") or {}).get("is_overlapping_or_merged_turn"))
        use_short = overlap and bool(short)
        arabic = short if use_short else proposed
        if not arabic:
            missing_text += 1
            continue

        speaker = norm(s.get("speaker_id")) or "SPEAKER_UNKNOWN"
        voice_id = voice_ids.get(speaker, "demo_female_1")
        votes = word_votes.get(seg_id, Counter())
        primary_emotion = max(votes, key=lambda e: word_weights[seg_id].get(e, 0.0)) if votes else norm(emotion_record.get("primary_emotion"))
        secondary_emotion = norm(emotion_record.get("secondary_emotion"))
        style = norm(emotion_record.get("performance_style_en"))
        tag = emotion_tag(primary_emotion, style, arabic)
        tagged = f"{tag} {arabic}" if tag else arabic

        next_start = duration
        if ix + 1 < len(segments):
            next_start = max(start + 0.08, float(segments[ix + 1].get("start_sec") or duration))
        cue_window = max(0.30, min(end, next_start, duration) - start)
        try:
            target_window = float(trans.get("target_arabic_duration_sec") or cue_window)
        except (TypeError, ValueError):
            target_window = cue_window
        fit_window = max(0.30, min(cue_window, target_window))

        raw = line_dir / f"{seg_id}_{voice_id}.wav"
        fitted = line_dir / f"{seg_id}_{voice_id}_fit.wav"
        key = hashlib.sha256(
            (audio_hash + data_hash + seg_id + arabic + speaker + voice_id + str(tag)).encode("utf-8")
        ).hexdigest()
        prior_item = prior.get(seg_id, {})
        cached = (prior_item.get("input_key") == key and prior_item.get("voice_profile_id") == voice_id
                  and raw.is_file() and raw.stat().st_size > 1000
                  and prior_item.get("raw_sha256") == sha256_file(raw))
        if cached:
            reused += 1
        else:
            synthesize_audar(tagged, voice_id, refs, llm, codec, torch, raw)
            if not raw.is_file() or raw.stat().st_size < 1000:
                raise RuntimeError(f"{seg_id}: TTS did not produce a usable WAV")
            generated += 1

        if not cached or not fitted.is_file() or fitted.stat().st_size < 1000 \
                or prior_item.get("fit_window_seconds") != round(fit_window, 3):
            fitted_duration, atempo = fit_segment(raw, fitted, fit_window, args.max_atempo)
        else:
            fitted_duration, atempo = media_duration(fitted), float(prior_item.get("atempo") or 1.0)
        overrun = fitted_duration > fit_window + 0.12
        if overrun:
            timing_overruns.append(seg_id)
        if overlap:
            ambiguous += 1
        item = {
            "segment_id": seg_id, "scene_id": s.get("scene_id"), "part_id": s.get("part_id"),
            "speaker_id": speaker, "character_id": s.get("character_id"),
            "original_text": original, "arabic": arabic, "arabic_translation_original": proposed,
            "arabic_short_alternative": short or None, "emotion": primary_emotion,
            "secondary_emotion": secondary_emotion or None, "emotion_tag_applied": tag,
            "voice_profile_id": voice_id, "voice_reference_type": voice_info.get(speaker, {}).get("voice_reference_type"),
            "start": start, "end": end, "target_window_seconds": round(fit_window, 3),
            "fitted_wav": str(fitted), "fitted_duration_seconds": round(fitted_duration, 3),
            "atempo": round(atempo, 3), "timing_overrun": overrun,
            "requires_human_review": bool(trans.get("requires_human_review")) or overlap,
            "caption_merged_turn": overlap, "caption_timing_confidence": 0.35,
        }
        output_segments.append(item)
        exported_segments.append({k: v for k, v in item.items() if k != "fitted_wav"})
        prior[seg_id] = {
            "segment_id": seg_id, "input_key": key, "source": original, "arabic": arabic,
            "speaker_id": speaker, "voice_profile_id": voice_id, "emotion_tag": tag,
            "tts_engine": "Audar-TTS-V1-Flash-Q4_K_M_SOURCE_REFS",
            "raw_sha256": sha256_file(raw), "fit_window_seconds": round(fit_window, 3),
            "fitted_sha256": sha256_file(fitted), "atempo": round(atempo, 3), "status": "completed",
        }
        atomic_json(out_dir / "translated_segments.json", {
            "schema": 1, "audio_sha256": audio_hash, "data_manifest_sha256": data_hash,
            "source_language": metadata.get("dialogue_languages", {}).get("extracted_transcript_language", "unknown"),
            "target_language": "ar", "tts_engine": "Audar-TTS-V1-Flash-Q4_K_M_SOURCE_REFS",
            "segments": [prior[k] for k in sorted(prior)],
        })
        if (ix + 1) % 10 == 0 or ix + 1 == len(segments):
            print(f"TTS progress: {ix+1}/{len(segments)} segments; generated={generated}; reused={reused}", flush=True)

    if not output_segments:
        raise RuntimeError("No audio segments were produced; refusing to report a false success.")
    mix_audio_chunks(output_segments, duration, out_dir / "timeline_chunks", out_dir / "dub_ar.wav")
    dub_duration = media_duration(out_dir / "dub_ar.wav")

    speaker_profiles = read_json(data_dir / "speakers.json")
    speaker_profiles["voice_references_runtime"] = voice_info
    speaker_profiles["voice_id_by_speaker"] = voice_ids
    speaker_profiles["verification_note"] = (
        "The source snippets were extracted from candidate windows and ASR-transcribed where possible. "
        "The candidate speaker-to-character links remain context-derived and require review."
    )
    atomic_json(out_dir / "speaker_profiles.json", speaker_profiles)
    atomic_json(out_dir / "transcript_source.json", {
        "schema": 1, "source_sha256": args.source_sha256 or audio_hash, "audio_sha256": audio_hash,
        "source_duration_seconds": round(duration, 3),
        "segments": [{"segment_id": s.get("segment_id"), "start": s.get("start_sec"),
                      "end": s.get("end_sec"), "source": s.get("original_text"),
                      "speaker_id": s.get("speaker_id"), "character_id": s.get("character_id")} for s in segments],
    })
    atomic_json(out_dir / "transcript_source_with_speakers.json", {
        "schema": 1, "audio_sha256": audio_hash, "segments": [
            {"segment_id": s.get("segment_id"), "start": s.get("start_sec"), "end": s.get("end_sec"),
             "source": s.get("original_text"), "speaker_id": s.get("speaker_id"),
             "character_id": s.get("character_id"),
             "voice_profile_id": voice_ids.get(norm(s.get("speaker_id")), "demo_female_1")} for s in segments
        ],
    })
    atomic_json(out_dir / "transcript_ar.json", {
        "schema": 1, "source_sha256": args.source_sha256 or audio_hash, "audio_sha256": audio_hash,
        "target_language": "ar", "segments": exported_segments,
    })
    (out_dir / "lip_sync_plan.jsonl").write_bytes((data_dir / "lip_sync_plan.jsonl").read_bytes())

    report = {
        "status": "DUB_AUDIO_CREATED_LIP_SYNC_PENDING",
        "source_sha256": args.source_sha256 or audio_hash, "audio_sha256": audio_hash,
        "episode_data_manifest_sha256": data_hash,
        "source_duration_seconds": round(duration, 3), "dub_audio_duration_seconds": round(dub_duration, 3),
        "input_segments": len(segments), "segments_synthesized_or_reused": len(output_segments),
        "segments_generated_this_run": generated, "segments_reused_from_checkpoints": reused,
        "segments_without_translation": missing_text, "merged_or_overlap_caption_segments": ambiguous,
        "timing_overruns": len(timing_overruns),
        "human_review_segments": sum(1 for x in output_segments if x.get("requires_human_review")),
        "speaker_count_in_metadata": len(speaker_profiles.get("speakers", [])),
        "tts_engine": "Audar-TTS-V1-Flash Q4_K_M on CPU",
        "voice_reference_method": "source-audio snippets where plausible; synthetic fallback for grouped/ambiguous speaker IDs",
        "word_level_emotions_used": True,
        "word_timing_confidence": "0.35: caption-proportional estimates, not audio-aligned WhisperX timestamps",
        "lip_sync_status": "pending; this workflow generates time-aligned Arabic audio but does not modify mouth frames on the CPU-only runner",
        "warnings": [
            "Many speaker/character links and emotions in the prepared data were inferred from caption/context, not verified against source audio/video.",
            "The prepared data marks 359 merged or overlapping caption turns; shortened alternatives are used where available, but separate actors are not automatically split here.",
            "SPEAKER_009 and SPEAKER_010 group multiple people and therefore use a synthetic fallback voice.",
            "The lip-sync plan is carried through from the supplied data and remains visually unverified; actual mouth-frame modification is not executed by this CPU workflow.",
        ],
        "elapsed_seconds": round(time.time() - started, 2),
    }
    atomic_json(out_dir / "run_manifest.json", report)
    notes = [
        "# Arabic dubbing report", "",
        f"- Status: {report['status']}",
        f"- Source duration: {duration:.3f}s",
        f"- Arabic dub audio duration: {dub_duration:.3f}s",
        f"- Input segments: {len(segments)}; synthesized/reused: {len(output_segments)}",
        f"- Generated this run: {generated}; reused from checkpoints: {reused}",
        f"- Merged/overlap caption segments: {ambiguous}",
        f"- Timing overruns: {len(timing_overruns)}",
        "", "## Important limitations", "",
    ] + [f"- {x}" for x in report["warnings"]] + [""]
    (out_dir / "quality_report.md").write_text("\n".join(notes), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if abs(dub_duration - duration) > 2.0:
        raise RuntimeError(f"Dub audio duration drift too large: source={duration:.3f}s dub={dub_duration:.3f}s")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
