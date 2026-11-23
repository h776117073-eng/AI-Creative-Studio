#!/usr/bin/env python3
"""
High-Quality Frame-by-Frame Disney 3D Video-to-Video Pipeline (v2.4 — 30-Second Quality Test with Durable Scene Checkpointing)
============================================================================================
Target: ONE: High School Heroes (2025) S01E01 — 30-second showcase (08:30 -> 09:00, 24 fps)
Architecture (ZERO optical-flow warping, ZERO sparse keyframe melting, T4 System-RAM-Safe):
  1. Dedicated Disney/Pixar 3D CGI checkpoint: liamhvn/disney-pixar-cartoon-b (SD1.5 safetensors)
     loaded component-by-component directly onto T4 GPU (FP16) so System RAM never exceeds ~4 GB.
  2. AnimateDiff v3 Motion Adapter (guoyww/animatediff-motion-adapter-v1-5-3) for native 3D
     temporal self-attention across every frame in each shot.
  3. FreeNoise sliding-window temporal attention (context_length=16, context_stride=4) per
     scene cut (PySceneDetect) so EVERY SINGLE FRAME is genuinely rendered by the diffusion
     model with smooth, flicker-free temporal coherence and zero cross-shot bleed.
  4. Multi-ControlNet on EVERY frame:
       - Depth (lllyasviel/control_v11f1p_sd15_depth via Depth-Anything-V2-Small-hf)
       - Soft Canny (lllyasviel/control_v11p_sd15_canny) for crisp facial expressions & lip sync
  5. 4x Neural Super-Resolution (RealESRGAN_x4plus_anime_6B via spandrel) on EVERY frame
     (768x432 -> 3072x1728 -> supersampled 1920x1080 Full HD 1080p).
  6. Original audio + burned-in Arabic subtitles (Cairo font, S01E01_ar.srt) + 1080p side-by-side
     QA comparison grid, uploaded to GitHub Release `kdrama-pixar-ep01`.
"""

import gc
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import quote, urljoin

# Prevent huggingface_hub from hanging on Colab UI secret vault lookup
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"

OWNER = os.environ.get("GITHUB_OWNER", "h776117073-eng")
REPO = os.environ.get("GITHUB_REPO", "AI-Creative-Studio")
RELEASE_TAG = os.environ.get("RELEASE_TAG", "kdrama-pixar-ep01")
GH_TOKEN = (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()

EP01_PAGE_URL = "https://downloadwella.com/hkzxnn7rf6it/One.High.School.Heroes.S01E01.(NKIRI.COM).mkv.html"
WORK_DIR = Path("/content/disney3d_v2_test30s")

START_SEC = int(os.environ.get("TEST_START_SEC", "510"))       # 08:30
DURATION_SEC = int(os.environ.get("TEST_DURATION_SEC", "30"))  # 30 seconds
TARGET_FPS = int(os.environ.get("TEST_FPS", "24"))             # True 24 fps
GEN_W = 768
GEN_H = 432
OUT_W = 1920
OUT_H = 1080

HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
}
START_MONOTONIC = time.monotonic()


def log(msg: str) -> None:
    elapsed = time.monotonic() - START_MONOTONIC
    print(f"[{elapsed:7.1f}s] {msg}", flush=True)


def run_cmd(cmd, check=True, shell=False):
    log(f"RUN: {cmd if isinstance(cmd, str) else ' '.join(cmd)}")
    res = subprocess.run(cmd, shell=shell, check=False)
    if check and res.returncode != 0:
        raise RuntimeError(f"Command failed (rc={res.returncode}): {cmd}")
    return res


# ---------------------------------------------------------------------------
# 1. Environment & Dependency Bootstrap (Colab T4)
# ---------------------------------------------------------------------------
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
        "requests",
        "diffusers>=0.31.0",
        "transformers>=4.44.0",
        "accelerate>=0.33.0",
        "safetensors",
        "scenedetect",
        "opencv-python-headless",
        "spandrel",
        "einops",
        "omegaconf",
        "Pillow",
    ]
    run_cmd([sys.executable, "-m", "pip", "install", "-q", "--upgrade"] + pkgs, check=True)
    log("Dependencies ready.")


