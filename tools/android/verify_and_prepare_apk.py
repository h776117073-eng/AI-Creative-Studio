from pathlib import Path
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

aapt = Path(shutil.which("aapt") or "")
if not aapt:
    raise SystemExit("Android aapt tool not found on runner")

proc = subprocess.run([str(aapt), "dump", "badging", str(apk)], text=True, capture_output=True)
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
