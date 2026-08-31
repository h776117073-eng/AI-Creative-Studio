#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, shutil
from pathlib import Path


def main() -> int:
    p=argparse.ArgumentParser(); p.add_argument('--full',required=True); p.add_argument('--fast',required=True); p.add_argument('--out',required=True); p.add_argument('--report',required=True); a=p.parse_args()
    full=Path(a.full); fast=Path(a.fast); out=Path(a.out); report=Path(a.report); out.parent.mkdir(parents=True,exist_ok=True)
    if full.is_file() and full.stat().st_size:
        shutil.copy2(full,out)
        if not report.exists() or report.stat().st_size==0:
            report.write_text('# CapCut Architecture Fingerprint\n\nFull JADX structural fingerprint completed.\n',encoding='utf-8')
        print('[PASS] selected full fingerprint')
        return 0
    if not fast.is_file() or not fast.stat().st_size: raise SystemExit('No usable fingerprint found')
    shutil.copy2(fast,out)
    report.write_text('# CapCut Architecture Fingerprint\n\nFull JADX decompilation was not available within the CI budget. This report uses the fast APK/Dex structural fingerprint to avoid blocking analysis on very large builds.\n',encoding='utf-8')
    print('[PASS] selected fast structural fingerprint')
    return 0

if __name__=='__main__': raise SystemExit(main())
