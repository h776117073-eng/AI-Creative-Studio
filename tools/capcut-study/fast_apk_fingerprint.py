#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, re, zipfile
from collections import Counter
from pathlib import Path

TERMS = ('timeline','track','segment','clip','keyframe','timerange','time_range','duration','trim','split','transition','speed','curve','marker','playhead','ripple','slip','slide','roll','snap','magnetic','draft','nle','composition','compositor','render','decoder','audio','waveform','media','source','freeze','overwrite','insert')


def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()


def printable(data: bytes) -> str:
    return re.sub(rb'[^\x20-\x7e]+', b' ', data).decode('latin-1', 'ignore').lower()


def scan(path: Path) -> dict:
    counts=Counter(); descriptors=set(); dex_files=[]; total_dex=0
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            n=info.filename
            if not re.fullmatch(r'classes\d*\.dex', Path(n).name):
                continue
            dex_files.append(n); data=z.read(info); total_dex += len(data); text=printable(data)
            for term in TERMS:
                counts[term] += text.count(term)
            for match in re.finditer(r'L([a-zA-Z0-9_$/]{3,160});', text):
                value=match.group(1)
                if any(term in value for term in TERMS): descriptors.add(value)
        names=z.namelist()
        asset_hits=[n for n in names if any(term in n.lower() for term in TERMS)]
        native=[n for n in names if n.endswith('.so')]
        shaders=[n for n in names if Path(n).suffix.lower() in {'.glsl','.frag','.vert','.comp','.geom','.spv','.metal','.hlsl'} or 'shader' in Path(n).name.lower()]
        configs=[n for n in names if Path(n).suffix.lower() in {'.json','.json5','.xml','.yaml','.yml','.proto','.toml'}]
    return {'summary':{'apk_bytes':path.stat().st_size,'apk_sha256':sha256(path),'dex_files':len(dex_files),'dex_bytes':total_dex,'native':len(native),'shaders':len(shaders),'schemas':len(configs),'timeline_signals':sum(counts.values())},'dex_files':dex_files,'term_counts':counts.most_common(),'timeline_candidate_descriptors':sorted(descriptors)[:1000],'asset_path_hits':sorted(asset_hits)[:1000],'native_paths':native[:2000],'shader_paths':shaders[:1000],'schema_paths':configs[:2000]}


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('apk'); ap.add_argument('--output',default='extracted_capcut/fast_fingerprint.json'); args=ap.parse_args(); p=Path(args.apk); out=Path(args.output); out.parent.mkdir(parents=True,exist_ok=True); result=scan(p); out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8'); print(f"[PASS] fast APK fingerprint: {out}")

if __name__=='__main__': main()
