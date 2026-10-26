"""Small smoke test executed remotely inside Google Colab."""
import os
import platform
import subprocess
import sys

print("تم الاتصال بـ Google Colab وتنفيذ المهمة عبر GitHub Actions بنجاح!")
print("Platform:", platform.platform())
print("Python:", sys.version.replace("\n", " "))
print("CPU cores:", os.cpu_count())

try:
    result = subprocess.run(
        ["nvidia-smi"],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    print("nvidia-smi exit code:", result.returncode)
    print(result.stdout.strip() or result.stderr.strip() or "No GPU information returned.")
except FileNotFoundError:
    print("nvidia-smi is unavailable; this Colab runtime may be CPU-only.")
except subprocess.TimeoutExpired:
    print("nvidia-smi timed out.")
