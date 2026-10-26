#!/usr/bin/env python3
import json
import os
import platform
from pathlib import Path

mem = {}
for line in Path("/proc/meminfo").read_text().splitlines():
    key, _, rest = line.partition(":")
    if rest.strip().endswith("kB"):
        mem[key] = int(rest.strip().split()[0]) / (1024 * 1024)

probe = Path("/content/dub_smoke.txt")
probe.write_text("COLAB_FILE_STREAM_TEST_OK\n", encoding="utf-8")

print(json.dumps({
    "status": "COLAB_RUNTIME_OK",
    "python": platform.python_version(),
    "platform": platform.platform(),
    "cpu_count": os.cpu_count(),
    "ram_total_gib": round(mem.get("MemTotal", 0), 2),
    "ram_available_gib": round(mem.get("MemAvailable", 0), 2),
    "probe_file": str(probe),
    "probe_bytes": probe.stat().st_size,
}, ensure_ascii=False))
