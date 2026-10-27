from pathlib import Path
import json
import os
import platform

drive_root = Path("/content/drive/MyDrive")
result = {
    "status": "UNKNOWN",
    "python": platform.python_version(),
    "drive_root_exists": drive_root.is_dir(),
}
if drive_root.is_dir():
    marker = drive_root / ".colab-drive-permission-smoke-test.tmp"
    try:
        marker.write_text("ok", encoding="utf-8")
        result["write_test"] = "passed"
        marker.unlink()
        result["delete_test"] = "passed"
        result["status"] = "DRIVE_MOUNTED_AND_WRITABLE"
        output_dir = drive_root / "Netflix_Arabic_Dubs"
        result["existing_output_folder"] = output_dir.is_dir()
    except Exception as exc:
        result["status"] = "DRIVE_MOUNTED_BUT_WRITE_FAILED"
        result["error_type"] = type(exc).__name__
        result["error"] = str(exc)[:300]
else:
    result["status"] = "DRIVE_NOT_MOUNTED"
print(json.dumps(result, ensure_ascii=False))
if result["status"] != "DRIVE_MOUNTED_AND_WRITABLE":
    raise SystemExit(2)
