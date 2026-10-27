#!/usr/bin/env python3
"""Report progress and completion without interrupting the background Colab job."""
from __future__ import annotations

import json
import os
from pathlib import Path

OUT = Path("/content/dub-output")
PID_FILE = OUT / "runner_supervisor.pid"
EXIT_FILE = OUT / "runner_exit_code.txt"
PROGRESS_FILE = OUT / "Billionaire_Granny_CEO_Progress.json"

if EXIT_FILE.is_file():
    try:
        code = int(EXIT_FILE.read_text(encoding="utf-8").strip())
    except Exception:
        code = 1
    print(f"COLAB_STATE=COMPLETED COLAB_EXIT_CODE={code}", flush=True)
    raise SystemExit(0)

pid = None
if PID_FILE.is_file():
    try:
        pid = int(PID_FILE.read_text(encoding="utf-8").strip())
    except Exception:
        pid = None

alive = False
if pid:
    try:
        os.kill(pid, 0)
        alive = True
    except (ProcessLookupError, PermissionError):
        alive = False

progress = {}
if PROGRESS_FILE.is_file():
    try:
        progress = json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
    except Exception:
        progress = {}

if alive:
    stage = str(progress.get("stage", "starting")).replace(" ", "_")
    updated = str(progress.get("updated_at_utc", "unknown"))
    details = []
    for key in ("finished", "total", "successful", "translated", "segment_count"):
        if key in progress:
            details.append(f"{key}={progress[key]}")
    suffix = " " + " ".join(details) if details else ""
    print(f"COLAB_STATE=RUNNING PID={pid} STAGE={stage} UPDATED={updated}{suffix}", flush=True)
else:
    print("COLAB_STATE=EXIT_UNKNOWN No exit code was recorded; inspect runner logs and checkpoints.", flush=True)

for filename in ("progress.log", "runner_supervisor.log", "runner_boot.log"):
    path = OUT / filename
    if path.is_file():
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()[-3:]
            for line in lines:
                print(f"LOG[{filename}] {line[-500:]}", flush=True)
        except Exception:
            pass
