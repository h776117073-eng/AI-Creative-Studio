#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any

SHADERS = {'.glsl', '.frag', '.vert', '.comp', '.geom', '.tesc', '.tese', '.spv', '.metal', '.hlsl'}
SCHEMAS = {'.json', '.json5', '.xml', '.yaml', '.yml', '.proto', '.toml'}
TERMS = (
    'timeline', 'track', 'segment', 'clip', 'keyframe', 'timerange', 'time_range', 'duration',
    'trim', 'split', 'transition', 'speed', 'curve', 'marker', 'playhead', 'ripple', 'slip',
    'slide', 'roll', 'snap', 'magnetic', 'draft', 'nle', 'composition', 'compositor', 'render',
    'decoder', 'audio', 'waveform', 'media', 'source'
)


def run(cmd: list[str], check: bool = True) -> str:
    print('[*]', ' '.join(cmd), flush=True)
    p = subprocess.run(cmd, text=True, capture_output=True)
    if check and p.returncode:
        raise RuntimeError(f"command failed: {' '.join(cmd)}\n{p.stderr[-4000:]}")
    return p.stdout


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def rel(path: Path, root: Path) -> str:
    return str(path.resolve().relative_to(root.resolve()))


def xapk_members(path: Path, out: Path) -> list[Path]:
    root = out / 'xapk'
    root.mkdir(parents=True, exist_ok=True)
    result: list[Path] = []
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            name = Path(info.filename)
            target = (root / name).resolve()
            if info.is_dir() or not str(target).startswith(str(root.resolve())) or name.suffix.lower() != '.apk':
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, target.open('wb') as dst:
                shutil.copyfileobj(src, dst)
            result.append(target)
    if not result:
        raise RuntimeError('No APK members found in XAPK/ZIP')
    return result


def inputs(path: Path, out: Path) -> list[Path]:
    if path.suffix.lower() == '.xapk' or (zipfile.is_zipfile(path) and path.suffix.lower() != '.apk'):
        return xapk_members(path, out)
    return [path]


def manifest(root: Path) -> dict[str, Any]:
    p = root / 'AndroidManifest.xml'
    if not p.exists():
        return {'exists': False}
    text = p.read_text(errors='ignore')
    attrs: dict[str, str] = {}
    for key in ('package', 'versionName', 'versionCode'):
        match = re.search(rf'\b{re.escape(key)}\s*=\s*"([^"]+)"', text)
        if match:
            attrs[key] = match.group(1)
    permissions = sorted(set(re.findall(r'uses-permission[^>]+android:name="([^"]+)"', text)))
    return {'exists': True, 'attributes': attrs, 'permissions': permissions}


def decompile(apks: list[Path], out: Path) -> tuple[list[Path], list[Path]]:
    apk_dirs: list[Path] = []
    jadx_dirs: list[Path] = []
    for i, apk in enumerate(apks):
        tag = re.sub(r'[^A-Za-z0-9_.-]', '_', apk.stem) or f'apk_{i}'
        apk_dir = out / 'apktool_out' / tag
        jadx_dir = out / 'jadx_out' / tag
        run(['apktool', 'd', '-f', str(apk), '-o', str(apk_dir)])
        run(['jadx', '-d', str(jadx_dir), '--no-res', '--output-format', 'java', str(apk)])
        apk_dirs.append(apk_dir)
        jadx_dirs.append(jadx_dir)
    return apk_dirs, jadx_dirs


