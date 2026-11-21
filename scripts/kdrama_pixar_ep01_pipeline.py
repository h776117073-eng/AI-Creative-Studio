#!/usr/bin/env python3
# ONE: High School Heroes (2025) S01E01 - Pixar 3D Stylization Pipeline (Colab T4)
# Architecture: Adaptive Keyframes + SDXL-Lightning 8-step LoRA + ControlNet Canny + Bidirectional DIS Optical Flow + 24fps + 1080p
# Storage: Chunked Checkpointing + state.json on GitHub Release `kdrama-pixar-ep01`

import gc
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from urllib.parse import quote, urljoin

import requests

# Prevent huggingface_hub from hanging 15s on Colab UI secret vault lookup
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_TOKEN", "")

GITHUB_OWNER = os.environ.get("GITHUB_OWNER", "h776117073-eng")
GITHUB_REPO = os.environ.get("GITHUB_REPO", "AI-Creative-Studio")
RELEASE_TAG = os.environ.get("RELEASE_TAG", "kdrama-pixar-ep01")
GH_TOKEN = os.environ.get("GH_TOKEN", "").strip()

EP01_PAGE_URL = "https://downloadwella.com/hkzxnn7rf6it/One.High.School.Heroes.S01E01.(NKIRI.COM).mkv.html"
CHUNK_DURATION_SEC = 300  # 5-minute chunks
PILOT_START_SEC = 510     # 08:30 (dialogue + combat transition)
PILOT_DURATION_SEC = 60   # 60-second pilot test
WORK_FPS = 12
WORK_W, WORK_H = 768, 432
MAX_WALL_SEC = int(os.environ.get("MAX_WALL_SEC", "5800"))
START_MONOTONIC = time.monotonic()

WORK_DIR = "/content/pixar_ep01_work"
RAW_DIR = os.path.join(WORK_DIR, "raw")
SUBS_DIR = os.path.join(WORK_DIR, "subs")
CHUNKS_DIR = os.path.join(WORK_DIR, "chunks")
OUT_DIR = os.path.join(WORK_DIR, "out")
for _d in (RAW_DIR, SUBS_DIR, CHUNKS_DIR, OUT_DIR):
    os.makedirs(_d, exist_ok=True)

HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
}

PIXAR_PROMPT = (
    "3D Pixar Disney animated film still, expressive stylized character, soft subsurface scattering skin, "
    "clean smooth 3D shapes, cinematic volumetric lighting, vibrant balanced colors, high detail CGI render"
)
PIXAR_NEG_PROMPT = (
    "photorealistic, live action, real photo, grainy, noisy, deformed face, distorted eyes, "
    "extra fingers, blurry, low quality, text, watermark, subtitles, horror, dark muddy colors"
)


def log(msg):
    elapsed = time.monotonic() - START_MONOTONIC
    print(f"[{elapsed:7.1f}s] {msg}", flush=True)


def run_cmd(cmd, check=True, shell=False):
    return subprocess.run(cmd, check=check, shell=shell)


def ensure_dependencies():
    log("Installing system tools (aria2, ffmpeg, Cairo font) and Python packages...")
    run_cmd(
        "apt-get update -qq && apt-get install -y -qq aria2 ffmpeg fonts-arabeyes wget > /dev/null",
        check=False,
        shell=True,
    )
    run_cmd(
        'wget -q "https://github.com/google/fonts/raw/main/ofl/cairo/Cairo%5Bslnt%2Cwght%5D.ttf" '
        "-O /usr/share/fonts/truetype/Cairo.ttf && fc-cache -f > /dev/null",
        check=False,
        shell=True,
    )
    pkgs = [
        "beautifulsoup4",
        "scenedetect",
        "opencv-python-headless",
        "Pillow",
        "diffusers>=0.28.0",
        "transformers>=4.40.0",
        "accelerate>=0.30.0",
        "safetensors",
        "huggingface_hub",
        "peft",
    ]
    run_cmd([sys.executable, "-m", "pip", "install", "-q", "--upgrade"] + pkgs, check=True)
    log("Dependencies installed successfully.")


