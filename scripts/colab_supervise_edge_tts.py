#!/usr/bin/env python3
"""Run the Colab dubbing entry point detached and persist its exit code."""
from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("/content/dub-output")
OUT.mkdir(parents=True, exist_ok=True)
EXIT_FILE = OUT / "runner_exit_code.txt"
LOG_FILE = OUT / "runner_supervisor.log"
EXIT_FILE.unlink(missing_ok=True)

with LOG_FILE.open("a", encoding="utf-8") as log:
    log.write(f"SUPERVISOR_STARTED_UTC={datetime.now(timezone.utc).isoformat()}\n")
    log.flush()
    result = subprocess.run(
        [sys.executable, "/content/colab_run_edge_tts.py"],
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT,
        check=False,
    )
    log.write(f"SUPERVISOR_EXIT_CODE={result.returncode}\n")
    log.flush()

EXIT_FILE.write_text(str(result.returncode) + "\n", encoding="utf-8")
raise SystemExit(result.returncode)
