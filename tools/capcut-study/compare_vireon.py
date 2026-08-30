#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

TARGETS: dict[str, tuple[str, ...]] = {
    "timeline_model": ("timeline", "track", "segment", "clip", "duration", "trim", "marker", "draft"),
    "keyframing": ("keyframe", "curve"),
    "editing_interactions": ("split", "ripple", "slip", "slide", "roll", "snap", "magnetic"),
    "transitions": ("transition",),
    "retiming": ("speed", "curve"),
    "rendering": ("render", "compositor", "shader"),
    "media_pipeline": ("media", "decoder", "audio", "waveform", "source"),
}


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def evidence(fingerprint: dict[str, Any]) -> dict[str, int]:
    scores = {key: 0 for key in TARGETS}
    counts = dict(fingerprint.get("sources", {}).get("term_counts", []))
    common_keys = {str(k): int(v) for k, v in fingerprint.get("schemas_data", {}).get("common_keys", [])}
    native_blob = " ".join(
        item
        for lib in fingerprint.get("native", [])
        for item in lib.get("symbols", []) + lib.get("strings", [])
    ).lower()
    shader_count = len(fingerprint.get("shaders", []))

    for category, terms in TARGETS.items():
        for term in terms:
            value = int(counts.get(term, 0)) + int(common_keys.get(term, 0))
            if term in native_blob:
                value += 1
            if term == "shader":
                value += shader_count
            scores[category] += min(value, 20)
    return scores


def write_report(fingerprint: dict[str, Any], output: Path) -> None:
    scores = evidence(fingerprint)
    summary = fingerprint.get("summary", {})
    lines = [
        "# CapCut ↔ Vireon Architecture Comparison",
        "",
        "> This is a structural comparison. It does not copy proprietary implementation code or assets.",
        "",
        "## Observed CapCut-side evidence",
        "",
        f"- APK inputs analyzed: **{summary.get('apks', 0)}**",
        f"- Native libraries: **{summary.get('native', 0)}**",
        f"- Shader-like files: **{summary.get('shaders', 0)}**",
        f"- Schema/config files: **{summary.get('schemas', 0)}**",
        f"- Timeline/media candidate source files: **{summary.get('timeline_files', 0)}**",
        "",
        "## Comparison matrix",
        "",
        "| Vireon subsystem | Structural evidence detected | Implementation direction |
|---|---:|---|",
    ]
    for category, score in scores.items():
        level = "high" if score >= 20 else "medium" if score >= 7 else "low"
        direction = {
            "timeline_model": "Keep canonical frame-based state, explicit track/clip/segment ownership and deterministic normalization.",
            "keyframing": "Promote keyframes and interpolation curves to first-class timeline primitives.",
            "editing_interactions": "Converge all gesture operations on transactional EditIntent + collision/snap policies.",
            "transitions": "Make transition bounds and media handles explicit and validated before commit.",
            "retiming": "Use source-time ↔ timeline-time maps with piecewise speed curves and frame-accurate quantization.",
            "rendering": "Keep timeline state independent from compositor/render graph and expose deterministic render inputs.",
            "media_pipeline": "Separate demux/decode, proxies, thumbnail/waveform caches and export from timeline semantics.",
        }[category]
        lines.append(f"| `{category}` | **{score}** ({level}) | {direction} |")

    lines += [
        "",
        "## Vireon gap-closing priorities",
        "",
        "1. Extract actual timing/schema evidence from the analyzed APK and map it to Vireon's canonical `FrameTimebase` and `RetimeMap`.",
        "2. Expand Vireon track/clip metadata only where the evidence supports a useful interoperability-neutral concept.",
        "3. Add render/media adapters rather than coupling UI components to decoder or compositor implementation details.",
        "4. Add regression fixtures for every newly confirmed behavior before changing semantics.",
        "",
        "## Important boundary",
        "",
        "The report intentionally records fingerprints, counts and architectural implications instead of redistributing decompiled proprietary source code.",
        "",
    ]
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("fingerprint")
    parser.add_argument("--output", default="CAPCUT_VIREON_COMPARISON.md")
    args = parser.parse_args()
    write_report(load(Path(args.fingerprint)), Path(args.output))
    print(f"[DONE] comparison report: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