def gh_headers(content_type=None):
    if not GH_TOKEN:
        raise RuntimeError("GH_TOKEN is missing from environment; cannot access GitHub Releases.")
    h = {
        "Authorization": f"Bearer {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if content_type:
        h["Content-Type"] = content_type
    return h


def get_or_create_release():
    base_url = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases"
    r = requests.get(f"{base_url}/tags/{RELEASE_TAG}", headers=gh_headers(), timeout=30)
    if r.status_code == 200:
        rel = r.json()
        assets = {a["name"]: a for a in rel.get("assets", [])}
        return rel, assets
    payload = {
        "tag_name": RELEASE_TAG,
        "name": "ONE: High School Heroes S01E01 — Pixar 3D Stylization",
        "body": "Chunked Pixar 3D stylization outputs, Pilot QA artifacts, state.json, and final 1080p Arabic-subtitled episode.",
        "draft": False,
        "prerelease": False,
    }
    r = requests.post(base_url, headers=gh_headers(), json=payload, timeout=30)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"Failed to create GitHub Release: {r.status_code} {r.text[:300]}")
    return r.json(), {}


def delete_release_asset_if_exists(assets_map, asset_name):
    if asset_name in assets_map:
        asset_id = assets_map[asset_name]["id"]
        url = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/assets/{asset_id}"
        requests.delete(url, headers=gh_headers(), timeout=30)
        assets_map.pop(asset_name, None)


def upload_asset(release_id, assets_map, file_path, asset_name, content_type="application/octet-stream"):
    delete_release_asset_if_exists(assets_map, asset_name)
    upload_url = (
        f"https://uploads.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}"
        f"/releases/{release_id}/assets?name={quote(asset_name)}"
    )
    with open(file_path, "rb") as f:
        r = requests.post(upload_url, headers=gh_headers(content_type), data=f, timeout=600)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"Failed to upload {asset_name}: {r.status_code} {r.text[:300]}")
    asset_obj = r.json()
    assets_map[asset_name] = asset_obj
    return asset_obj.get("browser_download_url", "")


def load_state(assets_map):
    if "state.json" in assets_map:
        dl_url = assets_map["state.json"].get("browser_download_url")
        if dl_url:
            r = requests.get(dl_url, timeout=30)
            if r.status_code == 200:
                try:
                    return r.json()
                except Exception:
                    pass
    return {
        "episode": "S01E01",
        "release_tag": RELEASE_TAG,
        "pilot_done": False,
        "pilot_passed": False,
        "pilot_flicker_score": None,
        "pilot_video_url": None,
        "pilot_qa_grid_url": None,
        "total_chunks": 0,
        "completed_chunks": [],
        "chunk_urls": {},
        "subtitle_url": None,
        "final_video_url": None,
        "updated_utc": None,
    }


