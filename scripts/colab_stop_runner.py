#!/usr/bin/env python3
"""Stop only the supervised dubbing process tree, preserving completed checkpoints."""
from __future__ import annotations

import os
import signal
import time
from pathlib import Path

OUT = Path("/content/dub-output")
PID_FILE = OUT / "runner_supervisor.pid"
EXIT_FILE = OUT / "runner_exit_code.txt"

if not PID_FILE.is_file():
    print("COLAB_STOP=NO_PID_FILE", flush=True)
    raise SystemExit(0)

try:
    root = int(PID_FILE.read_text(encoding="utf-8").strip())
except Exception:
    print("COLAB_STOP=INVALID_PID_FILE", flush=True)
    raise SystemExit(0)

def process_table():
    table = {}
    for item in Path("/proc").iterdir():
        if not item.name.isdigit():
            continue
        pid = int(item.name)
        try:
            raw = (item / "stat").read_text(encoding="utf-8")
            tail = raw.rsplit(")", 1)[1].strip().split()
            ppid = int(tail[1])
            table[pid] = ppid
        except Exception:
            continue
    return table

table = process_table()
descendants = {root}
changed = True
while changed:
    changed = False
    for pid, ppid in table.items():
        if ppid in descendants and pid not in descendants:
            descendants.add(pid)
            changed = True

def depth(pid, parents, seen=None):
    seen = set() if seen is None else seen
    if pid in seen or pid not in parents or parents[pid] == 0:
        return 0
    seen.add(pid)
    return 1 + depth(parents[pid], parents, seen)

ordered = sorted(descendants, key=lambda pid: depth(pid, table), reverse=True)
for pid in ordered:
    try:
        os.kill(pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass

deadline = time.time() + 8
while time.time() < deadline:
    remaining = []
    for pid in descendants:
        try:
            os.kill(pid, 0)
            remaining.append(pid)
        except (ProcessLookupError, PermissionError):
            pass
    if not remaining:
        break
    time.sleep(0.25)

for pid in ordered:
    try:
        os.kill(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass

if not EXIT_FILE.exists():
    EXIT_FILE.write_text("124\n", encoding="utf-8")
print(f"COLAB_STOP=SIGNALED PROCESS_COUNT={len(descendants)} CHECKPOINTS_PRESERVED=YES", flush=True)
