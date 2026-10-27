#!/usr/bin/env python3
"""Start the long-running supervisor in the background so progress can be polled."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

OUT = Path("/content/dub-output")
OUT.mkdir(parents=True, exist_ok=True)
PID_FILE = OUT / "runner_supervisor.pid"
EXIT_FILE = OUT / "runner_exit_code.txt"

if PID_FILE.is_file() and not EXIT_FILE.is_file():
    try:
        pid = int(PID_FILE.read_text(encoding="utf-8").strip())
        os.kill(pid, 0)
        print(f"COLAB_STATE=ALREADY_RUNNING PID={pid}", flush=True)
        raise SystemExit(0)
    except (ValueError, ProcessLookupError, PermissionError):
        pass

EXIT_FILE.unlink(missing_ok=True)
launcher_log = (OUT / "runner_boot.log").open("a", encoding="utf-8")
proc = subprocess.Popen(
    [sys.executable, "/content/colab_supervise_edge_tts.py"],
    stdin=subprocess.DEVNULL,
    stdout=launcher_log,
    stderr=subprocess.STDOUT,
    start_new_session=True,
    close_fds=True,
)
PID_FILE.write_text(str(proc.pid) + "\n", encoding="utf-8")
print(f"COLAB_STATE=STARTED PID={proc.pid}", flush=True)