def save_state(release_id, assets_map, state):
    state["updated_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    state_path = os.path.join(WORK_DIR, "state.json")
    with open(state_path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
    upload_asset(release_id, assets_map, state_path, "state.json", "application/json")
    log(f"Saved state.json -> completed_chunks={len(state['completed_chunks'])}/{state['total_chunks']}")


def resolve_downloadwella(page_url):
    from bs4 import BeautifulSoup
    sess = requests.Session()
    sess.headers.update(HTTP_HEADERS)
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


def download_raw_episode():
    raw_file = os.path.join(RAW_DIR, "S01E01_raw.mkv")
    if os.path.exists(raw_file) and os.path.getsize(raw_file) > 20 * 1024 * 1024:
        return raw_file
    log(f"Resolving clean raw S01E01 from {EP01_PAGE_URL}...")
    direct_url = resolve_downloadwella(EP01_PAGE_URL)
    log("Downloading clean raw S01E01 via aria2c...")
    run_cmd(
        [
            "aria2c", "-x", "16", "-s", "16", "-k", "1M",
            "--max-tries=5", "--retry-wait=3",
            f"--user-agent={HTTP_HEADERS['User-Agent']}",
            "--dir", RAW_DIR, "--out", "S01E01_raw.mkv", direct_url,
        ],
        check=True,
    )
    if not os.path.exists(raw_file) or os.path.getsize(raw_file) < 20 * 1024 * 1024:
        raise RuntimeError("Downloaded S01E01 raw file is missing or too small.")
    log(f"Downloaded clean raw S01E01 ({os.path.getsize(raw_file) / (1024*1024):.1f} MB)")
    return raw_file


def fetch_arabic_subtitle(raw_file, release_id, assets_map, state):
    srt_path = os.path.join(SUBS_DIR, "S01E01_ar.srt")
    if "S01E01_ar.srt" in assets_map:
        r = requests.get(assets_map["S01E01_ar.srt"]["browser_download_url"], timeout=30)
        if r.status_code == 200 and len(r.content) > 500:
            with open(srt_path, "wb") as f:
                f.write(r.content)
            state["subtitle_url"] = assets_map["S01E01_ar.srt"]["browser_download_url"]
            return srt_path

    try:
        probe = subprocess.check_output(
            [
                "ffprobe", "-v", "error", "-select_streams", "s",
                "-show_entries", "stream=index:stream_tags=language,title",
                "-of", "json", raw_file,
            ]
        ).decode("utf-8")
        for s in json.loads(probe).get("streams", []):
            tags = s.get("tags", {})
            lang = (tags.get("language", "") + " " + tags.get("title", "")).lower()
            if "ara" in lang or "arab" in lang:
                idx = s["index"]
                run_cmd(["ffmpeg", "-y", "-v", "error", "-i", raw_file, "-map", f"0:{idx}", srt_path], check=True)
                url = upload_asset(release_id, assets_map, srt_path, "S01E01_ar.srt", "text/plain")
                state["subtitle_url"] = url
                log("Extracted embedded Arabic subtitle and uploaded S01E01_ar.srt.")
                return srt_path
    except Exception:
        pass

    try:
        r = requests.get(
            "https://www.subtitlecat.com/index.php?search=one+high+school+heroes",
            headers=HTTP_HEADERS,
            timeout=20,
        )
        if r.status_code == 200:
            pages = re.findall(r'href="(subs/[^"]+)"', r.text)
            for p in pages:
                if re.search(r"S01E0?1(?![0-9])", p, re.I):
                    pr = requests.get(urljoin("https://www.subtitlecat.com/", p), headers=HTTP_HEADERS, timeout=20)
                    ar_links = re.findall(r'href="([^"]*ar\.srt[^"]*)"', pr.text, re.I)
                    if ar_links:
                        sr = requests.get(urljoin("https://www.subtitlecat.com/", ar_links[0]), headers=HTTP_HEADERS, timeout=20)
                        if sr.status_code == 200 and len(sr.content) > 500:
                            with open(srt_path, "wb") as f:
                                f.write(sr.content)
                            url = upload_asset(release_id, assets_map, srt_path, "S01E01_ar.srt", "text/plain")
                            state["subtitle_url"] = url
                            log("Fetched S01E01_ar.srt from SubtitleCat and uploaded to Release.")
                            return srt_path
    except Exception as exc:
        log(f"SubtitleCat warning: {exc}")
    return None


def get_video_duration(video_path):
    out = subprocess.check_output(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", video_path,
        ]
    ).decode("utf-8").strip()
    return float(out)


def detect_scenes_frames(clip_path, total_frames):
    from scenedetect import detect, ContentDetector
    try:
        scenes = detect(clip_path, ContentDetector(threshold=27.0))
        bounds = []
        for start_t, end_t in scenes:
            s_idx = max(0, int(round(start_t.get_seconds() * WORK_FPS)))
            e_idx = min(total_frames - 1, max(s_idx, int(round(end_t.get_seconds() * WORK_FPS)) - 1))
            bounds.append((s_idx, e_idx))
        if bounds:
            bounds[0] = (0, bounds[0][1])
            bounds[-1] = (bounds[-1][0], total_frames - 1)
            return bounds
    except Exception as exc:
        log(f"PySceneDetect fallback ({exc}); using single scene.")
    return [(0, total_frames - 1)]


def select_adaptive_keyframes(frame_paths, scene_bounds):
    import cv2
    import numpy as np

    kf_by_scene = []
    for s_idx, e_idx in scene_bounds:
        if s_idx > e_idx:
            continue
        kfs = [s_idx]
        last_kf = s_idx
        prev_gray = cv2.cvtColor(cv2.imread(frame_paths[s_idx]), cv2.COLOR_BGR2GRAY)
        for i in range(s_idx + 1, e_idx + 1):
            cur_gray = cv2.cvtColor(cv2.imread(frame_paths[i]), cv2.COLOR_BGR2GRAY)
            diff = float(np.mean(np.abs(cur_gray.astype(np.float32) - prev_gray.astype(np.float32))))
            prev_gray = cur_gray
            gap = i - last_kf
            if diff > 14.0:
                target_gap = 8
            elif diff > 7.0:
                target_gap = 18
            else:
                target_gap = 32
            if gap >= target_gap:
                kfs.append(i)
                last_kf = i
        if kfs[-1] != e_idx and (e_idx - kfs[-1]) >= 6:
            kfs.append(e_idx)
        kf_by_scene.append((s_idx, e_idx, kfs))
    return kf_by_scene


def load_stylizer_pipeline():
    import torch
    from diffusers import (
        ControlNetModel,
        EulerDiscreteScheduler,
        StableDiffusionXLControlNetImg2ImgPipeline,
    )
    from huggingface_hub import hf_hub_download

    log("Loading SDXL-Lightning (8-step LoRA) + ControlNet Canny (fp16, low_cpu_mem_usage)...")
    base_model = "stabilityai/stable-diffusion-xl-base-1.0"
    controlnet = ControlNetModel.from_pretrained(
        "diffusers/controlnet-canny-sdxl-1.0",
        torch_dtype=torch.float16,
        variant="fp16",
        use_safetensors=True,
        low_cpu_mem_usage=True,
    )
    pipe = StableDiffusionXLControlNetImg2ImgPipeline.from_pretrained(
        base_model,
        controlnet=controlnet,
        torch_dtype=torch.float16,
        variant="fp16",
        use_safetensors=True,
        low_cpu_mem_usage=True,
    )
    lora_path = hf_hub_download("ByteDance/SDXL-Lightning", "sdxl_lightning_8step_lora.safetensors")
    pipe.load_lora_weights(lora_path)
    pipe.fuse_lora()
    pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing="trailing")
    pipe.enable_model_cpu_offload()
    if hasattr(pipe, "enable_vae_tiling"):
        pipe.enable_vae_tiling()
    elif hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_tiling"):
        pipe.vae.enable_tiling()
    if hasattr(pipe, "enable_vae_slicing"):
        pipe.enable_vae_slicing()
    elif hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_slicing"):
        pipe.vae.enable_slicing()
    pipe.set_progress_bar_config(disable=True)
    gc.collect()
    log("SDXL-Lightning + ControlNet Canny pipeline ready.")
    return pipe


