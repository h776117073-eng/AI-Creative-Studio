#!/usr/bin/env python3
from __future__ import annotations
import collections, hashlib, json, zipfile
from pathlib import Path
import gdown

REPORT_ID = "1mVJpaVrR0Y9ikfeX_lynBCVwDBoUemxV"
EXPECTED_BYTES = 197507
OUT = Path("output")
ZIP_PATH = OUT / "reports.zip"

def load_one(zf, basename):
    hits = [n for n in zf.namelist() if Path(n).name == basename]
    if len(hits) != 1:
        raise RuntimeError(f"Expected exactly one {basename}, found {len(hits)}")
    return json.loads(zf.read(hits[0]).decode("utf-8-sig"))

def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    got = gdown.download(id=REPORT_ID, output=str(ZIP_PATH), quiet=False, resume=True)
    if not got or not ZIP_PATH.is_file() or ZIP_PATH.stat().st_size != EXPECTED_BYTES:
        raise RuntimeError("Report archive download failed exact size verification")
    with zipfile.ZipFile(ZIP_PATH) as zf:
        bad = zf.testzip()
        if bad:
            raise RuntimeError("Corrupt ZIP member: " + bad)
        manifest = load_one(zf, "render_manifest.json")
        timing = load_one(zf, "voice_line_timing.json")
        mapping = load_one(zf, "source_to_arabic_lines.json")
        final_probe = load_one(zf, "final_probe.json")

    rendered = {
        (x.get("speaker_script_id"), int(x.get("utterance_index") or 0))
        for x in manifest.get("lines", [])
    }
    tracks = timing.get("tracks", [])
    expected = {
        (t.get("speaker_id"), int(u.get("utterance_index") or 0))
        for t in tracks for u in t.get("utterances", [])
    }
    missing = sorted(expected - rendered)
    assignments = mapping.get("assignments", [])
    by_key = collections.defaultdict(list)
    for r in assignments:
        sid = r.get("speaker_script_id")
        idx = int(r.get("utterance_index") or 0)
        if sid and sid != "unmatched" and idx > 0:
            by_key[(sid, idx)].append(r)

    missing_rows = []
    for t in tracks:
        sid = t.get("speaker_id")
        for u in t.get("utterances", []):
            key = (sid, int(u.get("utterance_index") or 0))
            if key not in missing:
                continue
            rows = by_key.get(key, [])
            missing_rows.append({
                "speaker_script_id": sid,
                "utterance_index": key[1],
                "track_file": t.get("track_file"),
                "text": u.get("text"),
                "track_start_seconds": u.get("track_start_seconds"),
                "track_end_seconds": u.get("track_end_seconds"),
                "source_assignments": [
                    {k: r.get(k) for k in [
                        "speaker_script_id", "utterance_index", "source_speaker_id",
                        "source_start", "source_end", "confidence", "source_text"
                    ]} for r in rows
                ]
            })

    cartier = []
    for r in assignments:
        s = str(r.get("source_text") or "")
        if any(term in s.lower() for term in ["卡地亚", "cartier", "garden"]):
            cartier.append({k: r.get(k) for k in [
                "speaker_script_id", "utterance_index", "source_speaker_id",
                "source_start", "source_end", "confidence", "source_text"
            ]})

    leda8_rendered = [
        {k: x.get(k) for k in [
            "speaker_script_id", "utterance_index", "source_start", "source_end",
            "text", "track_file", "track_start_seconds", "track_end_seconds"
        ]}
        for x in manifest.get("lines", [])
        if x.get("speaker_script_id") == "01_li_yang"
        and int(x.get("utterance_index") or 0) == 8
    ]

    source_speaker_counts = collections.defaultdict(collections.Counter)
    for r in assignments:
        sid = r.get("speaker_script_id")
        src = r.get("source_speaker_id")
        if sid and sid != "unmatched" and src:
            source_speaker_counts[sid][src] += 1

    result = {
        "status": "full_report_audit_complete",
        "archive": {
            "bytes": ZIP_PATH.stat().st_size,
            "sha256": sha256(ZIP_PATH),
            "members": zipfile.ZipFile(ZIP_PATH).namelist()
        },
        "manifest_summary": {
            "expected_utterances": len(expected),
            "rendered_utterances": len(rendered),
            "missing_utterances": len(missing),
            "source_assignments_count": len(assignments),
            "matched_line_count": manifest.get("matched_line_count"),
            "unmatched_assignments": manifest.get("unmatched_assignments"),
            "low_confidence_assignments": manifest.get("low_confidence_assignments"),
            "timing_overrun_count": manifest.get("timing_overrun_count"),
            "source_video_sha256": manifest.get("source_video_sha256"),
            "current_dub_sha256": manifest.get("video_sha256")
        },
        "missing_utterances": missing_rows,
        "cartier_source_assignments": cartier,
        "leda_utterance_8_in_render_manifest": leda8_rendered,
        "source_speaker_assignment_counts": {
            sid: dict(c) for sid, c in source_speaker_counts.items()
        },
        "final_probe": {
            "format": final_probe.get("format"),
            "streams": [
                {k: s.get(k) for k in [
                    "index", "codec_type", "codec_name", "width", "height",
                    "sample_rate", "channels", "duration"
                ]} for s in final_probe.get("streams", [])
            ]
        }
    }
    out = OUT / "full_report_audit.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "missing_utterances": len(missing_rows),
        "cartier_assignments": len(cartier),
        "leda_utterance_8_rendered": len(leda8_rendered),
        "report_sha256": result["archive"]["sha256"]
    }, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