def shaders(roots: list[Path]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for root in roots:
        for path in root.rglob('*'):
            if path.is_file() and (path.suffix.lower() in SHADERS or 'shader' in path.name.lower()):
                rows.append({
                    'path': rel(path, root),
                    'size': path.stat().st_size,
                    'sha256': digest(path),
                })
    return rows


def native(roots: list[Path]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    interesting_terms = ('jni', 'render', 'decode', 'encode', 'track', 'frame', 'audio', 'timeline', 'nle')
    string_terms = ('timeline', 'track', 'keyframe', 'compositor', 'render', 'decoder', 'encoder', 'frame', 'audio', 'nle', 'draft', 'shader')
    for root in roots:
        lib = root / 'lib'
        if not lib.exists():
            continue
        for path in lib.rglob('*.so'):
            symbol_lines = run(['nm', '-D', '--defined-only', str(path)], False).splitlines()
            string_lines = run(['strings', '-n', '5', str(path)], False).splitlines()
            symbol_hits = [line.strip() for line in symbol_lines if any(term in line.lower() for term in interesting_terms)][:60]
            string_hits = sorted({
                line.strip() for line in string_lines
                if any(term in line.lower() for term in string_terms)
            })[:80]
            rows.append({
                'name': path.name,
                'abi': path.parent.name,
                'path': rel(path, root),
                'size': path.stat().st_size,
                'sha256': digest(path),
                'symbols': symbol_hits,
                'strings': string_hits,
            })
    return rows


def source_scan(roots: list[Path]) -> dict[str, Any]:
    files: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    for root in roots:
        for path in root.rglob('*.java'):
            text = path.read_text(errors='ignore')
            lower = text.lower()
            hits = {term: len(re.findall(rf'\b{re.escape(term)}\b', lower)) for term in TERMS}
            hits = {key: value for key, value in hits.items() if value}
            if hits:
                counts.update(hits)
                files.append({
                    'path': rel(path, root),
                    'terms': sorted(hits.items(), key=lambda item: (-item[1], item[0]))[:15],
                })
    return {
        'term_counts': counts.most_common(),
        'candidate_files': sorted(files, key=lambda item: sum(v for _, v in item['terms']), reverse=True)[:200],
    }


def schemas(roots: list[Path]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    keys: Counter[str] = Counter()

    def walk(value: Any, prefix: str = ''):
        if isinstance(value, dict):
            for key, child in value.items():
                name = f'{prefix}.{key}' if prefix else str(key)
                keys[str(key)] += 1
                yield name
                yield from walk(child, name)
        elif isinstance(value, list):
            for child in value[:16]:
                yield from walk(child, prefix)

    for root in roots:
        for path in root.rglob('*'):
            if not path.is_file() or path.suffix.lower() not in SCHEMAS or path.stat().st_size > 2_000_000:
                continue
            row: dict[str, Any] = {
                'path': rel(path, root),
                'suffix': path.suffix.lower(),
                'size': path.stat().st_size,
                'sha256': digest(path),
            }
            if path.suffix.lower() in {'.json', '.json5'}:
                try:
                    parsed = json.loads(path.read_text(errors='ignore'))
                    row['keys'] = sorted(set(walk(parsed)))[:250]
                except Exception:
                    row['parse'] = 'invalid_or_nonstandard_json'
            elif path.suffix.lower() == '.xml':
                text = path.read_text(errors='ignore')
                row['tags'] = sorted(set(re.findall(r'<([A-Za-z_][A-Za-z0-9_.:-]*)\b', text)))[:100]
                row['attributes'] = sorted(set(re.findall(r'\b(?:android:)?([A-Za-z_][A-Za-z0-9_]*)="', text)))[:100]
            rows.append(row)
    return {'files': sorted(rows, key=lambda item: item['path'])[:2000], 'common_keys': keys.most_common(200)}


def write_report(data: dict[str, Any], report: Path) -> None:
    summary = data['summary']
    lines = [
        '# CapCut Architecture Fingerprint Study',
        '',
        '> Structural fingerprint only: no redistribution of decompiled proprietary source. Findings are used as input to an original Vireon architecture.',
        '',
        '## Summary',
        '',
        f"- APKs: **{summary['apks']}**",
        f"- Native libraries: **{summary['native']}**",
        f"- Shader-like files: **{summary['shaders']}**",
        f"- Schema/config files: **{summary['schemas']}**",
        f"- Timeline/media candidate source files: **{summary['timeline_files']}**",
        '',
        '## Manifest fingerprints',
        '',
    ]
    for item in data['manifests']:
        lines.extend([
            f"### {item['apk']}",
            f"- SHA-256: `{item['sha256']}`",
            f"- Attributes: `{json.dumps(item['manifest'].get('attributes', {}), ensure_ascii=False)}`",
            '',
        ])
    lines += ['## Native layer', '']
    for lib in data['native'][:100]:
        lines += [
            f"### `{lib['name']}` ({lib['abi']})",
            f"- `{lib['path']}` — {lib['size']} bytes — `{lib['sha256'][:16]}…`",
            '',
        ]
        if lib['symbols']:
            lines += ['```text', *lib['symbols'][:30], '```', '']
        if lib['strings']:
            lines += ['Keyword strings:', '```text', *lib['strings'][:40], '```', '']
    lines += ['## Shader inventory', '']
    lines += [f"- `{item['path']}` — {item['size']} bytes — `{item['sha256'][:16]}…`" for item in data['shaders'][:300]]
    lines += ['', '## Timeline signals', '']
    lines += [f"- `{item['path']}` — {', '.join(f'{k}×{v}' for k, v in item['terms'][:10])}" for item in data['sources']['candidate_files'][:150]]
    lines += ['', '## Common schema keys', '']
    lines += [f"- `{key}` — {count}" for key, count in data['schemas_data']['common_keys'][:150]]
    lines += [
        '', '## Vireon design implications',
        '',
        '- Canonical frame timebase with explicit source-time ↔ timeline-time mapping.',
        '- First-class tracks with targeting, locking, visibility, magnetic/ripple policy and deterministic collision resolution.',
        '- EditIntent + transaction snapshots so every gesture previews deterministically and commits atomically.',
        '- Render graph separated from UI; timeline state is the source of truth for web, Android and future desktop renderers.',
        '- Separate demux/decode, frame cache, thumbnails, waveforms, proxies and final export from timeline semantics.',
        '- AI command vocabulary should target timeline primitives rather than screen coordinates.',
    ]
    report.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def self_test() -> None:
    root = Path('.capcut_selftest')
    if root.exists():
        shutil.rmtree(root)
    (root / 'assets/shader').mkdir(parents=True)
    (root / 'lib/arm64-v8a').mkdir(parents=True)
    (root / 'jadx/com/example').mkdir(parents=True)
    (root / 'AndroidManifest.xml').write_text(
        '<manifest package="com.example.editor" android:versionName="1.0">'
        '<uses-permission android:name="android.permission.RECORD_AUDIO"/></manifest>',
        encoding='utf-8'
    )
    (root / 'assets/shader/a.frag').write_text('void main(){}', encoding='utf-8')
    (root / 'assets/draft.json').write_text(
        '{"timeline":{"tracks":[{"segments":[{"start":0,"duration":1,"keyframes":[]}] } ]}}',
        encoding='utf-8'
    )
    (root / 'jadx/com/example/T.java').write_text(
        'class T { timeline track keyframe timerange clip split render(); }', encoding='utf-8'
    )
    result = {
        'shaders': shaders([root]),
        'sources': source_scan([root / 'jadx']),
        'schemas_data': schemas([root]),
        'native': [],
    }
    assert len(result['shaders']) == 1
    assert result['sources']['candidate_files']
    assert any(key == 'timeline' for key, _ in result['schemas_data']['common_keys'])
    manifest_data = manifest(root)
    assert manifest_data['attributes'].get('package') == 'com.example.editor'
    shutil.rmtree(root)
    print('[PASS] architecture dissector self-test')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('input', nargs='?')
    parser.add_argument('--output', default='extracted_capcut')
    parser.add_argument('--report', default='CAPCUT_ARCHITECTURE_REPORT.md')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return 0
    if not args.input:
        parser.error('input APK/XAPK required unless --self-test')

    input_path = Path(args.input).resolve()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    apks = inputs(input_path, output)
    apk_dirs, jadx_dirs = decompile(apks, output)
    native_libs = native(apk_dirs)
    shader_files = shaders(apk_dirs)
    source_data = source_scan(jadx_dirs)
    schema_data = schemas(apk_dirs)
    manifests = [
        {'apk': apk.name, 'sha256': digest(apk), 'manifest': manifest(root)}
        for apk, root in zip(apks, apk_dirs)
    ]
    data = {
        'summary': {
            'apks': len(apks),
            'native': len(native_libs),
            'shaders': len(shader_files),
            'schemas': len(schema_data['files']),
            'timeline_files': len(source_data['candidate_files']),
        },
        'manifests': manifests,
        'native': native_libs,
        'shaders': shader_files,
        'sources': source_data,
        'schemas_data': schema_data,
    }
    (output / 'architecture_fingerprint.json').write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8'
    )
    write_report(data, Path(args.report))
    print('[DONE] architecture fingerprint complete')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
