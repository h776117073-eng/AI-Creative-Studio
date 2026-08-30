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

SHADERS={'.glsl','.frag','.vert','.comp','.geom','.tesc','.tese','.spv','.metal','.hlsl'}
SCHEMAS={'.json','.json5','.xml','.yaml','.yml','.proto','.toml'}
TERMS=('timeline','track','segment','clip','keyframe','timerange','time_range','duration','trim','split','transition','speed','curve','marker','playhead','ripple','slip','slide','roll','snap','magnetic','draft','nle','composition','compositor','render','decoder','audio','waveform','media','source')


def run(cmd:list[str], check:bool=True)->str:
    print('[*]',' '.join(cmd),flush=True)
    p=subprocess.run(cmd,text=True,capture_output=True)
    if check and p.returncode:
        raise RuntimeError(f"command failed: {' '.join(cmd)}\n{p.stderr[-4000:]}")
    return p.stdout


def digest(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()


def rel(path:Path,root:Path)->str:return str(path.resolve().relative_to(root.resolve()))


def xapk_members(path:Path,out:Path)->list[Path]:
    root=(out/'xapk'); root.mkdir(parents=True,exist_ok=True); result=[]
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            name=Path(info.filename); target=(root/name).resolve()
            if info.is_dir() or not str(target).startswith(str(root.resolve())) or name.suffix.lower()!='.apk': continue
            target.parent.mkdir(parents=True,exist_ok=True)
            with z.open(info) as src,target.open('wb') as dst: shutil.copyfileobj(src,dst)
            result.append(target)
    if not result: raise RuntimeError('No APK members found in XAPK/ZIP')
    return result


def inputs(path:Path,out:Path)->list[Path]:
    if path.suffix.lower()=='.xapk' or (zipfile.is_zipfile(path) and path.suffix.lower()!='.apk'):
        return xapk_members(path,out)
    return [path]


def manifest(root:Path)->dict[str,Any]:
    p=root/'AndroidManifest.xml'
    if not p.exists(): return {'exists':False}
    t=p.read_text(errors='ignore')
    attrs={k:(m.group(1) if (m:=re.search(rf'\b{re.escape(k)}\s*=\s*"([^"]+)"',t)) else None) for k in ('package','versionName','versionCode')}
    return {'exists':True,'attributes':{k:v for k,v in attrs.items() if v is not None},'permissions':sorted(set(re.findall(r'uses-permission[^>]+android:name="([^"]+)"',t)))}


def decompile(apks:list[Path],out:Path):
    a_dirs=[]; j_dirs=[]
    for i,apk in enumerate(apks):
        tag=re.sub(r'[^A-Za-z0-9_.-]','_',apk.stem) or f'apk_{i}'
        a=out/'apktool_out'/tag; j=out/'jadx_out'/tag
        run(['apktool','d','-f',str(apk),'-o',str(a)])
        run(['jadx','-d',str(j),'--no-res','--output-format','java',str(apk)])
        a_dirs.append(a); j_dirs.append(j)
    return a_dirs,j_dirs


def shaders(roots):
    rows=[]
    for root in roots:
        for p in root.rglob('*'):
            if p.is_file() and (p.suffix.lower() in SHADERS or 'shader' in p.name.lower()):
                rows.append({'path':rel(p,root),'size':p.stat().st_size,'sha256':digest(p)})
    return rows


def native(roots):
    rows=[]
    for root in roots:
        lib=root/'lib'
        if not lib.exists(): continue
        for p in lib.rglob('*.so'):
            symbols=run(['nm','-D','--defined-only',str(p)],False).splitlines()
            strings=run(['strings','-n','5',str(p)],False).splitlines()
            rows.append({'name':p.name,'abi':p.parent.name,'path':rel(p,root),'size':p.stat().st_size,'sha256':digest(p),'symbols':[s.strip() for s in symbols if any(x in s.lower() for x in ('jni','render','decode','encode','track','frame','audio','timeline','nle'))][:60],'strings':sorted(set(s.strip() for s in strings if any(x in s.lower() for x in ('timeline','track','keyframe','compositor','render','decoder','encoder','frame','audio','nle','draft','shader')))[:80]})
    return rows


def source_scan(roots):
    files=[]; counts=Counter()
    for root in roots:
        for p in root.rglob('*.java'):
            t=p.read_text(errors='ignore'); low=t.lower()
            hits={term:len(re.findall(rf'\b{re.escape(term)}\b',low)) for term in TERMS}
            hits={k:v for k,v in hits.items() if v}
            if hits:
                counts.update(hits); files.append({'path':rel(p,root),'terms':sorted(hits.items(),key=lambda x:(-x[1],x[0]))[:15]})
    return {'term_counts':counts.most_common(),'candidate_files':sorted(files,key=lambda x:sum(v for _,v in x['terms']),reverse=True)[:200]}


def schemas(roots):
    rows=[]; keys=Counter()
    def walk(x,prefix=''):
        if isinstance(x,dict):
            for k,v in x.items():
                name=f'{prefix}.{k}' if prefix else str(k); keys[k]+=1; yield name; yield from walk(v,name)
        elif isinstance(x,list):
            for v in x[:16]: yield from walk(v,prefix)
    for root in roots:
        for p in root.rglob('*'):
            if not p.is_file() or p.suffix.lower() not in SCHEMAS or p.stat().st_size>2_000_000: continue
            row={'path':rel(p,root),'suffix':p.suffix.lower(),'size':p.stat().st_size,'sha256':digest(p)}
            if p.suffix.lower() in {'.json','.json5'}:
                try: row['keys']=sorted(set(walk(json.loads(p.read_text(errors='ignore')))))[:250]
                except Exception: row['parse']='invalid_or_nonstandard_json'
            elif p.suffix.lower()=='.xml':
                t=p.read_text(errors='ignore')
                row['tags']=sorted(set(re.findall(r'<([A-Za-z_][A-Za-z0-9_.:-]*)\b',t)))[:100]
                row['attributes']=sorted(set(re.findall(r'\b(?:android:)?([A-Za-z_][A-Za-z0-9_]*)="',t)))[:100]
            rows.append(row)
    return {'files':sorted(rows,key=lambda x:x['path'])[:2000],'common_keys':keys.most_common(200)}


def write_report(data:dict[str,Any],report:Path):
    s=data['summary']; lines=['# CapCut Architecture Fingerprint Study','', '> Structural fingerprint only: no redistribution of decompiled proprietary source. Findings are used as input to an original Vireon architecture.','', '## Summary','',f"- APKs: **{s['apks']}**",f"- Native libraries: **{s['native']}**",f"- Shader-like files: **{s['shaders']}**",f"- Schema/config files: **{s['schemas']}**",f"- Timeline/media candidate source files: **{s['timeline_files']}**",'','## Manifest fingerprints','']
    for m in data['manifests']:
        lines += [f"### {m['apk']}",f"- SHA-256: `{m['sha256']}`",f"- Attributes: `{json.dumps(m['manifest'].get('attributes',{}),ensure_ascii=False)}`",'']
    lines += ['## Native layer','']
    for n in data['native'][:100]:
        lines += [f"### `{n['name']}` ({n['abi']})",f"- `{n['path']}` — {n['size']} bytes — `{n['sha256'][:16]}…`",'']
        if n['symbols']: lines += ['```text']+n['symbols'][:30]+['```','']
        if n['strings']: lines += ['Keyword strings:','```text']+n['strings'][:40]+['```','']
    lines += ['## Shader inventory','']+[f"- `{x['path']}` — {x['size']} bytes — `{x['sha256'][:16]}…`" for x in data['shaders'][:300]]+['','## Timeline signals','']+[f"- `{x['path']}` — {', '.join(f'{k}×{v}' for k,v in x['terms'][:10])}" for x in data['sources']['candidate_files'][:150]]+['','## Common schema keys','']+[f'- `{k}` — {v}' for k,v in data['schemas_data']['common_keys'][:150]]+['','## Vireon design implications','', '- Canonical frame timebase with explicit source-time ↔ timeline-time mapping.', '- First-class tracks with targeting, locking, visibility, magnetic/ripple policy and deterministic collision resolution.', '- EditIntent + transaction snapshots so every gesture previews deterministically and commits atomically.', '- Render graph separated from UI; timeline state is the source of truth for web, Android and future desktop renderers.', '- Separate demux/decode, frame cache, thumbnails, waveforms, proxies and final export from timeline semantics.', '- AI command vocabulary should target timeline primitives rather than screen coordinates.']
    report.write_text('\n'.join(lines)+'\n',encoding='utf-8')


def self_test():
    out=Path('.capcut_selftest')
    if out.exists(): shutil.rmtree(out)
    (out/'assets/shader').mkdir(parents=True); (out/'lib/arm64-v8a').mkdir(parents=True); (out/'jadx/com/example').mkdir(parents=True)
    (out/'AndroidManifest.xml').write_text('<manifest package="com.example.editor" android:versionName="1.0"><uses-permission android:name="android.permission.RECORD_AUDIO"/></manifest>')
    (out/'assets/shader/a.frag').write_text('void main(){}')
    (out/'assets/draft.json').write_text('{"timeline":{"tracks":[{"segments":[{"start":0,"duration":1,"keyframes":[]}] } ]}}')
    (out/'jadx/com/example/T.java').write_text('class T { timeline track keyframe timerange clip split render(); }')
    d={'shaders':shaders([out]),'sources':source_scan([out/'jadx']),'schemas_data':schemas([out]),'native':[]}
    assert len(d['shaders'])==1 and d['sources']['candidate_files']
    assert any(k=='timeline' for k,_ in d['schemas_data']['common_keys'])
    manifest_data=manifest(out)
    assert manifest_data['attributes'].get('package')=='com.example.editor'
    shutil.rmtree(out); print('[PASS] architecture dissector self-test')


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('input',nargs='?'); parser.add_argument('--output',default='extracted_capcut'); parser.add_argument('--report',default='CAPCUT_ARCHITECTURE_REPORT.md'); parser.add_argument('--self-test',action='store_true'); args=parser.parse_args()
    if args.self_test:
        self_test(); return 0
    if not args.input: parser.error('input APK/XAPK required unless --self-test')
    inp=Path(args.input).resolve(); out=Path(args.output); out.mkdir(parents=True,exist_ok=True)
    apks=inputs(inp,out); a,j=decompile(apks,out); nat=native(a); sh=shaders(a); srcs=source_scan(j); sch=schemas(a); mans=[{'apk':x.name,'sha256':digest(x),'manifest':manifest(r)} for x,r in zip(apks,a)]
    data={'summary':{'apks':len(apks),'native':len(nat),'shaders':len(sh),'schemas':len(sch['files']),'timeline_files':len(srcs['candidate_files'])},'manifests':mans,'native':nat,'shaders':sh,'sources':srcs,'schemas_data':sch}
    (out/'architecture_fingerprint.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8'); write_report(data,Path(args.report)); print('[DONE] architecture fingerprint complete')
    return 0

if __name__=='__main__': raise SystemExit(main())
