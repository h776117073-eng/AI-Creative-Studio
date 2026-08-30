#!/usr/bin/env python3
"""Static architecture fingerprinting pipeline for a legally obtained Android APK/XAPK.

This tool intentionally produces structural fingerprints and schema summaries rather than
redistributing decompiled proprietary source. It is designed to answer architectural questions
for Vireon: package layout, native libraries, JNI clues, renderer/media keywords, shader inventory,
JSON/XML schema keys, class/package inventories, and timeline-related signals.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

OUTPUT_DIR = Path("./extracted_capcut")
REPORT_FILE = Path("./CAPCUT_ARCHITECTURE_REPORT.md")
MAX_TEXT_BYTES = 2_000_000
MAX_JSON_DEPTH = 6
TIMELINE_TERMS = {
    "timeline", "track", "segment", "clip", "keyframe", "timerange", "time_range",
    "duration", "trim", "split", "transition", "speed", "curve", "marker", "playhead",
    "ripple", "slip", "slide", "roll", "snap", "magnetic", "draft", "nle", "composition",
    "compositor", "render", "decoder", "audio", "waveform", "media", "source"
}
SHADER_SUFFIXES = {".glsl", ".frag", ".vert", ".comp", ".geom", ".tesc", ".tese", ".spv", ".metal", ".hlsl"}
SCHEMA_SUFFIXES = {".json", ".json5", ".xml", ".yaml", ".yml", ".proto", ".toml"}


def log(msg: str) -> None:
    print(msg, flush=True)


def run(cmd: list[str], *, cwd: Path | None = None, check: bool = True) -> str:
    log("[*] " + " ".join(cmd))
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if p.returncode != 0:
        if check:
            raise RuntimeError(f"command failed: {' '.join(cmd)}\n{p.stderr[-4000:]}")
        log(f"[!] command returned {p.returncode}: {p.stderr[-1000:]}")
    return p.stdout


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_rel(path: Path, root: Path) -> str:
    return str(path.resolve().relative_to(root.resolve()))


def extract_xapk(input_path: Path, out: Path) -> list[Path]:
    """Extract APK members from XAPK/ZIP and return candidate APK paths."""
    xapk_out = out / "xapk"
    xapk_out.mkdir(parents=True, exist_ok=True)
    candidates: list[Path] = []
    with zipfile.ZipFile(input_path) as zf:
        for info in zf.infolist():
            name = Path(info.filename)
            # Prevent traversal.
            target = (xapk_out / name).resolve()
            if not str(target).startswith(str(xapk_out.resolve())):
                continue
            if info.is_dir():
                continue
            if name.suffix.lower() in {".apk"}:
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, target.open("wb") as dst:
                    shutil.copyfileobj(src, dst)
                candidates.append(target)
    if not candidates:
        raise RuntimeError("XAPK/ZIP did not contain any APK members")
    return candidates


def prepare_inputs(input_path: Path, out: Path) -> list[Path]:
    if not input_path.exists():
        raise FileNotFoundError(input_path)
    if input_path.suffix.lower() == ".xapk" or zipfile.is_zipfile(input_path) and input_path.suffix.lower() != ".apk":
        return extract_xapk(input_path, out)
    return [input_path]


def decompile(apks: list[Path], out: Path, apktool: str = "apktool", jadx: str = "jadx") -> tuple[list[Path], list[Path]]:
    apktool_dirs: list[Path] = []
    jadx_dirs: list[Path] = []
    for i, apk in enumerate(apks):
        tag = re.sub(r"[^A-Za-z0-9_.-]+", "_", apk.stem) or f"apk_{i}"
        aout = out / "apktool_out" / tag
        jout = out / "jadx_out" / tag
        aout.parent.mkdir(parents=True, exist_ok=True)
        jout.parent.mkdir(parents=True, exist_ok=True)
        log(f"=== Unpack resources: {apk.name} ===")
        run([apktool, "d", "-f", str(apk), "-o", str(aout)], check=True)
        log(f"=== Decompile DEX: {apk.name} ===")
        # JSON output is useful for machine analysis and avoids needing to retain a huge source tree.
        run([jadx, "-d", str(jout), "--no-res", "--output-format", "java", str(apk)], check=True)
        apktool_dirs.append(aout)
        jadx_dirs.append(jout)
    return apktool_dirs, jadx_dirs


def discover_shaders(apktool_dirs: Iterable[Path]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for root in apktool_dirs:
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            low = path.name.lower()
            if path.suffix.lower() in SHADER_SUFFIXES or "shader" in low:
                rows.append({
                    "path": safe_rel(path, root),
                    "size": path.stat().st_size,
                    "sha256": sha256(path),
                    "extension": path.suffix.lower(),
                })
    return sorted(rows, key=lambda x: x["path"])


def native_libraries(apktool_dirs: Iterable[Path]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for root in apktool_dirs:
        for path in (root / "lib").rglob("*.so") if (root / "lib").exists() else []:
            symbols = run(["nm", "-D", "--defined-only", str(path)], check=False).splitlines()
            interesting = [s.strip() for s in symbols if any(term.lower() in s.lower() for term in (
                "jni", "render", "decode", "encode", "audio", "video", "track", "frame", "effect", "transition", "timeline", "nle"
            ))][:80]
            strings = run(["strings", "-n", "5", str(path)], check=False).splitlines()
            kw = [s.strip() for s in strings if any(t in s.lower() for t in (
                "timeline", "track", "keyframe", "compositor", "render", "decoder", "encoder", "frame", "audio", "nle", "draft", "shader"
            ))][:120]
            rows.append({
                "path": safe_rel(path, root),
                "name": path.name,
                "abi": path.parent.name,
                "size": path.stat().st_size,
                "sha256": sha256(path),
                "interesting_symbols": interesting,
                "architecture_strings": sorted(set(kw))[:120],
            })
    return sorted(rows, key=lambda x: x["path"])


def parse_manifest(root: Path) -> dict[str, Any]:
    manifest = root / "AndroidManifest.xml"
    data: dict[str, Any] = {"exists": manifest.exists()}
    if not manifest.exists():
        return data
    text = manifest.read_text(errors="ignore")
    attrs = {}
    for key in ("package", "versionName", "versionCode", "compileSdkVersion", "platformBuildVersionName"):
        m = re.search(rf"\b{re.escape(key)}\s*=\s*\"([^\"]+)\"", text)
        if m:
            attrs[key] = m.group(1)
    data["attributes"] = attrs
    perms = re.findall(r"uses-permission[^>]+android:name=\"([^\"]+)\"", text)
    features = re.findall(r"uses-feature[^>]+android:name=\"([^\"]+)\"", text)
    data["permissions"] = sorted(set(perms))
    data["features"] = sorted(set(features))
    return data


def top_level_names(text: str) -> list[str]:
    names = set()
    for pat in (
        r"\b(?:public\s+|private\s+|protected\s+|internal\s+|final\s+|abstract\s+|open\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)",
        r"\b(?:public\s+|private\s+|protected\s+|internal\s+|final\s+|abstract\s+|open\s+)*interface\s+([A-Za-z_][A-Za-z0-9_]*)",
        r"\b(?:public\s+|private\s+|protected\s+|internal\s+|final\s+|abstract\s+|open\s+)*enum\s+class\s+([A-Za-z_][A-Za-z0-9_]*)",
    ):
        names.update(re.findall(pat, text))
    return sorted(names)


def scan_sources(jadx_dirs: Iterable[Path]) -> dict[str, Any]:
    package_counts: Counter[str] = Counter()
    file_matches: list[dict[str, Any]] = []
    term_counts: Counter[str] = Counter()
    class_names: list[str] = []
    for root in jadx_dirs:
        for p in root.rglob("*.java"):
            try:
                raw = p.read_bytes()
                if len(raw) > MAX_TEXT_BYTES:
                    raw = raw[:MAX_TEXT_BYTES]
                text = raw.decode("utf-8", errors="ignore")
            except OSError:
                continue
            pkg = re.search(r"^package\s+([^;]+);", text, re.M)
            if pkg:
                package_counts[pkg.group(1).strip()] += 1
            for name in top_level_names(text):
                class_names.append(name)
            low = text.lower()
            hits = {term: len(re.findall(rf"\b{re.escape(term)}\b", low)) for term in TIMELINE_TERMS}
            hits = {k: v for k, v in hits.items() if v}
            if hits:
                for k, v in hits.items():
                    term_counts[k] += v
                file_matches.append({"path": safe_rel(p, root), "terms": sorted(hits.items(), key=lambda kv: (-kv[1], kv[0]))[:20]})
    return {
        "top_packages": package_counts.most_common(150),
        "timeline_term_counts": term_counts.most_common(),
        "candidate_timeline_files": sorted(file_matches, key=lambda x: sum(v for _, v in x["terms"]), reverse=True)[:200],
        "class_name_sample": sorted(set(class_names))[:500],
    }


def collect_schema_files(apktool_dirs: Iterable[Path]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    key_counts: Counter[str] = Counter()

    def keys(value: Any, prefix: str = "", depth: int = 0) -> set[str]:
        if depth > MAX_JSON_DEPTH:
            return set()
        out: set[str] = set()
        if isinstance(value, dict):
            for k, v in value.items():
                name = f"{prefix}.{k}" if prefix else str(k)
                out.add(name)
                out |= keys(v, name, depth + 1)
        elif isinstance(value, list):
            for v in value[:32]:
                out |= keys(v, prefix, depth + 1)
        return out

    for root in apktool_dirs:
        for p in root.rglob("*"):
            if not p.is_file() or p.suffix.lower() not in SCHEMA_SUFFIXES:
                continue
            rel = safe_rel(p, root)
            row: dict[str, Any] = {"path": rel, "suffix": p.suffix.lower(), "size": p.stat().st_size, "sha256": sha256(p)}
            if p.suffix.lower() in {".json", ".json5"} and p.stat().st_size <= MAX_TEXT_BYTES:
                try:
                    obj = json.loads(p.read_text(errors="ignore"))
                    found = sorted(keys(obj))[:300]
                    row["keys"] = found
                    for k in found:
                        key_counts[k.split(".")[-1]] += 1
                except Exception:
                    row["parse"] = "invalid_or_nonstandard_json"
            elif p.suffix.lower() == ".xml" and p.stat().st_size <= MAX_TEXT_BYTES:
                text = p.read_text(errors="ignore")
                attrs = sorted(set(re.findall(r"\b(?:android:)?([A-Za-z_][A-Za-z0-9_]*)=\"", text)))[:200]
                tags = sorted(set(re.findall(r"<([A-Za-z_][A-Za-z0-9_.:-]*)\b", text)))[:200]
                row["tags"] = tags
                row["attributes"] = attrs
            rows.append(row)
    return {"files": sorted(rows, key=lambda x: x["path"])[:3000], "common_json_keys": key_counts.most_common(300)}


def file_inventory(root: Path) -> dict[str, Any]:
    counts: Counter[str] = Counter()
    total = 0
    size = 0
    for p in root.rglob("*"):
        if p.is_file():
            total += 1
            size += p.stat().st_size
            counts[p.suffix.lower() or "[no_ext]"] += 1
    return {"files": total, "bytes": size, "extensions": counts.most_common(100)}


def render_report(analysis: dict[str, Any]) -> None:
    lines: list[str] = []
    lines.append("# CapCut Architecture Fingerprint Study\n")
    lines.append("> This report is a structural study of a legally obtained APK/XAPK. It intentionally avoids redistributing decompiled proprietary source. Use the findings to design original Vireon components.\n")
    lines.append("## Executive Summary\n")
    s = analysis["summary"]
    lines += [f"- Input artifacts: **{s['apk_count']} APK(s)**", f"- Native `.so` libraries: **{s['native_count']}**", f"- Shader-like files: **{s['shader_count']}**", f"- Schema/config files indexed: **{s['schema_count']}**", f"- Decompiled source files with timeline/media terms: **{s['timeline_candidate_files']}**", ""]

    lines.append("## 1. Package / Manifest Fingerprint\n")
    for item in analysis["manifests"]:
        lines.append(f"### {item['apk']}")
        lines.append("```json")
        lines.append(json.dumps(item["manifest"], indent=2, ensure_ascii=False))
        lines.append("```\n")

    lines.append("## 2. Native Media / Render Layer\n")
    for lib in analysis["native"][:150]:
        lines.append(f"### `{lib['name']}` — {lib['abi']}")
        lines.append(f"- Path: `{lib['path']}`")
        lines.append(f"- Size: {lib['size']} bytes")
        if lib["interesting_symbols"]:
            lines.append("- Interesting exported symbols:")
            lines.append("```text")
            lines.extend(lib["interesting_symbols"][:40])
            lines.append("```")
        if lib["architecture_strings"]:
            lines.append("- Architecture keyword strings:")
            lines.append("```text")
            lines.extend(lib["architecture_strings"][:60])
            lines.append("```")
        lines.append("")

    lines.append("## 3. GPU / Shader Inventory\n")
    lines.append("| Path | Type | Size | SHA-256 |")
    lines.append("|---|---|---:|---|")
    for row in analysis["shaders"][:500]:
        lines.append(f"| `{row['path']}` | `{row['extension']}` | {row['size']} | `{row['sha256'][:16]}…` |")
    if not analysis["shaders"]:
        lines.append("No shader-like files were detected by filename/extension fingerprinting.\n")
    lines.append("")

    lines.append("## 4. Timeline / Media Architectural Signals\n")
    lines.append("### Keyword counts\n")
    lines.append("| Term | Hits |")
    lines.append("|---|---:|")
    for term, count in analysis["source_scan"]["timeline_term_counts"][:100]:
        lines.append(f"| `{term}` | {count} |")
    lines.append("\n### Candidate source files\n")
    for row in analysis["source_scan"]["candidate_timeline_files"][:120]:
        pretty = ", ".join(f"`{k}`×{v}" for k, v in row["terms"][:10])
        lines.append(f"- `{row['path']}` — {pretty}")
    lines.append("")

    lines.append("## 5. Schema / Draft Fingerprints\n")
    lines.append("### Common JSON key names\n")
    for key, count in analysis["schemas"]["common_json_keys"][:150]:
        lines.append(f"- `{key}` — {count} file(s)")
    lines.append("\n### Indexed schema/config files (sample)\n")
    for row in analysis["schemas"]["files"][:250]:
        lines.append(f"- `{row['path']}` ({row['suffix']}, {row['size']} bytes)")
        if row.get("keys"):
            lines.append(f"  - keys: {', '.join(f'`{k}`' for k in row['keys'][:30])}")
        if row.get("tags"):
            lines.append(f"  - tags: {', '.join(f'`{k}`' for k in row['tags'][:20])}")
    lines.append("")

    lines.append("## 6. Vireon Engineering Implications\n")
    lines.append("The following are **design inferences**, not claims about CapCut internals. They turn observable signals into an original architecture for Vireon.\n")
    implications = [
        ("Canonical time model", "Keep frame-quantized media time internally, but expose seconds/frames as views. Separate source time from timeline time so slip/roll/retime never corrupt clip duration semantics."),
        ("Clip/segment model", "Treat every timeline item as an immutable media reference plus a mutable placement window: sourceIn/sourceOut + timelineStart/timelineEnd + playback transform."),
        ("Track model", "Make tracks first-class objects with lock, mute, visibility, target, magnetic/ripple policy, blend/order, and deterministic collision rules."),
        ("Edit transaction layer", "Every user gesture becomes an EditIntent evaluated against a snapshot, previewed, then committed atomically. This keeps undo/redo and collaboration deterministic."),
        ("Render graph", "Do not let the UI own composition semantics. Build a render graph from timeline state so web, Android, and future desktop renderers consume the same graph."),
        ("Media pipeline", "Separate demux/decode, frame cache, audio decode, waveform extraction, thumbnail extraction, proxy generation, and final export. The timeline should request frames; it should not decode media itself."),
        ("Automation-ready timeline", "Expose a stable command vocabulary for AI: select, split, trim, move, ripple-delete, roll, slip, slide, link, unlink, retime, add-transition, add-keyframe, add-marker, align-to-beat."),
        ("Performance", "Virtualize tracks and thumbnails, cache waveform/thumbnail results, use frame-indexed snapping, and keep high-frequency pointer updates off the React render path when possible."),
    ]
    for name, body in implications:
        lines.append(f"### {name}\n{body}\n")

    REPORT_FILE.write_text("\n".join(lines), encoding="utf-8")
    log(f"[+] Wrote {REPORT_FILE}")


def self_test() -> None:
    root = OUTPUT_DIR / "selftest_fixture"
    if root.exists():
        shutil.rmtree(root)
    (root / "apktool/assets/shaders").mkdir(parents=True)
    (root / "apktool/lib/arm64-v8a").mkdir(parents=True)
    (root / "apktool/assets/data").mkdir(parents=True)
    (root / "jadx/com/example/nle").mkdir(parents=True)
    (root / "apktool/AndroidManifest.xml").write_text('<manifest package="com.example.editor" android:versionName="1.0"><uses-permission android:name="android.permission.RECORD_AUDIO"/></manifest>')
    (root / "apktool/assets/shaders/main.frag").write_text("void main(){}")
    (root / "apktool/assets/data/draft.json").write_text(json.dumps({"timeline":{"tracks":[{"segments":[{"start":0,"duration":1,"keyframes":[]}]}]}}))
    (root / "jadx/com/example/nle/TimelineController.java").write_text('package com.example.nle; class TimelineController { void splitTrackKeyframe() { /* timerange */ } }')
    result = {
        "shaders": discover_shaders([root / "apktool"]),
        "native": native_libraries([root / "apktool"]),
        "source_scan": scan_sources([root / "jadx"]),
        "schemas": collect_schema_files([root / "apktool"]),
    }
    assert len(result["shaders"]) == 1
    assert len(result["source_scan"]["candidate_timeline_files"]) == 1
    assert any(k == "timeline.tracks" for k, _ in result["schemas"]["common_json_keys"])
    log("[PASS] dissector self-test")
    shutil.rmtree(root)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?", help="Path to APK/XAPK. Required unless --self-test is used.")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--output", default=str(OUTPUT_DIR))
    parser.add_argument("--report", default=str(REPORT_FILE))
    args = parser.parse_args()

    global OUTPUT_DIR, REPORT_FILE
    OUTPUT_DIR = Path(args.output)
    REPORT_FILE = Path(args.report)

    if args.self_test:
        self_test()
        return 0
    if not args.input:
        parser.error("input APK/XAPK is required unless --self-test is used")

    input_path = Path(args.input).resolve()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    inputs = prepare_inputs(input_path, OUTPUT_DIR)
    apktool_dirs, jadx_dirs = decompile(inputs, OUTPUT_DIR)

    manifests = []
    for apk, root in zip(inputs, apktool_dirs):
        manifests.append({"apk": apk.name, "sha256": sha256(apk), "size": apk.stat().st_size, "manifest": parse_manifest(root)})

    shaders = discover_shaders(apktool_dirs)
    native = native_libraries(apktool_dirs)
    source_scan = scan_sources(jadx_dirs)
    schemas = collect_schema_files(apktool_dirs)
    analysis = {
        "summary": {
            "apk_count": len(inputs),
            "native_count": len(native),
            "shader_count": len(shaders),
            "schema_count": len(schemas["files"]),
            "timeline_candidate_files": len(source_scan["candidate_timeline_files"]),
        },
        "manifests": manifests,
        "shaders": shaders,
        "native": native,
        "source_scan": source_scan,
        "schemas": schemas,
        "inventories": [file_inventory(d) for d in apktool_dirs],
    }
    (OUTPUT_DIR / "architecture_fingerprint.json").write_text(json.dumps(analysis, indent=2, ensure_ascii=False), encoding="utf-8")
    render_report(analysis)
    log("[DONE] Architecture fingerprint complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
