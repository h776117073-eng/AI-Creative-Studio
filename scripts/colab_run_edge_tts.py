#!/usr/bin/env python3
"""Remote Colab entry point for the no-Drive-mount dubbing run."""
from __future__ import annotations
import os
import shutil
import subprocess
import sys
from pathlib import Path

SOURCE_URL = "https://drive.google.com/file/d/1sMis6qi_j3AsBvAEL2mliPRIKf0s3-uI/view?usp=drivesdk"
METADATA_URL = "https://drive.google.com/uc?id=1eCTSdnG88AuYqhbheXIfo30fnaXLEk-T&export=download"
RUNNER = Path("/content/dub_billionaire_granny_edge_tts.py")

if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
    print("Installing FFmpeg on the Colab VM...", flush=True)
    result = subprocess.run(["bash", "-lc", "apt-get update -qq && apt-get install -y -qq ffmpeg"], check=False)
    if result.returncode:
        raise RuntimeError("Unable to install FFmpeg in Colab.")
if not RUNNER.is_file():
    raise FileNotFoundError(f"Uploaded dubbing runner is missing: {RUNNER}")

os.environ["SOURCE_URL"] = SOURCE_URL
os.environ["METADATA_URL"] = METADATA_URL
os.environ["METADATA_FILE"] = "/content/dub-output/Billionaire_Granny_CEO_Dubbing_Metadata_864_Segments.json"
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

print("GOOGLE_DRIVE_MOUNT=DISABLED", flush=True)
print("SOURCE_METHOD=public shared URL download", flush=True)
print("METADATA_METHOD=public shared URL download", flush=True)
print("No Drive API client or Drive mount will be used by this Colab task.", flush=True)
print("Starting memory-bounded 864-segment Arabic TTS pipeline...", flush=True)
result = subprocess.run([sys.executable, str(RUNNER)], check=False)
if result.returncode:
    raise RuntimeError(f"Dubbing runner failed with exit code {result.returncode}. Check /content/dub-output/Billionaire_Granny_CEO_Progress.json.")
print("DUBBING_RUNNER_EXIT=0", flush=True)