def stylize_keyframes(pipe, frame_paths, kf_by_scene, stylized_dir):
    import cv2
    import torch
    from PIL import Image

    os.makedirs(stylized_dir, exist_ok=True)
    total_kfs = sum(len(kfs) for _, _, kfs in kf_by_scene)
    log(f"Stylizing {total_kfs} adaptive keyframes across {len(kf_by_scene)} scenes...")
    done = 0
    for scene_num, (_, _, kfs) in enumerate(kf_by_scene):
        scene_seed = 4200 + scene_num * 17
        for idx in kfs:
            out_path = os.path.join(stylized_dir, f"{idx:06d}.png")
            if os.path.exists(out_path):
                done += 1
                continue
            bgr = cv2.imread(frame_paths[idx])
            edges = cv2.Canny(bgr, 80, 180)
            edges_rgb = cv2.cvtColor(edges, cv2.COLOR_GRAY2RGB)
            ctrl_img = Image.fromarray(edges_rgb)
            init_img = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))

            gen = torch.Generator(device="cpu").manual_seed(scene_seed)
            res = pipe(
                prompt=PIXAR_PROMPT,
                negative_prompt=PIXAR_NEG_PROMPT,
                image=init_img,
                control_image=ctrl_img,
                strength=0.58,
                controlnet_conditioning_scale=0.65,
                guidance_scale=1.5,
                num_inference_steps=8,
                generator=gen,
            ).images[0]
            res.save(out_path)
            done += 1
            if done % 10 == 0 or done == total_kfs:
                log(f"  Stylized {done}/{total_kfs} keyframes")


