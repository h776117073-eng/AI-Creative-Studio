#!/usr/bin/env python3
"""Bounded progress poller. Does not copy or mutate the live log."""
from __future__ import annotations
import json, os
from pathlib import Path
OUT=Path("/content/dub-output")
EXIT=OUT/"runner_exit_code.txt"
PID=OUT/"runner_supervisor.pid"
PROGRESS=OUT/"Billionaire_Granny_CEO_Progress.json"
if EXIT.is_file():
    try: code=int(EXIT.read_text(encoding="utf-8").strip())
    except Exception: code=1
    print(f"COLAB_AUDIO_STATE=COMPLETED COLAB_AUDIO_EXIT_CODE={code}",flush=True)
else:
    pid=None
    try: pid=int(PID.read_text(encoding="utf-8").strip())
    except Exception: pass
    alive=False
    if pid:
        try: os.kill(pid,0); alive=True
        except (ProcessLookupError,PermissionError): pass
    progress={}
    if PROGRESS.is_file():
        try: progress=json.loads(PROGRESS.read_text(encoding="utf-8"))
        except Exception: pass
    state="RUNNING" if alive else "EXIT_UNKNOWN"
    print("COLAB_AUDIO_STATE="+state+" PID="+str(pid)+" STAGE="+str(progress.get("stage","starting"))+" UPDATED="+str(progress.get("updated_at_utc","unknown"))+" STATUS="+str(progress.get("status","unknown")),flush=True)
    if progress.get("error"): print("PROGRESS_ERROR="+str(progress.get("error"))[:500],flush=True)
for name in ("audio_first_dub.log","runner_process.log","supervisor.log","bootstrap.log"):
    p=OUT/name
    if p.is_file():
        try:
            lines=p.read_text(encoding="utf-8",errors="replace").splitlines()[-2:]
            for line in lines: print("LOG["+name+"] "+line[-350:],flush=True)
        except Exception: pass