# ---------------------------------------------------------------------------
# 2. GitHub Release Helpers
# ---------------------------------------------------------------------------
def gh_headers(content_type=None):
    if not GH_TOKEN:
        raise RuntimeError("GH_TOKEN is missing from environment.")
    h = {
        "Authorization": f"Bearer {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if content_type:
        h["Content-Type"] = content_type
    return h


def get_release(requests_mod):
    url = f"https://api.github.com/repos/{OWNER}/{REPO}/releases/tags/{RELEASE_TAG}"
    r = requests_mod.get(url, headers=gh_headers(), timeout=30)
    if r.status_code == 200:
        return r.json()
    raise RuntimeError(f"Release {RELEASE_TAG} not found (HTTP {r.status_code}): {r.text[:300]}")


def download_existing_scene_checkpoint(requests_mod, release_obj, s_idx: int, start_f: int, end_f: int, stylized_dir: Path) -> bool:
    import tarfile
    ckpt_name = f"disney3d_v2_scene_{s_idx + 1:02d}.tar"
    asset_url = None
    for a in release_obj.get("assets", []):
        if a.get("name") == ckpt_name and a.get("size", 0) > 10_000:
            asset_url = a.get("browser_download_url")
            break
    if not asset_url:
        return False
    tar_path = WORK_DIR / ckpt_name
    try:
        log(f"Found durable checkpoint {ckpt_name} on release! Downloading from {asset_url}...")
        r = requests_mod.get(asset_url, timeout=120)
        r.raise_for_status()
        tar_path.write_bytes(r.content)
        with tarfile.open(tar_path, "r") as tf:
            tf.extractall(path=stylized_dir)
        tar_path.unlink(missing_ok=True)
        for f_num in range(start_f + 1, end_f + 1):
            if not (stylized_dir / f"frame_{f_num:05d}.png").exists():
                return False
        log(f"Restored Scene {s_idx + 1} frames [{start_f}..{end_f - 1}] from durable checkpoint!")
        return True
    except Exception as exc:
        log(f"Warning: failed to restore {ckpt_name}: {exc}")
        return False


def save_scene_checkpoint(requests_mod, s_idx: int, start_f: int, end_f: int, stylized_dir: Path) -> None:
    import tarfile
    ckpt_name = f"disney3d_v2_scene_{s_idx + 1:02d}.tar"
    tar_path = WORK_DIR / ckpt_name
    with tarfile.open(tar_path, "w") as tf:
        for f_num in range(start_f + 1, end_f + 1):
            fp = stylized_dir / f"frame_{f_num:05d}.png"
            tf.add(fp, arcname=fp.name)
    rel_fresh = get_release(requests_mod)
    upload_asset(requests_mod, rel_fresh, tar_path, content_type="application/x-tar")
    tar_path.unlink(missing_ok=True)


def upload_asset(requests_mod, release_obj, file_path: Path, content_type="application/octet-stream"):
    asset_name = file_path.name
    for a in release_obj.get("assets", []):
        if a["name"] == asset_name:
            del_url = f"https://api.github.com/repos/{OWNER}/{REPO}/releases/assets/{a['id']}"
            requests_mod.delete(del_url, headers=gh_headers(), timeout=30)
            break

    upload_url = (
        f"https://uploads.github.com/repos/{OWNER}/{REPO}"
        f"/releases/{release_obj['id']}/assets?name={quote(asset_name)}"
    )
    log(f"Uploading {asset_name} ({file_path.stat().st_size / 1e6:.2f} MB) to release {RELEASE_TAG}...")
    with open(file_path, "rb") as f:
        r = requests_mod.post(upload_url, headers=gh_headers(content_type), data=f, timeout=600)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"Upload failed for {asset_name}: HTTP {r.status_code} {r.text[:400]}")
    data = r.json()
    log(f"Uploaded: {data['browser_download_url']}")
    return data["browser_download_url"]


