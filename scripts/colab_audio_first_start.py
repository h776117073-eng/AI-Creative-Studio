#!/usr/bin/env python3
"""Bootstrap packages on the requested Colab T4 and start the long task detached."""
from __future__ import annotations
import os, subprocess, sys
from pathlib import Path

OUT=Path("/content/dub-output")
OUT.mkdir(parents=True,exist_ok=True)
BOOT_LOG=OUT/"bootstrap.log"
SUPERVISOR=Path("/content/colab_audio_first_supervisor.py")
EXIT=OUT/"runner_exit_code.txt"
PID=OUT/"runner_supervisor.pid"

def say(s):
    print(s,flush=True)
    with BOOT_LOG.open("a",encoding="utf-8") as f: f.write(s+"\n")

if EXIT.exists():
    EXIT.unlink()
if PID.exists():
    try:
        old=int(PID.read_text().strip())
        os.kill(old,0)
        print(f"COLAB_AUDIO_STATE=ALREADY_RUNNING PID={old}",flush=True)
        raise SystemExit(0)
    except (ValueError,ProcessLookupError,PermissionError):
        pass

if not SUPERVISOR.is_file() or not Path("/content/audio_first_dub.py").is_file():
    raise FileNotFoundError("Audio-first runner or supervisor was not uploaded.")

if not __import__("shutil").which("ffmpeg"):
    say("Installing ffmpeg.")
    subprocess.run(["bash","-lc","apt-get update -qq && apt-get install -y -qq ffmpeg"],check=True)

packages=["yt-dlp","demucs","faster-whisper","deep-translator","edge-tts","pydub","librosa","scikit-learn","speechbrain","soundfile"]
say("Installing audio-first pipeline dependencies.")
p=subprocess.run([sys.executable,"-m","pip","install","--quiet","--no-cache-dir",*packages],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,errors="replace")
if p.returncode:
    with BOOT_LOG.open("a",encoding="utf-8") as f: f.write(p.stdout[-12000:])
    raise RuntimeError("Package installation failed. See /content/dub-output/bootstrap.log.")
say("Dependencies installed. Checking requested GPU.")
import torch
if not torch.cuda.is_available():
    raise RuntimeError("No CUDA GPU is present in Colab. Refusing to run this long job on CPU.")
gpu=torch.cuda.get_device_name(0)
say("GPU="+gpu+" VRAM_GiB="+str(round(torch.cuda.get_device_properties(0).total_memory/1024**3,1)))
if "T4" not in gpu.upper():
    raise RuntimeError(f"Workflow requested a T4 but Colab returned {gpu}; refusing to proceed.")
if Path("/content/dub-output/STOP_REQUESTED").exists(): Path("/content/dub-output/STOP_REQUESTED").unlink()
with (OUT/"supervisor.log").open("a",encoding="utf-8") as log:
    child=subprocess.Popen([sys.executable,str(SUPERVISOR)],stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,close_fds=True)
PID.write_text(str(child.pid)+"\n",encoding="utf-8")
print(f"COLAB_AUDIO_STATE=STARTED PID={child.pid} GPU={gpu}",flush=True)
