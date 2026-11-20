#!/usr/bin/env python3
"""
Automated K-Drama Torrent Download, Arabic Subtitle Fetch/Extract,
480p HEVC 10-bit (CRF 29) + Opus 48k Compression, and GitHub Release Upload
on Google Colab (Zero Google Drive).
"""
import html
import os
import re
import glob
import json
import zipfile
import shutil
import requests
import subprocess
from urllib.parse import quote
from bs4 import BeautifulSoup

GITHUB_OWNER = os.environ.get("GITHUB_OWNER", "h776117073-eng")
GITHUB_REPO = os.environ.get("GITHUB_REPO", "AI-Creative-Studio")
RELEASE_TAG = os.environ.get("RELEASE_TAG", "kdrama-480p-ar")
GH_TOKEN = os.environ.get("GH_TOKEN", "").strip()

WORK_DIR = "/content/work_temp"
OUT_DIR = "/content/work_out"
os.makedirs(WORK_DIR, exist_ok=True)
os.makedirs(OUT_DIR, exist_ok=True)

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
subprocess.run("pip install -q requests beautifulsoup4 guessit", shell=True, check=False)

SERIES_LIST = [
    {
        "folder_name": "01_ONE_High_School_Heroes_2025",
        "search_query": "ONE High School Heroes 1080p",
        "alt_query": "ONE High School Heroes",
        "sub_search": "ONE High School Heroes",
        "manual_magnet": "",
        "manual_sub_zip": "",
    },
    {
        "folder_name": "02_High_School_Return_of_a_Gangster",
        "search_query": "High School Return of a Gangster 1080p",
        "alt_query": "High School Return of a Gangster",
        "sub_search": "High School Return of a Gangster",
        "manual_magnet": "",
        "manual_sub_zip": "",
    },
    {
        "folder_name": "03_Revenge_of_Others",
        "search_query": "Revenge of Others S01 1080p",
        "alt_query": "Revenge of Others",
        "sub_search": "Revenge of Others",
        "manual_magnet": "",
        "manual_sub_zip": "",
    },
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
}


def sanitize_asset_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    return cleaned.strip("_")


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
        "body": "Compressed 480p HEVC 10-bit (CRF 29) + Opus 48k episodes with Arabic subtitles.",
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


def find_best_magnet(query, alt_query=""):
    for q in [query, alt_query]:
        if not q:
            continue
        print(f"Searching torrent: {q}", flush=True)
        try:
            url = "https://api.knaben.org/v1"
            payload = {"query": q, "order_by": "seeders", "order_direction": "desc", "size": 10}
            r = requests.post(url, json=payload, headers=HEADERS, timeout=15)
            if r.status_code == 200:
                hits = r.json().get("hits", [])
                for hit in hits:
                    magnet = hit.get("magnetUrl") or hit.get("magnet")
                    title = hit.get("title", "")
                    if magnet and ("S01" in title.upper() or "COMPLETE" in title.upper() or "E01" in title.upper()):
                        print(f"Found (Knaben): {title} | seeders: {hit.get('seeders', '?')}", flush=True)
                        return magnet
                if hits and (hits[0].get("magnetUrl") or hits[0].get("magnet")):
                    print(f"Found (Knaben): {hits[0].get('title', '')}", flush=True)
                    return hits[0].get("magnetUrl") or hits[0].get("magnet")
        except Exception as e:
            print(f"Knaben error: {e}", flush=True)

        try:
            nyaa_url = f"https://nyaa.si/?f=0&c=0_0&q={quote(q)}&s=seeders&o=desc"
            r = requests.get(nyaa_url, headers=HEADERS, timeout=15)
            if r.status_code == 200:
                mags = re.findall(r'magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^"\x27<>\s]*', r.text)
                if mags:
                    mag = html.unescape(mags[0])
                    print("Found magnet via Nyaa", flush=True)
                    return mag
        except Exception as e:
            print(f"Nyaa error: {e}", flush=True)

        try:
            st_url = f"https://solidtorrents.to/api/v1/search?q={quote(q)}&category=Video&sort=seeders"
            r = requests.get(st_url, headers=HEADERS, timeout=15)
            if r.status_code == 200:
                for item in r.json().get("results", []):
                    if item.get("magnet"):
                        print(f"Found (SolidTorrents): {item.get('title', '')}", flush=True)
                        return item["magnet"]
        except Exception as e:
            print(f"SolidTorrents error: {e}", flush=True)
    return None