def warp_frame(img, flow):
    import cv2
    import numpy as np

    h, w = flow.shape[:2]
    grid_x, grid_y = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    map_x = grid_x + flow[..., 0]
    map_y = grid_y + flow[..., 1]
    return cv2.remap(img, map_x, map_y, interpolation=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def propagate_and_interpolate_24fps(frame_paths, kf_by_scene, stylized_dir, out_24fps_dir):
    import cv2
    import numpy as np

    os.makedirs(out_24fps_dir, exist_ok=True)
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)

    prop_12 = {}
    flicker_diffs = []
    for s_idx, e_idx, kfs in kf_by_scene:
        kf_imgs = {}
        for k in kfs:
            kf_imgs[k] = cv2.imread(os.path.join(stylized_dir, f"{k:06d}.png"))

        for seg_i in range(len(kfs)):
            k0 = kfs[seg_i]
            prop_12[k0] = kf_imgs[k0]
            if seg_i == len(kfs) - 1:
                cur_style = kf_imgs[k0]
                prev_gray = cv2.cvtColor(cv2.imread(frame_paths[k0]), cv2.COLOR_BGR2GRAY)
                for f_idx in range(k0 + 1, e_idx + 1):
                    cur_gray = cv2.cvtColor(cv2.imread(frame_paths[f_idx]), cv2.COLOR_BGR2GRAY)
                    flow = dis.calc(cur_gray, prev_gray, None)
                    cur_style = warp_frame(cur_style, flow)
                    prop_12[f_idx] = cur_style
                    prev_gray = cur_gray
                continue

            k1 = kfs[seg_i + 1]
            span = k1 - k0
            if span <= 1:
                continue

            fwd = {k0: kf_imgs[k0]}
            prev_g = cv2.cvtColor(cv2.imread(frame_paths[k0]), cv2.COLOR_BGR2GRAY)
            cur_s = kf_imgs[k0]
            for f_idx in range(k0 + 1, k1):
                cur_g = cv2.cvtColor(cv2.imread(frame_paths[f_idx]), cv2.COLOR_BGR2GRAY)
                flow = dis.calc(cur_g, prev_g, None)
                cur_s = warp_frame(cur_s, flow)
                fwd[f_idx] = cur_s
                prev_g = cur_g

            bwd = {k1: kf_imgs[k1]}
            next_g = cv2.cvtColor(cv2.imread(frame_paths[k1]), cv2.COLOR_BGR2GRAY)
            cur_s = kf_imgs[k1]
            for f_idx in range(k1 - 1, k0, -1):
                cur_g = cv2.cvtColor(cv2.imread(frame_paths[f_idx]), cv2.COLOR_BGR2GRAY)
                flow = dis.calc(cur_g, next_g, None)
                cur_s = warp_frame(cur_s, flow)
                bwd[f_idx] = cur_s
                next_g = cur_g

            for f_idx in range(k0 + 1, k1):
                alpha = float(f_idx - k0) / float(span)
                blended = cv2.addWeighted(fwd[f_idx], 1.0 - alpha, bwd[f_idx], alpha, 0.0)
                prop_12[f_idx] = blended

    sorted_indices = sorted(prop_12.keys())
    out_idx = 0
    for pos, idx in enumerate(sorted_indices):
        cur_img = prop_12[idx]
        cv2.imwrite(os.path.join(out_24fps_dir, f"{out_idx:06d}.jpg"), cur_img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        out_idx += 1
        if pos + 1 < len(sorted_indices):
            nxt_img = prop_12[sorted_indices[pos + 1]]
            diff_val = float(np.mean(np.abs(nxt_img.astype(np.float32) - cur_img.astype(np.float32))) / 255.0)
            flicker_diffs.append(diff_val)
            g0 = cv2.cvtColor(cur_img, cv2.COLOR_BGR2GRAY)
            g1 = cv2.cvtColor(nxt_img, cv2.COLOR_BGR2GRAY)
            flow_01 = dis.calc(g1, g0, None) * 0.5
            flow_10 = dis.calc(g0, g1, None) * 0.5
            mid_a = warp_frame(cur_img, flow_01)
            mid_b = warp_frame(nxt_img, flow_10)
            mid = cv2.addWeighted(mid_a, 0.5, mid_b, 0.5, 0.0)
            cv2.imwrite(os.path.join(out_24fps_dir, f"{out_idx:06d}.jpg"), mid, [cv2.IMWRITE_JPEG_QUALITY, 95])
            out_idx += 1

    flicker_score = float(np.mean(flicker_diffs)) if flicker_diffs else 0.0
    return out_idx, flicker_score


def encode_1080p_segment(frames_24_dir, audio_path, out_mp4):
    has_gpu = subprocess.run("nvidia-smi > /dev/null 2>&1", shell=True).returncode == 0
    vf = "scale=1920:1080:flags=lanczos,hqdn3d=1.5:1.5:4:4,unsharp=5:5:0.6:5:5:0.0"
    if has_gpu:
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-framerate", "24", "-i", os.path.join(frames_24_dir, "%06d.jpg"),
            "-i", audio_path,
            "-vf", vf,
            "-c:v", "h264_nvenc", "-preset", "p5", "-cq", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-shortest", out_mp4,
        ]
        res = subprocess.run(cmd, check=False)
        if res.returncode == 0 and os.path.exists(out_mp4) and os.path.getsize(out_mp4) > 100000:
            return
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-framerate", "24", "-i", os.path.join(frames_24_dir, "%06d.jpg"),
        "-i", audio_path,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-shortest", out_mp4,
    ]
    run_cmd(cmd, check=True)


