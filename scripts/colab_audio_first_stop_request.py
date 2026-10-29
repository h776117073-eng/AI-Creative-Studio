#!/usr/bin/env python3
from pathlib import Path
p=Path("/content/dub-output/STOP_REQUESTED")
p.parent.mkdir(parents=True,exist_ok=True)
p.touch()
print("AUDIO_FIRST_STOP_REQUESTED=1",flush=True)
