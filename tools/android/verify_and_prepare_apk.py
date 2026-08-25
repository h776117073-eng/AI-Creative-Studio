from pathlib import Path
import os
import shutil
import subprocess
import sys
import zipfile

root = Path(sys.argv[1])
out = Path(sys.argv[2])

candidates = sorted((root / "app" / "build" / "outputs").rglob("*.apk"))
if not candidates:
    raise SystemExit("No APK produced by assembleDebug")

apk = max(candidates, key=lambda p: p.stat().st_size)
if apk.stat().st_size < 5_000_000:
    raise SystemExit(f"APK is unexpectedly small: {apk} ({apk.stat().st_size} bytes)")

with zipfile.ZipFile(apk) as zf:
    bad = zf.testzip()
    if bad is not None:
        raise SystemExit(f"APK ZIP integrity failure at entry: {bad}")
    required = {"AndroidManifest.xml", "classes.dex"}
    names = set(zf.namelist())
    if not required.issubset(names):
        raise SystemExit(f"APK missing required entries: {required - names}")

# Prefer aapt on PATH; otherwise resolve it from the Android SDK installed by CI.
aapt_cmd = shutil.which("aapt")
if aapt_cmd is None:
    sdk_root = Path(os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or "")
    candidates_aapt = [
        sdk_root / "build-tools" / "36.0.0" / "aapt",
        sdk_root / "build-tools" / "35.0.0" / "aapt",
    ]
    for candidate in candidates_aapt:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            aapt_cmd = str(candidate)
            break
if aapt_cmd is None:
    raise SystemExit("Android aapt executable not found on runner")

proc = subprocess.run([aapt_cmd, "dump", "badging", str(apk)], text=True, capture_output=True)
if proc.returncode != 0:
    raise SystemExit(f"aapt could not inspect APK: {proc.stderr.strip()}")
badging = proc.stdout
if "package: name='com.aicreativestudio.mobile'" not in badging:
    raise SystemExit("Generated APK does not contain the expected product package")
if "versionName='1.0.0'" not in badging:
    raise SystemExit("Generated APK versionName is not 1.0.0")

out.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(apk, out)
print(f"Validated APK: {out}")
print(f"Source APK: {apk}")
print(f"Size: {apk.stat().st_size} bytes")
print(f"aapt: {aapt_cmd}")
