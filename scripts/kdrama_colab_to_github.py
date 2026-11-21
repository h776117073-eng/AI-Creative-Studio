#!/usr/bin/env python3
"""
ONE: High School Heroes (2025) - Ultra Compression Pipeline (~45-55 MB/ep)
Downloads the already-subtitled 480p MKVs from GitHub Release kdrama-480p-ar,
re-encodes to ultra-compact 480p HEVC (NVENC p7 + AQ / CPU libx265 CRF 32 fallback) + Opus 36k,
and uploads to GitHub Release kdrama-480p-ar-ultra.
"""
import os
import json
import shutil
import requests
import subprocess
from urllib.parse import quote

GITHUB_OWNER = os.environ.get("GITHUB_OWNER", "h776117073-eng")
GITHUB_REPO = os.environ.get("GITHUB_REPO", "AI-Creative-Studio")
SRC_TAG = "kdrama-480p-ar"
DEST_TAG = "kdrama-480p-ar-ultra"
GH_TOKEN = os.environ.get("GH_TOKEN", "").strip()

WORK_DIR = "/content/work_ultra"
RAW_DIR = os.path.join(WORK_DIR, "raw")
OUT_DIR = os.path.join(WORK_DIR, "out")
for d in (RAW_DIR, OUT_DIR):
    os.makedirs(d, exist_ok=True)

print("Installing aria2 and ffmpeg...", flush=True)
subprocess.run(
    "apt-get update -qq && apt-get install -y -qq aria2 ffmpeg > /dev/null",
    shell=True,
    check=False,
)

HAS_GPU = subprocess.run("nvidia-smi > /dev/null 2>&1", shell=True).returncode == 0
print(f"Hardware acceleration detected: {'GPU (NVIDIA NVENC p7)' if HAS_GPU else 'CPU (libx265 fast)'}", flush=True)


def get_or_create_release():
    if not GH_TOKEN:
        raise RuntimeError("GH_TOKEN is missing from environment; cannot upload to GitHub.")
    gh_headers = {
        "Authorization": f"Bearer {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    base_url = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases"
    r = requests.get(f"{base_url}/tags/{DEST_TAG}", headers=gh_headers, timeout=20)
    if r.status_code == 200:
        rel = r.json()
        existing_assets = {a["name"]: a for a in rel.get("assets", [])}
        return rel, existing_assets
    payload = {
        "tag_name": DEST_TAG,
        "name": "ONE: High School Heroes 480p HEVC Ultra-Compressed (Arabic Sub)",
        "body": "Ultra-compressed 480p HEVC + Opus 36k (~45-55 MB/ep) with burned-in Cairo Arabic subtitles.",
        "draft": False,
        "prerelease": False,
    }
    r = requests.post(base_url, headers=gh_headers, json=payload, timeout=20)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"Failed to create GitHub Release: {r.status_code} {r.text}")
    return r.json(), {}


def upload_asset_to_release(release_id: int, file_path: str, asset_name: str) -> str:
    upload_url = f"https://uploads.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/{release_id}/assets?name={quote(asset_name)}"
    gh_headers = {
        "Authorization": f"Bearer {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/octet-stream",
    }
    with open(file_path, "rb") as f:
        r = requests.post(upload_url, headers=gh_headers, data=f, timeout=600)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"Failed to upload {asset_name}: {r.status_code} {r.text[:300]}")
    return r.json().get("browser_download_url", "")


def ultra_compress(input_path: str, output_path: str):
    if HAS_GPU:
        gpu_cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", input_path,
            "-c:v", "hevc_nvenc",
            "-preset", "p7",
            "-rc", "vbr",
            "-cq", "33",
            "-b:v", "120k",
            "-maxrate", "200k",
            "-bufsize", "400k",
            "-spatial_aq", "1",
            "-temporal_aq", "1",
            "-pix_fmt", "yuv420p",
            "-c:a", "libopus", "-b:a", "36k", "-ac", "2",
            output_path,
        ]
        res = subprocess.run(gpu_cmd, check=False)
        if res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 5 * 1024 * 1024:
            return
        print("NVENC p7 fallback -> using libx265 fast CRF 32...", flush=True)

    cpu_cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", input_path,
        "-c:v", "libx265",
        "-pix_fmt", "yuv420p10le",
        "-crf", "32",
        "-preset", "fast",
        "-x265-params", "aq-mode=3:strong-intra-smoothing=0:no-open-gop=1",
        "-c:a", "libopus", "-b:a", "36k", "-ac", "2",
        output_path,
    ]
    subprocess.run(cpu_cmd, check=True)


def main():
    release, existing_assets = get_or_create_release()
    release_id = release["id"]
    print(f"GitHub Release ready: {release.get('html_url')}", flush=True)

    uploaded = []
    errors = []

    for ep_num in range(1, 9):
        src_name = f"01_ONE_High_School_Heroes_2025_S01E{ep_num:02d}_480p_AR.mkv"
        dest_name = f"01_ONE_High_School_Heroes_2025_S01E{ep_num:02d}_480p_AR_Ultra.mkv"
        src_url = f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/download/{SRC_TAG}/{src_name}"
        raw_file = os.path.join(RAW_DIR, src_name)
        out_file = os.path.join(OUT_DIR, dest_name)

        if dest_name in existing_assets and existing_assets[dest_name].get("size", 0) > 10 * 1024 * 1024:
            print(f"Already uploaded: {dest_name}", flush=True)
            uploaded.append(existing_assets[dest_name].get("browser_download_url", dest_name))
            continue

        try:
            print(f"\n[E{ep_num:02d}/08] Downloading {src_name} from GitHub Release...", flush=True)
            subprocess.run(
                [
                    "aria2c", "-x", "16", "-s", "16", "-k", "1M",
                    "--max-tries=5", "--dir", RAW_DIR, "--out", src_name, src_url,
                ],
                check=True,
            )
            raw_mb = os.path.getsize(raw_file) / (1024 * 1024)
            print(f"[E{ep_num:02d}/08] Ultra-compressing ({raw_mb:.1f} MB)...", flush=True)
            ultra_compress(raw_file, out_file)
            out_mb = os.path.getsize(out_file) / (1024 * 1024)
            dl_url = upload_asset_to_release(release_id, out_file, dest_name)
            print(f"Uploaded: {dest_name} ({raw_mb:.1f} MB -> {out_mb:.1f} MB) -> {dl_url}", flush=True)
            uploaded.append(dl_url)
        except Exception as e:
            msg = f"E{ep_num:02d}: error {e}"
            print(msg, flush=True)
            errors.append(msg)
        finally:
            for p in (raw_file, out_file):
                if os.path.exists(p):
                    os.remove(p)

    shutil.rmtree(WORK_DIR, ignore_errors=True)
    print("\nSUMMARY_JSON:" + json.dumps({"release_url": release.get("html_url"), "uploaded": uploaded, "errors": errors}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