# ---------------------------------------------------------------------------
# 3. Source Video & Arabic Subtitle Acquisition (Verified Method)
# ---------------------------------------------------------------------------
def resolve_downloadwella(requests_mod, page_url):
    from bs4 import BeautifulSoup

    sess = requests_mod.Session()
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


def download_clean_source_and_sub(requests_mod, work_dir: Path):
    raw_video = work_dir / "S01E01_raw.mkv"
    srt_path = work_dir / "S01E01_ar.srt"

    if not srt_path.exists():
        srt_url = f"https://github.com/{OWNER}/{REPO}/releases/download/{RELEASE_TAG}/S01E01_ar.srt"
        log(f"Fetching Arabic subtitle from {srt_url}...")
        r = requests_mod.get(srt_url, timeout=60)
        r.raise_for_status()
        srt_path.write_bytes(r.content)

    if not raw_video.exists() or raw_video.stat().st_size < 20_000_000:
        log(f"Resolving clean raw S01E01 from {EP01_PAGE_URL}...")
        direct_url = resolve_downloadwella(requests_mod, EP01_PAGE_URL)
        log("Downloading clean raw S01E01 via aria2c...")
        run_cmd(
            [
                "aria2c", "-x", "16", "-s", "16", "-k", "1M",
                "--max-tries=5", "--retry-wait=3",
                f"--user-agent={HTTP_HEADERS['User-Agent']}",
                "--dir", str(work_dir), "--out", "S01E01_raw.mkv", direct_url,
            ],
            check=True,
        )
        if not raw_video.exists() or raw_video.stat().st_size < 20_000_000:
            raise RuntimeError("Downloaded S01E01 raw file is missing or too small.")
        log(f"Downloaded raw MKV: {raw_video.stat().st_size / 1e6:.2f} MB")

    return raw_video, srt_path


# ---------------------------------------------------------------------------
# 4. Clip Extraction, Scene Detection & Disk-Backed Preprocessors
# ---------------------------------------------------------------------------
def extract_clip_and_frames(raw_video: Path, work_dir: Path):
    clip_mp4 = work_dir / "source_30s.mp4"
    frames_dir = work_dir / "src_frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    run_cmd([
        "ffmpeg", "-y",
        "-ss", str(START_SEC),
        "-t", str(DURATION_SEC),
        "-i", str(raw_video),
        "-vf", f"fps={TARGET_FPS},scale={GEN_W}:{GEN_H}:flags=lanczos",
        "-c:v", "libx264", "-crf", "16", "-preset", "fast",
        "-c:a", "aac", "-b:a", "192k",
        str(clip_mp4),
    ])

    run_cmd([
        "ffmpeg", "-y",
        "-i", str(clip_mp4),
        str(frames_dir / "frame_%05d.png"),
    ])

    frame_files = sorted(frames_dir.glob("frame_*.png"))
    log(f"Extracted {len(frame_files)} frames at {GEN_W}x{GEN_H} ({TARGET_FPS} fps)")
    return clip_mp4, frame_files


def detect_scenes(clip_mp4: Path, total_frames: int):
    from scenedetect import SceneManager, open_video
    from scenedetect.detectors import ContentDetector

    video = open_video(str(clip_mp4))
    sm = SceneManager()
    sm.add_detector(ContentDetector(threshold=27.0, min_scene_len=8))
    sm.detect_scenes(video)
    scenes = sm.get_scene_list()

    if not scenes:
        return [(0, total_frames)]

    ranges = []
    for start_tc, end_tc in scenes:
        s = max(0, int(start_tc.frame_num))
        e = min(total_frames, int(end_tc.frame_num))
        if e > s:
            ranges.append((s, e))

    if not ranges:
        return [(0, total_frames)]
    cleaned = []
    cursor = 0
    for s, e in ranges:
        if s > cursor:
            cleaned.append((cursor, s))
        cleaned.append((s, e))
        cursor = e
    if cursor < total_frames:
        cleaned.append((cursor, total_frames))

    log(f"Detected {len(cleaned)} scene shots: {cleaned}")
    return cleaned