def build_pilot_qa_grid(frame_paths, stylized_dir, kf_by_scene, flicker_score, grid_path):
    import cv2
    import numpy as np

    all_kfs = [k for _, _, kfs in kf_by_scene for k in kfs]
    if not all_kfs:
        return
    step = max(1, len(all_kfs) // 6)
    picks = all_kfs[::step][:6]
    rows = []
    for k in picks:
        orig = cv2.imread(frame_paths[k])
        styl = cv2.imread(os.path.join(stylized_dir, f"{k:06d}.png"))
        if orig is None or styl is None:
            continue
        orig = cv2.resize(orig, (480, 270))
        styl = cv2.resize(styl, (480, 270))
        ts = k / float(WORK_FPS)
        cv2.putText(orig, f"ORIG t={ts:.1f}s", (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.putText(styl, f"PIXAR 3D t={ts:.1f}s", (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 200), 2)
        rows.append(np.hstack([orig, styl]))
    if rows:
        grid = np.vstack(rows)
        header = np.zeros((46, grid.shape[1], 3), dtype=np.uint8)
        cv2.putText(
            header,
            f"ONE: High School Heroes S01E01 Pilot QA | Flicker Score: {flicker_score:.4f}",
            (16, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.75,
            (255, 255, 255),
            2,
        )
        final_grid = np.vstack([header, grid])
        cv2.imwrite(grid_path, final_grid)


def process_segment(pipe, raw_file, start_sec, duration_sec, seg_name, build_qa=False):
    seg_dir = os.path.join(CHUNKS_DIR, seg_name)
    if os.path.exists(seg_dir):
        shutil.rmtree(seg_dir, ignore_errors=True)
    frames_dir = os.path.join(seg_dir, "frames")
    stylized_dir = os.path.join(seg_dir, "stylized")
    out24_dir = os.path.join(seg_dir, "frames_24")
    os.makedirs(frames_dir, exist_ok=True)

    clip_mp4 = os.path.join(seg_dir, "clip.mp4")
    audio_aac = os.path.join(seg_dir, "audio.aac")
    run_cmd(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-ss", str(start_sec), "-t", str(duration_sec), "-i", raw_file,
            "-vf", f"fps={WORK_FPS},scale={WORK_W}:{WORK_H}:flags=lanczos",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-an", clip_mp4,
        ],
        check=True,
    )
    run_cmd(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-ss", str(start_sec), "-t", str(duration_sec), "-i", raw_file,
            "-vn", "-c:a", "aac", "-b:a", "128k", audio_aac,
        ],
        check=True,
    )
    run_cmd(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", clip_mp4, os.path.join(frames_dir, "%06d.jpg"),
        ],
        check=True,
    )
    frame_paths = sorted(
        os.path.join(frames_dir, f) for f in os.listdir(frames_dir) if f.endswith(".jpg")
    )
    if not frame_paths:
        raise RuntimeError(f"No frames extracted for segment {seg_name}")

    scene_bounds = detect_scenes_frames(clip_mp4, len(frame_paths))
    kf_by_scene = select_adaptive_keyframes(frame_paths, scene_bounds)
    stylize_keyframes(pipe, frame_paths, kf_by_scene, stylized_dir)
    _, flicker_score = propagate_and_interpolate_24fps(frame_paths, kf_by_scene, stylized_dir, out24_dir)

    out_mp4 = os.path.join(OUT_DIR, f"{seg_name}.mp4")
    encode_1080p_segment(out24_dir, audio_aac, out_mp4)

    qa_grid_path = None
    if build_qa:
        qa_grid_path = os.path.join(OUT_DIR, "pilot_visual_qa_grid.png")
        build_pilot_qa_grid(frame_paths, stylized_dir, kf_by_scene, flicker_score, qa_grid_path)

    shutil.rmtree(seg_dir, ignore_errors=True)
    return out_mp4, flicker_score, qa_grid_path


def assemble_final_episode(release_id, assets_map, state, raw_file, srt_path):
    log("All chunks complete! Starting final 1080p assembly with original audio and Arabic subtitles...")
    concat_list_path = os.path.join(WORK_DIR, "concat_list.txt")
    local_chunks = []
    for c_idx in range(state["total_chunks"]):
        cname = f"ep01_chunk_{c_idx:02d}.mp4"
        cpath = os.path.join(OUT_DIR, cname)
        if not os.path.exists(cpath):
            dl_url = state["chunk_urls"].get(str(c_idx)) or assets_map[cname]["browser_download_url"]
            run_cmd(["aria2c", "-x", "8", "-s", "8", "--dir", OUT_DIR, "--out", cname, dl_url], check=True)
        local_chunks.append(cpath)

    with open(concat_list_path, "w", encoding="utf-8") as f:
        for p in local_chunks:
            f.write(f"file '{p}'\n")

    merged_video = os.path.join(OUT_DIR, "merged_no_sub.mp4")
    run_cmd(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", concat_list_path,
            "-c", "copy", merged_video,
        ],
        check=True,
    )

    final_name = "ONE_High_School_Heroes_S01E01_Pixar3D_1080p_AR.mp4"
    final_path = os.path.join(OUT_DIR, final_name)
    if srt_path and os.path.exists(srt_path):
        bs = chr(92)
        esc_sub = srt_path.replace(bs, "/").replace(":", bs + ":").replace("'", bs + "'")
        style = (
            "FontName=Cairo,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,"
            "BorderStyle=1,Outline=2,Shadow=0.8,MarginV=24"
        )
        run_cmd(
            [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", merged_video, "-i", raw_file,
                "-map", "0:v:0", "-map", "1:a:0",
                "-vf", f"subtitles='{esc_sub}':force_style='{style}'",
                "-c:v", "h264_nvenc", "-preset", "p5", "-cq", "20", "-pix_fmt", "yuv420p",
                "-c:a", "copy", "-shortest", final_path,
            ],
            check=True,
        )
    else:
        run_cmd(
            [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", merged_video, "-i", raw_file,
                "-map", "0:v:0", "-map", "1:a:0",
                "-c:v", "copy", "-c:a", "copy", "-shortest", final_path,
            ],
            check=True,
        )

    final_url = upload_asset(release_id, assets_map, final_path, final_name, "video/mp4")
    state["final_video_url"] = final_url
    save_state(release_id, assets_map, state)
    log(f"FINAL EPISODE UPLOADED: {final_url}")