def download_arabic_subs(series_name, target_dir, manual_zip=""):
    os.makedirs(target_dir, exist_ok=True)
    if manual_zip:
        zip_path = os.path.join(target_dir, "manual_subs.zip")
        subprocess.run(["wget", "-q", manual_zip, "-O", zip_path], check=False)
        if os.path.exists(zip_path):
            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(target_dir)
            return

    print(f"Searching Arabic subs for: {series_name}", flush=True)
    try:
        search_url = f"https://rest.opensubtitles.org/search/query-{quote(series_name)}/sublanguageid-ara"
        r = requests.get(search_url, headers={"User-Agent": "TemporaryUserAgent"}, timeout=15)
        if r.status_code == 200:
            results = r.json()
            results.sort(key=lambda x: ("WEB" in x.get("MovieReleaseName", "").upper()), reverse=True)
            downloaded_eps = set()
            for item in results:
                ep = item.get("SeriesEpisode")
                dl_link = item.get("SubDownloadLink")
                if dl_link and ep and ep not in downloaded_eps:
                    gz_file = os.path.join(target_dir, f"S01E{int(ep):02d}_ar.srt.gz")
                    srt_file = os.path.join(target_dir, f"S01E{int(ep):02d}_ar.srt")
                    resp = requests.get(dl_link, timeout=15)
                    with open(gz_file, "wb") as f:
                        f.write(resp.content)
                    subprocess.run(["gunzip", "-f", gz_file], check=False)
                    if os.path.exists(srt_file):
                        downloaded_eps.add(ep)
            if downloaded_eps:
                print(f"Downloaded {len(downloaded_eps)} Arabic subs from OpenSubtitles.", flush=True)
    except Exception as e:
        print(f"OpenSubtitles error: {e}", flush=True)


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


def match_subtitle_to_episode(video_filename, subs_dir):
    ep_match = re.search(r"[Ee]([0-9]{1,2})|(?:^|[^0-9])([0-9]{1,2})(?:[^0-9]|$)", os.path.basename(video_filename))
    if not ep_match:
        return None
    ep_num = int(ep_match.group(1) or ep_match.group(2))
    all_subs = glob.glob(os.path.join(subs_dir, "**", "*.srt"), recursive=True) + glob.glob(
        os.path.join(subs_dir, "**", "*.ass"), recursive=True
    )
    for sub in all_subs:
        sub_base = os.path.basename(sub)
        if re.search(rf"[Ee]0?{ep_num}(?![0-9])|(?:^|[^0-9])0?{ep_num}(?![0-9])", sub_base):
            return sub
    return None


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
    summary = {"release_url": release.get("html_url"), "series": []}

    for series in SERIES_LIST:
        name = series["folder_name"]
        print(f"\n=== Processing: {name} ===", flush=True)
        series_report = {"name": name, "status": "started", "uploaded": [], "errors": []}
        series_work = os.path.join(WORK_DIR, name)
        raw_dir = os.path.join(series_work, "raw")
        subs_dir = os.path.join(series_work, "subs")
        os.makedirs(raw_dir, exist_ok=True)
        os.makedirs(subs_dir, exist_ok=True)

        magnet = series["manual_magnet"].strip() or find_best_magnet(series["search_query"], series["alt_query"])
        if not magnet:
            print(f"No magnet found for {name}.", flush=True)
            series_report["status"] = "no_magnet"
            summary["series"].append(series_report)
            continue

        print("Downloading via aria2c...", flush=True)
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
                raw_dir,
                magnet,
            ],
            check=False,
        )

        download_arabic_subs(series["sub_search"], subs_dir, series["manual_sub_zip"])

        video_files = sorted(
            [
                f
                for f in glob.glob(os.path.join(raw_dir, "**", "*.*"), recursive=True)
                if f.lower().endswith((".mkv", ".mp4", ".avi")) and os.path.getsize(f) > 50 * 1024 * 1024
            ]
        )

        if not video_files:
            print(f"No valid video files downloaded for {name}.", flush=True)
            series_report["status"] = "no_videos"
            summary["series"].append(series_report)
            shutil.rmtree(series_work, ignore_errors=True)
            continue

        for idx, vid in enumerate(video_files, 1):
            base_name = os.path.splitext(os.path.basename(vid))[0]
            asset_name = sanitize_asset_name(f"{name}__{base_name}_480p_AR.mkv")
            out_file = os.path.join(OUT_DIR, asset_name)

            if asset_name in existing_assets and existing_assets[asset_name].get("size", 0) > 10 * 1024 * 1024:
                print(f"Already uploaded on GitHub: {asset_name}", flush=True)
                series_report["uploaded"].append(existing_assets[asset_name].get("browser_download_url", asset_name))
                os.remove(vid)
                continue

            embedded_srt = os.path.join(subs_dir, f"embedded_{idx}.srt")
            if extract_embedded_arabic_sub(vid, embedded_srt):
                sub_to_use = embedded_srt
            else:
                sub_to_use = match_subtitle_to_episode(vid, subs_dir)

            sub_status = os.path.basename(sub_to_use) if sub_to_use else "no_external_sub"
            print(f"[{idx}/{len(video_files)}] Compressing {os.path.basename(vid)} | sub: {sub_status}", flush=True)

            try:
                compress_episode(vid, out_file, sub_to_use)
                size_mb = os.path.getsize(out_file) / (1024 * 1024)
                dl_url = upload_asset_to_release(release_id, out_file, asset_name)
                print(f"Uploaded to GitHub: {asset_name} ({size_mb:.1f} MB) -> {dl_url}", flush=True)
                series_report["uploaded"].append(dl_url)
                os.remove(vid)
                os.remove(out_file)
            except Exception as e:
                err_msg = f"Error processing {os.path.basename(vid)}: {e}"
                print(err_msg, flush=True)
                series_report["errors"].append(err_msg)

        series_report["status"] = "completed"
        summary["series"].append(series_report)
        shutil.rmtree(series_work, ignore_errors=True)

    print("\nCompleted processing and GitHub Release upload!", flush=True)
    print("SUMMARY_JSON:" + json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
