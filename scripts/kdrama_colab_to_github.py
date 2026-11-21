#!/usr/bin/env python3
"""
ONE: High School Heroes (2025) - Accelerated Automated Colab Pipeline
Downloads E01-E08 via direct HTTP (downloadwella.com), fetches Arabic subtitles from SubtitleCat,
compresses to 480p HEVC (auto-uses GPU hevc_nvenc if available, otherwise libx265 veryfast 10-bit CRF 29) + Opus 48k with Cairo font,
skips already-uploaded episodes, and uploads directly to GitHub Releases.
"""
import os
import re
import json
import shutil
import requests
import subprocess
from bs4 import BeautifulSoup
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

HAS_GPU = subprocess.run("nvidia-smi > /dev/null 2>&1", shell=True).returncode == 0
print(f"Hardware acceleration detected: {'GPU (NVIDIA)' if HAS_GPU else 'CPU (libx265 veryfast)'}", flush=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
}

EPISODE_PAGES = [
    (1, "https://downloadwella.com/hkzxnn7rf6it/One.High.School.Heroes.S01E01.(NKIRI.COM).mkv.html"),
    (2, "https://downloadwella.com/69l051z6hpx6/One.High.School.Heroes.S01E02.(NKIRI.COM).mkv.html"),
    (3, "https://downloadwella.com/4mxdmxs5geeu/One.High.School.Heroes.S01E03.(NKIRI.COM).mkv.html"),
    (4, "https://downloadwella.com/m9cazxiijjjz/One.High.School.Heroes.S01E04.(NKIRI.COM).mkv.html"),
    (5, "https://downloadwella.com/1vhxq8l0gtge/One.High.School.Heroes.S01E05.(NKIRI.COM).mkv.html"),
    (6, "https://downloadwella.com/u7ws0o5s2y51/One.High.School.Heroes.S01E06.(NKIRI.COM).mkv.html"),
    (7, "https://downloadwella.com/dz7537wbkgm8/One.High.School.Heroes.S01E07.(NKIRI.COM).mkv.html"),
    (8, "https://downloadwella.com/lcwqri6nmquf/One.High.School.Heroes.S01E08.(NKIRI.COM).mkv.html"),
]


def resolve_downloadwella(page_url: str) -> str:
    sess = requests.Session()
    sess.headers.update(HEADERS)
    r = sess.get(page_url, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    form = soup.find("form", attrs={"method": re.compile(r"post", re.I)})
    if not form:
        raise RuntimeError(f"No POST form found on {page_url}")
    data = {}
    for inp in form.find_all("input"):
        name = inp.get("name")
        if name:
            data[name] = inp.get("value", "")
    data.setdefault("op", "download2")
    action = form.get("action") or page_url
    post_url = urljoin(page_url, action)
    pr = sess.post(post_url, data=data, headers={"Referer": page_url}, allow_redirects=False, timeout=30)
    if pr.status_code in (301, 302, 303, 307, 308):
        loc = pr.headers.get("Location", "")
        if loc:
            return urljoin(post_url, loc)
    if pr.status_code == 200:
        links = re.findall(r"https?://[^\s\"'<>]+\.mkv", pr.text)
        if links:
            return links[0]
        psoup = BeautifulSoup(pr.text, "html.parser")
        for a in psoup.find_all("a", href=True):
            if ".mkv" in a["href"].lower() or "/d/" in a["href"].lower():
                return urljoin(post_url, a["href"])
    raise RuntimeError(f"Could not resolve direct MKV link from {page_url} (status {pr.status_code})")


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
        "body": "ONE: High School Heroes (2025) - 480p HEVC (CRF 29) + Opus 48k with Arabic subtitles.",
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
            print(f"SubtitleCat search returned {r.status_code}", flush=True)
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
                    print(f"Downloaded Arabic sub E{ep:02d}: {out_srt} ({len(sr.content)} bytes)", flush=True)
            if len(found_eps) == 8:
                break
        print(f"Total Arabic subtitles fetched from SubtitleCat: {len(found_eps)}/8", flush=True)
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
    vf_str = ",".join(vf_chain)

    if HAS_GPU:
        gpu_cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", input_path,
            "-vf", vf_str,
            "-c:v", "hevc_nvenc",
            "-preset", "p4",
            "-rc", "vbr",
            "-cq", "29",
            "-b:v", "0",
            "-pix_fmt", "yuv420p",
            "-c:a", "libopus", "-b:a", "48k", "-ac", "2",
            output_path,
        ]
        res = subprocess.run(gpu_cmd, check=False)
        if res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 5 * 1024 * 1024:
            return
        print("NVENC fallback -> using libx265 veryfast on CPU...", flush=True)

    cpu_cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", input_path,
        "-vf", vf_str,
        "-c:v", "libx265",
        "-pix_fmt", "yuv420p10le",
        "-crf", "29",
        "-preset", "veryfast",
        "-x265-params", "aq-mode=3:strong-intra-smoothing=0:no-open-gop=1",
        "-c:a", "libopus", "-b:a", "48k", "-ac", "2",
        output_path,
    ]
    subprocess.run(cpu_cmd, check=True)


