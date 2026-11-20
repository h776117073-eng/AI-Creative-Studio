#!/usr/bin/env python3
"""
ONE: High School Heroes (2025) - Automated Colab Pipeline
Downloads E01-E08 via aria2c, fetches Arabic subtitles from SubtitleCat/OpenSubtitles,
compresses to 480p HEVC 10-bit (CRF 29) + Opus 48k with Cairo font,
and uploads directly to GitHub Releases (Zero Google Drive).
"""
import os
import re
import glob
import json
import shutil
import requests
import subprocess
from urllib.parse import quote, urljoin

GITHUB_OWNER = os.environ.get("GITHUB_OWNER", "h776117073-eng")
GITHUB_REPO = os.environ.get("GITHUB_REPO", "AI-Creative-Studio")
RELEASE_TAG = os.environ.get("RELEASE_TAG", "kdrama-480p-ar")
GH_TOKEN = os.environ.get("GH_TOKEN", "").strip()

WORK_DIR = "/content/work_temp/01_ONE_High_School_Heroes_2025"
RAW_DIR = os.path.join(WORK_DIR, "raw")
SUBS_DIR = os.path.join(WORK_DIR, "subs")
OUT_DIR = "/content/work_out"
for d in (RAW_DIR, SUBS_DIR, OUT_DIR):
    os.makedirs(d, exist_ok=True)

print("Installing tools and Cairo Arabic font...", flush=True)
subprocess.run(
    "apt-get update -qq && apt-get install -y -qq aria2 ffmpeg fonts-arabeyes fonts-kacst unzip unrar wget > /dev/null",
    shell=True,
    check=False,
)
subprocess.run(
    'wget -q "https://github.com/google/fonts/raw/main/ofl/cairo/Cairo%5Bslnt%2Cwght%5D.ttf" -O /usr/share/fonts/truetype/Cairo.ttf',
    shell=True,
    check=False,
)
subprocess.run("fc-cache -f -v > /dev/null", shell=True, check=False)
subprocess.run("pip install -q requests beautifulsoup4", shell=True, check=False)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
}

TRACKERS = (
    "&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce"
    "&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce"
    "&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce"
    "&tr=udp%3A%2F%2Fexodus.desync.com%3A6969%2Fannounce"
)

EPISODE_MAGNETS = [
    (1, "magnet:?xt=urn:btih:eb11bfabae177f63548e05a6e126e1f5797fb867&dn=ONE_High_School_Heroes_E01" + TRACKERS),
    (2, "magnet:?xt=urn:btih:b7ca9b52aba2b4f8b4c119520a39a7b34365e5fc&dn=ONE_High_School_Heroes_E02" + TRACKERS),
    (3, "magnet:?xt=urn:btih:a263e102510be8b390ccfd2ddd2585a5ffde0b2c&dn=ONE_High_School_Heroes_E03" + TRACKERS),
    (4, "magnet:?xt=urn:btih:cdcaf79b76f3390775328370c162eda932c7e519&dn=ONE_High_School_Heroes_E04" + TRACKERS),
    (5, "magnet:?xt=urn:btih:d03b8fcb27da289e796c552dce0ebe5e27ecb31d&dn=ONE_High_School_Heroes_E05" + TRACKERS),
    (6, "magnet:?xt=urn:btih:ad055db5fe494833cf3a73aa0ed95b305bdb243d&dn=ONE_High_School_Heroes_E06" + TRACKERS),
    (7, "magnet:?xt=urn:btih:1ebca836704756b237a218f2a676669090f9d4cd&dn=ONE_High_School_Heroes_E07" + TRACKERS),
    (8, "magnet:?xt=urn:btih:84fe54ee8562f0dd4241ee36524ee9df3e133936&dn=ONE_High_School_Heroes_E08" + TRACKERS),
]


def get_or_create_release():
    if not GH_TOKEN:
        raise RuntimeError("GH_TOKEN is missing from environment; cannot upload to GitHub.")
    gh_headers = {
        "Authorization": f"Bearer {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    base_url = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases"
    r = requests.get(f"{base_url}/tags/{RELEASE_TAG}", headers=gh_headers, timeout=20)
    if r.status_code == 200:
        rel = r.json()
        existing_assets = {a["name"]: a for a in rel.get("assets", [])}
        return rel, existing_assets
    payload = {
        "tag_name": RELEASE_TAG,
        "name": "Korean Drama 480p HEVC 10-bit (Arabic Sub)",
        "body": "ONE: High School Heroes (2025) - 480p HEVC 10-bit (CRF 29) + Opus 48k with Arabic subtitles.",
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


def download_subtitlecat_arabic_subs():
    print("Fetching Arabic subtitles for ONE: High School Heroes from SubtitleCat...", flush=True)
    try:
        r = requests.get(
            "https://www.subtitlecat.com/index.php?search=one+high+school+heroes",
            headers=HEADERS,
            timeout=15,
        )
        if r.status_code != 200:
            return
        pages = re.findall(r'href="(subs/[^"]+)"', r.text)
        found_eps = {}
        for p in pages:
            m = re.search(r"S01E0?([1-8])(?![0-9])", p, re.I)
            if not m:
                continue
            ep = int(m.group(1))
            if ep in found_eps:
                continue
            page_url = urljoin("https://www.subtitlecat.com/", p)
            pr = requests.get(page_url, headers=HEADERS, timeout=15)
            ar_links = re.findall(r'href="([^"]*ar\.srt[^"]*)"', pr.text, re.I)
            if ar_links:
                srt_url = urljoin("https://www.subtitlecat.com/", ar_links[0])
                sr = requests.get(srt_url, headers=HEADERS, timeout=15)
                if sr.status_code == 200 and len(sr.content) > 500:
                    out_srt = os.path.join(SUBS_DIR, f"S01E{ep:02d}_ar.srt")
                    with open(out_srt, "wb") as f:
                        f.write(sr.content)
                    found_eps[ep] = out_srt
                    print(f"Downloaded Arabic sub E{ep:02d}: {out_srt}", flush=True)
            if len(found_eps) == 8:
                break
    except Exception as e:
        print(f"SubtitleCat error: {e}", flush=True)


def extract_embedded_arabic_sub(video_path, out_srt):
    try:
        probe = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "s",
                "-show_entries",
                "stream=index:stream_tags=language,title",
                "-of",
                "json",
                video_path,
            ]
        ).decode("utf-8")
        for s in json.loads(probe).get("streams", []):
            tags = s.get("tags", {})
            lang = (tags.get("language", "") + " " + tags.get("title", "")).lower()
            if "ara" in lang or "arab" in lang:
                idx = s["index"]
                subprocess.run(
                    ["ffmpeg", "-y", "-v", "error", "-i", video_path, "-map", f"0:{idx}", out_srt],
                    check=True,
                )
                return True
    except Exception:
        pass
    return False