def main():
    ensure_dependencies()
    release, assets_map = get_or_create_release()
    release_id = release["id"]
    log(f"GitHub Release ready: {release.get('html_url')}")
    state = load_state(assets_map)

    raw_file = download_raw_episode()
    srt_path = fetch_arabic_subtitle(raw_file, release_id, assets_map, state)
    total_dur = get_video_duration(raw_file)
    total_chunks = int(math.ceil(total_dur / float(CHUNK_DURATION_SEC)))
    state["total_chunks"] = total_chunks
    log(f"Episode 1 duration: {total_dur:.1f}s -> {total_chunks} chunks of {CHUNK_DURATION_SEC}s")

    pipe = load_stylizer_pipeline()

    if not state.get("pilot_done"):
        log("Starting Stage 1: 60-second Pilot Test (08:30-09:30)...")
        pilot_mp4, flicker_score, qa_grid_path = process_segment(
            pipe, raw_file, PILOT_START_SEC, PILOT_DURATION_SEC, "pilot_ep01_60s_1080p", build_qa=True
        )
        pilot_url = upload_asset(release_id, assets_map, pilot_mp4, "pilot_ep01_60s_1080p.mp4", "video/mp4")
        qa_url = upload_asset(release_id, assets_map, qa_grid_path, "pilot_visual_qa_grid.png", "image/png")
        pilot_passed = flicker_score < 0.12
        state["pilot_done"] = True
        state["pilot_passed"] = pilot_passed
        state["pilot_flicker_score"] = round(flicker_score, 5)
        state["pilot_video_url"] = pilot_url
        state["pilot_qa_grid_url"] = qa_url
        save_state(release_id, assets_map, state)
        os.remove(pilot_mp4)
        log(f"Pilot Test complete! flicker={flicker_score:.4f}, passed={pilot_passed}, url={pilot_url}")

    for c_idx in range(total_chunks):
        if c_idx in state["completed_chunks"]:
            continue
        elapsed = time.monotonic() - START_MONOTONIC
        if elapsed > MAX_WALL_SEC:
            log(f"Approaching wall-clock budget ({elapsed:.0f}s/{MAX_WALL_SEC}s); pausing cleanly for resume.")
            break
        start_s = c_idx * CHUNK_DURATION_SEC
        dur_s = min(CHUNK_DURATION_SEC, max(1.0, total_dur - start_s))
        cname = f"ep01_chunk_{c_idx:02d}"
        log(f"Processing chunk {c_idx + 1}/{total_chunks} ({start_s}s -> {start_s + dur_s:.1f}s)...")
        chunk_mp4, c_flicker, _ = process_segment(pipe, raw_file, start_s, dur_s, cname, build_qa=False)
        chunk_url = upload_asset(release_id, assets_map, chunk_mp4, f"{cname}.mp4", "video/mp4")
        state["completed_chunks"].append(c_idx)
        state["completed_chunks"] = sorted(set(state["completed_chunks"]))
        state["chunk_urls"][str(c_idx)] = chunk_url
        save_state(release_id, assets_map, state)
        os.remove(chunk_mp4)
        log(f"Uploaded {cname}.mp4 (flicker={c_flicker:.4f}) -> {chunk_url}")

    del pipe
    gc.collect()

    if len(state["completed_chunks"]) >= total_chunks and not state.get("final_video_url"):
        assemble_final_episode(release_id, assets_map, state, raw_file, srt_path)

    print("SUMMARY_JSON:" + json.dumps(state, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