def main():
    release, existing_assets = get_or_create_release()
    release_id = release["id"]
    print(f"GitHub Release ready: {release.get('html_url')}", flush=True)
    download_subtitlecat_arabic_subs()

    uploaded = []
    errors = []

    for ep_num, page_url in EPISODE_PAGES:
        asset_name = f"01_ONE_High_School_Heroes_2025_S01E{ep_num:02d}_480p_AR.mkv"
        out_file = os.path.join(OUT_DIR, asset_name)

        if asset_name in existing_assets and existing_assets[asset_name].get("size", 0) > 10 * 1024 * 1024:
            print(f"Already uploaded on GitHub: {asset_name}", flush=True)
            uploaded.append(existing_assets[asset_name].get("browser_download_url", asset_name))
            continue

        ep_raw_dir = os.path.join(RAW_DIR, f"ep_{ep_num:02d}")
        os.makedirs(ep_raw_dir, exist_ok=True)
        raw_file = os.path.join(ep_raw_dir, f"S01E{ep_num:02d}.mkv")

        try:
            print(f"\n[E{ep_num:02d}/08] Resolving direct link from {page_url}...", flush=True)
            direct_url = resolve_downloadwella(page_url)
            print(f"[E{ep_num:02d}/08] Downloading via aria2c...", flush=True)
            subprocess.run(
                [
                    "aria2c",
                    "-x", "16",
                    "-s", "16",
                    "-k", "1M",
                    "--max-tries=5",
                    "--retry-wait=3",
                    f"--user-agent={HEADERS['User-Agent']}",
                    "--dir", ep_raw_dir,
                    "--out", f"S01E{ep_num:02d}.mkv",
                    direct_url,
                ],
                check=False,
            )
            if not os.path.exists(raw_file) or os.path.getsize(raw_file) < 20 * 1024 * 1024:
                raise RuntimeError(f"Downloaded file missing or too small: {raw_file}")

            raw_mb = os.path.getsize(raw_file) / (1024 * 1024)
            embedded_srt = os.path.join(SUBS_DIR, f"embedded_E{ep_num:02d}.srt")
            ext_srt = os.path.join(SUBS_DIR, f"S01E{ep_num:02d}_ar.srt")
            if extract_embedded_arabic_sub(raw_file, embedded_srt):
                sub_to_use = embedded_srt
            elif os.path.exists(ext_srt):
                sub_to_use = ext_srt
            else:
                sub_to_use = None

            print(
                f"[E{ep_num:02d}/08] Compressing ({raw_mb:.1f} MB) | sub: {os.path.basename(sub_to_use) if sub_to_use else 'none'}",
                flush=True,
            )
            compress_episode(raw_file, out_file, sub_to_use)
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