def compress_episode(input_path, output_path, sub_path=None):
    vf_chain = ["scale=-2:480:flags=lanczos"]
    if sub_path and os.path.exists(sub_path):
        bs = chr(92)
        escaped_sub = sub_path.replace(bs, "/").replace(":", bs + ":").replace("'", bs + "'")
        style = "FontName=Cairo,FontSize=21,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1.6,Shadow=0.6,MarginV=16"
        vf_chain.append(f"subtitles='{escaped_sub}':force_style='{style}'")
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input_path,
        "-vf",
        ",".join(vf_chain),
        "-c:v",
        "libx265",
        "-pix_fmt",
        "yuv420p10le",
        "-crf",
        "29",
        "-preset",
        "medium",
        "-x265-params",
        "aq-mode=3:strong-intra-smoothing=0:no-open-gop=1",
        "-c:a",
        "libopus",
        "-b:a",
        "48k",
        "-ac",
        "2",
        output_path,
    ]
    subprocess.run(cmd, check=True)


def main():
    release, existing_assets = get_or_create_release()
    release_id = release["id"]
    print(f"GitHub Release ready: {release.get('html_url')}", flush=True)
    download_subtitlecat_arabic_subs()

    uploaded = []
    errors = []

    for ep_num, magnet in EPISODE_MAGNETS:
        asset_name = f"01_ONE_High_School_Heroes_2025_S01E{ep_num:02d}_480p_AR.mkv"
        out_file = os.path.join(OUT_DIR, asset_name)

        if asset_name in existing_assets and existing_assets[asset_name].get("size", 0) > 10 * 1024 * 1024:
            print(f"Already uploaded on GitHub: {asset_name}", flush=True)
            uploaded.append(existing_assets[asset_name].get("browser_download_url", asset_name))
            continue

        ep_raw_dir = os.path.join(RAW_DIR, f"ep_{ep_num:02d}")
        os.makedirs(ep_raw_dir, exist_ok=True)
        print(f"\n[E{ep_num:02d}/08] Downloading via aria2c...", flush=True)
        subprocess.run(
            [
                "aria2c",
                "--seed-time=0",
                "--bt-stop-timeout=300",
                "--summary-interval=30",
                "--max-connection-per-server=16",
                "--split=16",
                "--min-split-size=1M",
                "--bt-max-peers=120",
                "--dir",
                ep_raw_dir,
                magnet,
            ],
            check=False,
        )

        vids = [
            f
            for f in glob.glob(os.path.join(ep_raw_dir, "**", "*.*"), recursive=True)
            if f.lower().endswith((".mkv", ".mp4", ".avi")) and os.path.getsize(f) > 50 * 1024 * 1024
        ]
        if not vids:
            msg = f"E{ep_num:02d}: no video file downloaded (no seeders/timeout)"
            print(msg, flush=True)
            errors.append(msg)
            shutil.rmtree(ep_raw_dir, ignore_errors=True)
            continue

        vid = vids[0]
        embedded_srt = os.path.join(SUBS_DIR, f"embedded_E{ep_num:02d}.srt")
        ext_srt = os.path.join(SUBS_DIR, f"S01E{ep_num:02d}_ar.srt")
        if extract_embedded_arabic_sub(vid, embedded_srt):
            sub_to_use = embedded_srt
        elif os.path.exists(ext_srt):
            sub_to_use = ext_srt
        else:
            sub_to_use = None

        print(f"[E{ep_num:02d}/08] Compressing {os.path.basename(vid)} | sub: {os.path.basename(sub_to_use) if sub_to_use else 'none'}", flush=True)
        try:
            compress_episode(vid, out_file, sub_to_use)
            size_mb = os.path.getsize(out_file) / (1024 * 1024)
            dl_url = upload_asset_to_release(release_id, out_file, asset_name)
            print(f"Uploaded: {asset_name} ({size_mb:.1f} MB) -> {dl_url}", flush=True)
            uploaded.append(dl_url)
        except Exception as e:
            msg = f"E{ep_num:02d}: error {e}"
            print(msg, flush=True)
            errors.append(msg)
        finally:
            shutil.rmtree(ep_raw_dir, ignore_errors=True)
            if os.path.exists(out_file):
                os.remove(out_file)

    shutil.rmtree(WORK_DIR, ignore_errors=True)
    print("\nSUMMARY_JSON:" + json.dumps({"release_url": release.get("html_url"), "uploaded": uploaded, "errors": errors}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