def build_conditioning_maps_to_disk(frame_files, work_dir: Path):
    import cv2
    import numpy as np
    import torch
    from PIL import Image
    from transformers import pipeline as hf_pipeline

    depth_dir = work_dir / "depth_frames"
    canny_dir = work_dir / "canny_frames"
    depth_dir.mkdir(parents=True, exist_ok=True)
    canny_dir.mkdir(parents=True, exist_ok=True)

    log("Computing Depth-Anything-V2 + Soft Canny maps for EVERY frame (saved to disk to keep System RAM clean)...")
    depth_pipe = hf_pipeline(
        task="depth-estimation",
        model="depth-anything/Depth-Anything-V2-Small-hf",
        device=0,
        dtype=torch.float16,
    )

    batch_size = 16
    total = len(frame_files)
    for i in range(0, total, batch_size):
        batch_paths = frame_files[i : i + batch_size]
        batch_imgs = [Image.open(p).convert("RGB") for p in batch_paths]
        preds = depth_pipe(batch_imgs)
        for j, (img, pred) in enumerate(zip(batch_imgs, preds)):
            f_idx = i + j + 1
            d_img = pred["depth"].resize((GEN_W, GEN_H), Image.BICUBIC).convert("RGB")
            d_img.save(str(depth_dir / f"frame_{f_idx:05d}.png"))

            arr = np.array(img)
            gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
            blur = cv2.GaussianBlur(gray, (3, 3), 0)
            edges = cv2.Canny(blur, 95, 195)
            Image.fromarray(cv2.cvtColor(edges, cv2.COLOR_GRAY2RGB)).save(
                str(canny_dir / f"frame_{f_idx:05d}.png")
            )

        del batch_imgs, preds
        if (i // batch_size) % 5 == 0 or i + batch_size >= total:
            log(f"  Preprocessed {min(i + batch_size, total)}/{total} frames")

    del depth_pipe
    gc.collect()
    torch.cuda.empty_cache()
    return depth_dir, canny_dir


# ---------------------------------------------------------------------------
# 5. True Per-Frame Disney 3D Rendering (Sequential GPU Load + AnimateDiff v3 + FreeNoise)
# ---------------------------------------------------------------------------
def render_disney3d_frames(requests_mod, frame_files, depth_dir: Path, canny_dir: Path, scenes, work_dir: Path):
    import numpy as np
    import torch
    from PIL import Image
    from transformers import CLIPTextModel, CLIPTokenizer
    from diffusers import (
        AnimateDiffVideoToVideoControlNetPipeline,
        AutoencoderKL,
        ControlNetModel,
        DPMSolverMultistepScheduler,
        MotionAdapter,
        UNet2DConditionModel,
        UNetMotionModel,
    )

    stylized_dir = work_dir / "stylized_frames"
    stylized_dir.mkdir(parents=True, exist_ok=True)

    dtype = torch.float16
    base_model = "liamhvn/disney-pixar-cartoon-b"
    motion_id = "guoyww/animatediff-motion-adapter-v1-5-3"
    vae_id = "stabilityai/sd-vae-ft-mse"

    log("Step 5.1: Loading UNet2D + AnimateDiff v3 MotionAdapter and fusing into UNetMotionModel...")
    unet_2d = UNet2DConditionModel.from_pretrained(
        base_model,
        subfolder="unet",
        torch_dtype=dtype,
        use_safetensors=True,
        low_cpu_mem_usage=True,
    )
    motion_adapter = MotionAdapter.from_pretrained(
        motion_id,
        torch_dtype=dtype,
        use_safetensors=True,
        low_cpu_mem_usage=True,
    )
    unet = UNetMotionModel.from_unet2d(unet_2d, motion_adapter)
    del unet_2d
    gc.collect()
    unet = unet.to(device="cuda", dtype=dtype)
    motion_adapter = motion_adapter.to(device="cuda", dtype=dtype)
    gc.collect()
    torch.cuda.empty_cache()
    log(f"  UNetMotionModel on GPU ({torch.cuda.memory_allocated() / 1e9:.2f} GB VRAM)")

    log("Step 5.2: Loading VAE, CLIPTextModel, and Multi-ControlNet (Depth + Canny) sequentially to GPU...")
    vae = AutoencoderKL.from_pretrained(
        vae_id,
        torch_dtype=dtype,
        use_safetensors=True,
        low_cpu_mem_usage=True,
    ).to(device="cuda", dtype=dtype)
    gc.collect()

    text_encoder = CLIPTextModel.from_pretrained(
        base_model,
        subfolder="text_encoder",
        torch_dtype=dtype,
        use_safetensors=True,
        low_cpu_mem_usage=True,
    ).to(device="cuda", dtype=dtype)
    gc.collect()

    tokenizer = CLIPTokenizer.from_pretrained(base_model, subfolder="tokenizer")
    scheduler = DPMSolverMultistepScheduler.from_pretrained(
        base_model,
        subfolder="scheduler",
        use_karras_sigmas=True,
        algorithm_type="dpmsolver++",
    )

    cn_depth = ControlNetModel.from_pretrained(
        "lllyasviel/control_v11f1p_sd15_depth",
        torch_dtype=dtype,
        use_safetensors=True,
        low_cpu_mem_usage=True,
    ).to(device="cuda", dtype=dtype)
    gc.collect()

    cn_canny = ControlNetModel.from_pretrained(
        "lllyasviel/control_v11p_sd15_canny",
        torch_dtype=dtype,
        use_safetensors=True,
        low_cpu_mem_usage=True,
    ).to(device="cuda", dtype=dtype)
    gc.collect()
    torch.cuda.empty_cache()

    pipe = AnimateDiffVideoToVideoControlNetPipeline(
        vae=vae,
        text_encoder=text_encoder,
        tokenizer=tokenizer,
        unet=unet,
        motion_adapter=motion_adapter,
        controlnet=[cn_depth, cn_canny],
        scheduler=scheduler,
    ).to("cuda")

    pipe.vae.enable_slicing()
    pipe.vae.enable_tiling()

    # Native FreeNoise sliding-window 3D temporal attention (no buggy FreeNoiseSplitHook)
    pipe.enable_free_noise(context_length=16, context_stride=4)

    log(f"Pipeline ready on T4 GPU! Allocated VRAM: {torch.cuda.memory_allocated() / 1e9:.2f} GB")

    prompt = (
        "authentic walt disney animation studios 3d cgi movie still, disney pixar 3d animated character, "
        "expressive stylized large 3d cartoon eyes, soft subsurface scattering skin, smooth sculpted 3d hair, "
        "cinematic warm rim lighting, rich 3d movie shaders, clean vibrant pixar animation, masterpiece, best quality"
    )
    negative_prompt = (
        "photorealistic, live action, real photo, real human skin pores, realistic skin texture, "
        "blurry, smeared, warped, deformed face, extra limbs, double face, ghosting, flicker, "
        "artifacts, lowres, bad anatomy, 2d flat sketch, watermark, text, subtitles"
    )

    max_window = 16
    overlap = 4

    def load_triplet_slice(s_idx_0: int, e_idx_0: int):
        v_list, d_list, c_list = [], [], []
        for idx0 in range(s_idx_0, e_idx_0):
            f_num = idx0 + 1
            v_list.append(Image.open(frame_files[idx0]).convert("RGB"))
            d_list.append(Image.open(depth_dir / f"frame_{f_num:05d}.png").convert("RGB"))
            c_list.append(Image.open(canny_dir / f"frame_{f_num:05d}.png").convert("RGB"))
        return v_list, d_list, c_list

    def run_segment(seg_video, seg_depth, seg_canny, seed_val):
        orig_len = len(seg_video)
        # FreeNoise context_length=16 requires at least 16 frames
        if orig_len < 16:
            pad_n = 16 - orig_len
            seg_video = seg_video + [seg_video[-1]] * pad_n
            seg_depth = seg_depth + [seg_depth[-1]] * pad_n
            seg_canny = seg_canny + [seg_canny[-1]] * pad_n

        gen = torch.Generator(device="cuda").manual_seed(seed_val)
        with torch.inference_mode():
            res = pipe(
                video=seg_video,
                conditioning_frames=[seg_depth, seg_canny],
                prompt=prompt,
                negative_prompt=negative_prompt,
                width=GEN_W,
                height=GEN_H,
                num_inference_steps=16,
                guidance_scale=8.0,
                strength=0.72,
                controlnet_conditioning_scale=[0.60, 0.30],
                generator=gen,
                decode_chunk_size=4,
            ).frames[0]
        return res[:orig_len]

    rel_initial = get_release(requests_mod)
    for s_idx, (start_f, end_f) in enumerate(scenes):
        shot_len = end_f - start_f
        if download_existing_scene_checkpoint(requests_mod, rel_initial, s_idx, start_f, end_f, stylized_dir):
            continue
        log(f"Rendering Scene {s_idx + 1}/{len(scenes)}: frames [{start_f}..{end_f - 1}] ({shot_len} frames)")
        seed_val = 4200 + s_idx
        scene_out = [None] * shot_len

        if shot_len <= max_window:
            v_seg, d_seg, c_seg = load_triplet_slice(start_f, end_f)
            rendered = run_segment(v_seg, d_seg, c_seg, seed_val)
            for k, img in enumerate(rendered):
                scene_out[k] = img
            del v_seg, d_seg, c_seg, rendered
        else:
            pos = start_f
            while pos < end_f:
                w_end = min(pos + max_window, end_f)
                # Ensure tail window has at least 16 frames if shot_len >= 16
                if w_end - pos < 16 and end_f - start_f >= 16:
                    pos = max(start_f, end_f - 16)
                v_seg, d_seg, c_seg = load_triplet_slice(pos, w_end)
                rendered = run_segment(v_seg, d_seg, c_seg, seed_val)
                for k, img in enumerate(rendered):
                    rel_idx = (pos - start_f) + k
                    if scene_out[rel_idx] is None:
                        scene_out[rel_idx] = img
                    else:
                        alpha = 0.5 * (1.0 - math.cos(math.pi * (k + 1) / (overlap + 1)))
                        prev_arr = np.array(scene_out[rel_idx], dtype=np.float32)
                        cur_arr = np.array(img, dtype=np.float32)
                        blended = np.clip((1.0 - alpha) * prev_arr + alpha * cur_arr, 0, 255).astype(np.uint8)
                        scene_out[rel_idx] = Image.fromarray(blended)
                del v_seg, d_seg, c_seg, rendered
                if w_end >= end_f:
                    break
                pos = w_end - overlap

        for k, img in enumerate(scene_out):
            f_num = start_f + k + 1
            img.save(str(stylized_dir / f"frame_{f_num:05d}.png"))

        save_scene_checkpoint(requests_mod, s_idx, start_f, end_f, stylized_dir)
        log(f"  Completed & Checkpointed Scene {s_idx + 1}/{len(scenes)} (peak VRAM: {torch.cuda.max_memory_allocated() / 1e9:.2f} GB)")
        del scene_out
        gc.collect()
        torch.cuda.empty_cache()

    del pipe, unet, motion_adapter, vae, text_encoder, cn_depth, cn_canny
    gc.collect()
    torch.cuda.empty_cache()
    return stylized_dir


# ---------------------------------------------------------------------------
# 6. Neural 4x Upscaling to Crisp 1920x1080 (RealESRGAN_x4plus_anime_6B via spandrel)
# ---------------------------------------------------------------------------
def upscale_frames_to_1080p(stylized_dir: Path, total_frames: int, out_dir: Path):
    import cv2
    import numpy as np
    import torch
    from PIL import Image
    from spandrel import ModelLoader

    out_dir.mkdir(parents=True, exist_ok=True)
    weights_path = WORK_DIR / "RealESRGAN_x4plus_anime_6B.pth"
    if not weights_path.exists():
        url = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"
        log("Downloading RealESRGAN_x4plus_anime_6B weights...")
        urllib.request.urlretrieve(url, str(weights_path))

    log("Loading RealESRGAN_x4plus_anime_6B on CUDA (FP16)...")
    model_desc = ModelLoader().load_from_file(str(weights_path))
    sr_model = model_desc.model.eval().cuda().half()

    t0 = time.time()
    for idx in range(total_frames):
        pil_img = Image.open(stylized_dir / f"frame_{idx + 1:05d}.png").convert("RGB")
        rgb = np.array(pil_img, dtype=np.float32) / 255.0
        inp = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0).cuda().half()
        with torch.inference_mode():
            out = sr_model(inp).clamp(0.0, 1.0)
        out_np = (out.squeeze(0).permute(1, 2, 0).float().cpu().numpy() * 255.0).round().astype(np.uint8)
        bgr_1080 = cv2.resize(
            cv2.cvtColor(out_np, cv2.COLOR_RGB2BGR),
            (OUT_W, OUT_H),
            interpolation=cv2.INTER_AREA,
        )
        cv2.imwrite(str(out_dir / f"frame_{idx + 1:05d}.png"), bgr_1080)
        if (idx + 1) % 100 == 0 or idx + 1 == total_frames:
            log(f"  Upscaled {idx + 1}/{total_frames} frames to 1080p ({time.time() - t0:.1f}s)")

    del sr_model, model_desc
    gc.collect()
    torch.cuda.empty_cache()


