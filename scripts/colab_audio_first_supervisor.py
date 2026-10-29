#!/usr/bin/env python3
"""Supervise audio-first dubbing and persist the exit code."""
from __future__ import annotations
import os, subprocess, sys
from pathlib import Path
OUT=Path("/content/dub-output")
OUT.mkdir(parents=True,exist_ok=True)
EXIT=OUT/"runner_exit_code.txt"
RUNNER=Path("/content/audio_first_dub.py")
if not RUNNER.is_file(): raise FileNotFoundError(str(RUNNER))
with (OUT/"runner_process.log").open("a",encoding="utf-8") as f:
    result=subprocess.run([sys.executable,str(RUNNER)],stdin=subprocess.DEVNULL,stdout=f,stderr=subprocess.STDOUT,check=False)
EXIT.write_text(str(result.returncode)+"\n",encoding="utf-8")
raise SystemExit(result.returncode)