# ---------------------------------------------------------------------------
# 7. Side-by-Side 1080p Visual QA Grid + Final 1080p Encode with Arabic Subs
# ---------------------------------------------------------------------------
def build_comparison_grid(src_files, up_dir: Path, grid_path: Path):
    from PIL import Image, ImageDraw

    total = len(src_files)
    indices = [int(total * f) for f in (0.08, 0.24, 0.42, 0.58, 0.76, 0.92)]
    cell_w, cell_h = 640, 360
    grid = Image.new("RGB", (cell_w * 2, cell_h * len(indices)), (15, 15, 18))
    draw = ImageDraw.Draw(grid)

    for row, idx in enumerate(indices):
        idx = min(max(idx, 0), total - 1)
        orig = Image.open(src_files[idx]).convert("RGB").resize((cell_w, cell_h), Image.LANCZOS)
        styl = Image.open(up_dir / f"frame_{idx + 1:05d}.png").convert("RGB").resize((cell_w, cell_h), Image.LANCZOS)
        grid.paste(orig, (0, row * cell_h))
        grid.paste(styl, (cell_w, row * cell_h))
        draw.rectangle([8, row * cell_h + 8, 175, row * cell_h + 34], fill=(0, 0, 0))
        draw.text((14, row * cell_h + 14), f"Original #{idx + 1}", fill=(255, 255, 255))
        draw.rectangle([cell_w + 8, row * cell_h + 8, cell_w + 230, row * cell_h + 34], fill=(0, 0, 0))
        draw.text((cell_w + 14, row * cell_h + 14), f"Disney 3D 1080p #{idx + 1}", fill=(120, 255, 180))

    grid.save(str(grid_path), optimize=True)
    log(f"Saved comparison grid: {grid_path}")


def shift_srt_for_clip(srt_path: Path, start_sec: float, duration_sec: float, out_srt: Path):
    def to_sec(t_str):
        h, m, s = t_str.replace(",", ".").split(":")
        return int(h) * 3600 + int(m) * 60 + float(s)

    def fmt_ts(sec):
        sec = max(0.0, sec)
        h = int(sec // 3600)
        m = int((sec % 3600) // 60)
        s = int(sec % 60)
        ms = int(round((sec - math.floor(sec)) * 1000))
        if ms >= 1000:
            ms = 999
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    raw = srt_path.read_text(encoding="utf-8", errors="ignore")
    blocks = re.split(r"\n\s*\n", raw.strip())
    kept = []
    idx = 1
    end_sec = start_sec + duration_sec
    for blk in blocks:
        lines = blk.strip().splitlines()
        if len(lines) < 2:
            continue
        ts_line = lines[1] if "-->" in lines[1] else lines[0]
        m = re.match(r"(\d+:\d+:\d+[,\.]\d+)\s*-->\s*(\d+:\d+:\d+[,\.]\d+)", ts_line)
        if not m:
            continue
        s0, s1 = to_sec(m.group(1)), to_sec(m.group(2))
        if s1 <= start_sec or s0 >= end_sec:
            continue
        text_lines = lines[2:] if "-->" in lines[1] else lines[1:]
        ns0 = max(0.0, s0 - start_sec)
        ns1 = min(duration_sec, s1 - start_sec)
        kept.append(f"{idx}\n{fmt_ts(ns0)} --> {fmt_ts(ns1)}\n" + "\n".join(text_lines))
        idx += 1

    out_srt.write_text("\n\n".join(kept) + "\n", encoding="utf-8")
    log(f"Prepared shifted Arabic subtitles: {len(kept)} entries")


def encode_final_video(up_dir: Path, src_clip: Path, clip_srt: Path, final_mp4: Path):
    escaped_srt = str(clip_srt).replace("\\", "/").replace(":", "\\:")
    vf = (
        f"subtitles='{escaped_srt}':force_style='FontName=Cairo,FontSize=24,"
        f"PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H64000000,"
        f"BorderStyle=1,Outline=2,Shadow=1,MarginV=28,Alignment=2'"
    )
    run_cmd([
        "ffmpeg", "-y",
        "-framerate", str(TARGET_FPS),
        "-i", str(up_dir / "frame_%05d.png"),
        "-i", str(src_clip),
        "-map", "0:v:0", "-map", "1:a:0?",
        "-vf", vf,
        "-c:v", "libx264", "-preset", "slow", "-crf", "16",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest",
        str(final_mp4),
    ])
    log(f"Encoded final 1080p video: {final_mp4} ({final_mp4.stat().st_size / 1e6:.2f} MB)")


def main():
    t_start = time.time()
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    ensure_dependencies()

    import requests

    raw_video, srt_path = download_clean_source_and_sub(requests, WORK_DIR)
    src_clip, frame_files = extract_clip_and_frames(raw_video, WORK_DIR)
    scenes = detect_scenes(src_clip, len(frame_files))

    depth_dir, canny_dir = build_conditioning_maps_to_disk(frame_files, WORK_DIR)
    stylized_dir = render_disney3d_frames(requests, frame_files, depth_dir, canny_dir, scenes, WORK_DIR)

    up_dir = WORK_DIR / "upscaled_1080p"
    upscale_frames_to_1080p(stylized_dir, len(frame_files), up_dir)

    grid_path = WORK_DIR / "disney3d_v2_test30s_comparison.png"
    build_comparison_grid(frame_files, up_dir, grid_path)

    clip_srt = WORK_DIR / "clip_30s_ar.srt"
    shift_srt_for_clip(srt_path, START_SEC, DURATION_SEC, clip_srt)

    final_mp4 = WORK_DIR / "disney3d_v2_test30s_1080p.mp4"
    encode_final_video(up_dir, src_clip, clip_srt, final_mp4)

    rel = get_release(requests)
    vid_url = upload_asset(requests, rel, final_mp4, content_type="video/mp4")
    grid_url = upload_asset(requests, rel, grid_path, content_type="image/png")

    summary = {
        "pipeline": "disney3d_v2.4_animatediff_freenoise_realesrgan_1080p",
        "start_sec": START_SEC,
        "duration_sec": DURATION_SEC,
        "fps": TARGET_FPS,
        "total_frames_rendered": len(frame_files),
        "scenes": len(scenes),
        "elapsed_sec": round(time.time() - t_start, 1),
        "video_url": vid_url,
        "comparison_grid_url": grid_url,
    }
    summary_path = WORK_DIR / "disney3d_v2_test30s_meta.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    upload_asset(requests, rel, summary_path, content_type="application/json")
    log(f"DONE in {summary['elapsed_sec']}s -> {json.dumps(summary)}")


if __name__ == "__main__":
    main()
