#!/usr/bin/env python3
"""Cinematic Anime & Disney Style Video-to-Video Transfer Pipeline for Google Colab (T4 GPU).

Downloads a famous fight scene from YouTube (Ip Man: Donnie Yen vs General Miura),
extracts raw frames, transforms them into both Anime and Disney/Pixar cinematic styles
with temporal consistency (AnimateDiff + ControlNet), creates a side-by-side comparison,
and uploads all resulting videos directly to GitHub (h776117073-eng/AI-Creative-Studio).
"""

import base64
import inspect
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

# Prevent Colab secret vault timeout on headless runs
os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")

REPO_OWNER = "h776117073-eng"
REPO_NAME = "AI-Creative-Studio"
OUTPUT_SUBDIR = "output/cinematic_fight_transfer"

YOUTUBE_URLS = [
    "https://www.youtube.com/watch?v=qqpew2sYqbA",  # Ip Man: Donnie Yen vs General Miura
    "https://www.youtube.com/watch?v=7QFdYbzj8cI",  # Ip Man: 10 Black Belts
    "https://www.youtube.com/watch?v=NOWtZQKtlpY",  # Ip Man 4: Donnie Yen vs Scott Adkins
]
START_TIME = "00:00:25"
DURATION_SECONDS = 4
TARGET_FPS = 12
OUTPUT_WIDTH = 512
CHUNK_SIZE = 16


def run_cmd(cmd, check=True):
    print(f"$ {' '.join(cmd)}", flush=True)
    return subprocess.run(cmd, check=check)


def install_dependencies():
    print("📦 Installing dependencies...", flush=True)
    pkgs = [
        "diffusers>=0.30.0",
        "transformers>=4.41.0",
        "accelerate>=0.30.0",
        "controlnet_aux>=0.0.9",
        "safetensors",
        "einops",
        "omegaconf",
        "yt-dlp",
        "opencv-python-headless",
        "imageio",
        "imageio-ffmpeg",
    ]
    run_cmd([sys.executable, "-m", "pip", "install", "-q", "--upgrade", *pkgs])


def download_fight_scene(work_dir):
    video_path = work_dir / "source_fight.mp4"
    for url in YOUTUBE_URLS:
        print(f"⬇️ Trying YouTube URL: {url}", flush=True)
        for extra_args in [
            ["--extractor-args", "youtube:player_client=android,web"],
            ["--extractor-args", "youtube:player_client=tv,ios"],
            [],
        ]:
            cmd = [
                "yt-dlp",
                "-f",
                "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best",
                "--merge-output-format",
                "mp4",
                "--no-playlist",
                "--force-overwrites",
                *extra_args,
                "-o",
                str(video_path),
                url,
            ]
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode == 0 and video_path.exists() and video_path.stat().st_size > 100_000:
                print(f"✅ Downloaded {video_path.stat().st_size / (1024*1024):.2f} MB from {url}", flush=True)
                return video_path, url
            print(f"⚠️ Attempt failed ({res.returncode}): {res.stderr[-300:] if res.stderr else ''}", flush=True)
    raise RuntimeError("Failed to download fight scene from all YouTube candidate URLs.")


def extract_clip_and_frames(source_video, work_dir):
    raw_dir = work_dir / "raw_frames"
    raw_dir.mkdir(parents=True, exist_ok=True)
    audio_path = work_dir / "clip_audio.m4a"
    orig_clip = work_dir / "IpMan_Original_Clip.mp4"

    run_cmd([
        "ffmpeg", "-y", "-ss", START_TIME, "-t", str(DURATION_SECONDS),
        "-i", str(source_video),
        "-vf", f"fps={TARGET_FPS},scale={OUTPUT_WIDTH}:-2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
        str(orig_clip), "-loglevel", "error",
    ])

    run_cmd([
        "ffmpeg", "-y", "-ss", START_TIME, "-t", str(DURATION_SECONDS),
        "-i", str(source_video), "-vn", "-c:a", "aac",
        str(audio_path), "-loglevel", "error",
    ])

    run_cmd([
        "ffmpeg", "-y", "-ss", START_TIME, "-t", str(DURATION_SECONDS),
        "-i", str(source_video),
        "-vf", f"fps={TARGET_FPS},scale={OUTPUT_WIDTH}:-2",
        str(raw_dir / "frame_%04d.png"), "-loglevel", "error",
    ])

    frames = sorted(raw_dir.glob("frame_*.png"))
    if not frames:
        raise RuntimeError("No frames extracted from video.")
    print(f"✅ Extracted {len(frames)} raw frames at {TARGET_FPS} FPS.", flush=True)
    return frames, audio_path, orig_clip


def load_first_available_pipe(pipe_cls, model_candidates, **kwargs):
    last_err = None
    for model_id in model_candidates:
        try:
            print(f"⏳ Loading base model: {model_id}", flush=True)
            pipe = pipe_cls.from_pretrained(model_id, **kwargs)
            print(f"✅ Loaded base model: {model_id}", flush=True)
            return pipe, model_id
        except Exception as exc:
            print(f"⚠️ Could not load {model_id}: {exc}", flush=True)
            last_err = exc
    raise RuntimeError(f"All model candidates failed: {last_err}")


def enable_memory_optimizations(pipe, device):
    if device != "cuda":
        return pipe.to(device)
    if hasattr(pipe, "enable_vae_slicing"):
        pipe.enable_vae_slicing()
    elif hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_slicing"):
        pipe.vae.enable_slicing()
    if hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_tiling"):
        try:
            pipe.vae.enable_tiling()
        except Exception:
            pass
    try:
        pipe.enable_model_cpu_offload()
    except Exception:
        pipe = pipe.to(device)
    return pipe


def render_style(style_name, raw_images, canny_frames, pose_frames, audio_path, work_dir, device):
    import torch
    from diffusers import ControlNetModel, EulerAncestralDiscreteScheduler, MotionAdapter

    dtype = torch.float16 if device == "cuda" else torch.float32

    if style_name == "anime":
        model_candidates = [
            "Lykon/dreamshaper-8",
            "Linaqruf/anything-v3.0",
            "runwayml/stable-diffusion-v1-5",
        ]
        prompt = (
            "masterpiece, best quality, anime key visual, ufotable cinematic martial arts fight scene, "
            "sharp cel shading, crisp black ink lineart, dramatic action lighting, expressive anime eyes, "
            "dynamic motion, studio anime film still"
        )
        negative_prompt = (
            "lowres, bad anatomy, bad hands, blurry, flickering, distorted face, extra limbs, "
            "photorealistic, photograph, 3d render, watermark, text, ugly"
        )
        strength = 0.62
    else:
        model_candidates = [
            "nitrosocke/mo-di-diffusion",
            "Lykon/dreamshaper-8",
            "runwayml/stable-diffusion-v1-5",
        ]
        prompt = (
            "modern disney style, masterpiece, best quality, Disney Pixar 3D animated movie still, "
            "expressive stylized character face, soft volumetric cinematic lighting, subsurface scattering, "
            "detailed cloth texture, smooth 3D animation, kung fu fight scene"
        )
        negative_prompt = (
            "lowres, bad anatomy, bad hands, blurry, flickering, 2d flat sketch, harsh black outlines, "
            "photorealistic, watermark, text, deformed, ugly"
        )
        strength = 0.62

    pipe = None
    mode_used = "unknown"
    used_model = ""

    try:
        from diffusers import AnimateDiffVideoToVideoControlNetPipeline

        print(f"🎬 Initializing AnimateDiff + ControlNet V2V for [{style_name}]...", flush=True)
        adapter = MotionAdapter.from_pretrained("guoyww/animatediff-motion-adapter-v1-5-2", torch_dtype=dtype)
        cn_canny = ControlNetModel.from_pretrained("lllyasviel/control_v11p_sd15_canny", torch_dtype=dtype)
        cn_pose = ControlNetModel.from_pretrained("lllyasviel/control_v11p_sd15_openpose", torch_dtype=dtype)

        pipe, used_model = load_first_available_pipe(
            AnimateDiffVideoToVideoControlNetPipeline,
            model_candidates,
            motion_adapter=adapter,
            controlnet=[cn_canny, cn_pose],
            torch_dtype=dtype,
        )
        mode_used = "AnimateDiffVideoToVideoControlNetPipeline"
    except Exception as exc:
        print(f"⚠️ AnimateDiff+ControlNet V2V unavailable ({exc}), falling back to AnimateDiff V2V...", flush=True)
        try:
            from diffusers import AnimateDiffVideoToVideoPipeline

            adapter = MotionAdapter.from_pretrained("guoyww/animatediff-motion-adapter-v1-5-2", torch_dtype=dtype)
            pipe, used_model = load_first_available_pipe(
                AnimateDiffVideoToVideoPipeline,
                model_candidates,
                motion_adapter=adapter,
                torch_dtype=dtype,
            )
            mode_used = "AnimateDiffVideoToVideoPipeline"
        except Exception as exc2:
            print(f"⚠️ AnimateDiff V2V unavailable ({exc2}), falling back to ControlNet Img2Img...", flush=True)
            from diffusers import StableDiffusionControlNetImg2ImgPipeline

            cn_canny = ControlNetModel.from_pretrained("lllyasviel/control_v11p_sd15_canny", torch_dtype=dtype)
            pipe, used_model = load_first_available_pipe(
                StableDiffusionControlNetImg2ImgPipeline,
                model_candidates,
                controlnet=cn_canny,
                torch_dtype=dtype,
                safety_checker=None,
            )
            mode_used = "StableDiffusionControlNetImg2ImgPipeline"

    pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(
        pipe.scheduler.config, beta_schedule="linear", steps_offset=1
    )
    pipe = enable_memory_optimizations(pipe, device)

    out_frames_dir = work_dir / f"out_frames_{style_name}"
    out_frames_dir.mkdir(parents=True, exist_ok=True)
    all_output_frames = []
    call_params = set(inspect.signature(pipe.__call__).parameters.keys())
    print(f"🔧 Pipeline: {mode_used} | Model: {used_model} | Call params: {sorted(call_params)}", flush=True)

    if mode_used in ("AnimateDiffVideoToVideoControlNetPipeline", "AnimateDiffVideoToVideoPipeline"):
        for start_idx in range(0, len(raw_images), CHUNK_SIZE):
            end_idx = min(start_idx + CHUNK_SIZE, len(raw_images))
            chunk_vid = list(raw_images[start_idx:end_idx])
            chunk_canny = list(canny_frames[start_idx:end_idx])
            chunk_pose = list(pose_frames[start_idx:end_idx])
            orig_len = len(chunk_vid)
            while len(chunk_vid) < 8:
                chunk_vid.append(chunk_vid[-1])
                chunk_canny.append(chunk_canny[-1])
                chunk_pose.append(chunk_pose[-1])

            generator = torch.Generator(device="cpu").manual_seed(42)
            kwargs = {
                "video": chunk_vid,
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "strength": strength,
                "num_inference_steps": 18,
                "guidance_scale": 7.5,
                "generator": generator,
            }
            if mode_used == "AnimateDiffVideoToVideoControlNetPipeline":
                if "conditioning_frames" in call_params:
                    kwargs["conditioning_frames"] = [chunk_canny, chunk_pose]
                elif "control_frames" in call_params:
                    kwargs["control_frames"] = [chunk_canny, chunk_pose]
                if "controlnet_conditioning_scale" in call_params:
                    kwargs["controlnet_conditioning_scale"] = [0.7, 0.8]

            result = pipe(**kwargs).frames[0]
            all_output_frames.extend(result[:orig_len])
            print(f"   ✔️ [{style_name}] Processed frames {start_idx + 1}..{end_idx}/{len(raw_images)}", flush=True)
    else:
        for idx, (img, cimg) in enumerate(zip(raw_images, canny_frames)):
            generator = torch.Generator(device="cpu").manual_seed(42)
            out = pipe(
                prompt=prompt,
                negative_prompt=negative_prompt,
                image=img,
                control_image=cimg,
                controlnet_conditioning_scale=0.8,
                strength=strength,
                num_inference_steps=16,
                guidance_scale=7.5,
                generator=generator,
            ).images[0]
            all_output_frames.append(out)
            if (idx + 1) % 8 == 0 or idx + 1 == len(raw_images):
                print(f"   ✔️ [{style_name}] Processed frame {idx + 1}/{len(raw_images)}", flush=True)

    for idx, frame in enumerate(all_output_frames):
        frame.save(out_frames_dir / f"out_{idx:04d}.png")

    out_mp4 = work_dir / f"IpMan_Fight_{style_name.capitalize()}_Cinematic.mp4"
    run_cmd([
        "ffmpeg", "-y", "-framerate", str(TARGET_FPS),
        "-i", str(out_frames_dir / "out_%04d.png"),
        "-i", str(audio_path),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
        "-c:a", "aac", "-shortest",
        str(out_mp4), "-loglevel", "error",
    ])
    print(f"🎉 Rendered {out_mp4.name} ({out_mp4.stat().st_size / 1024:.1f} KB)", flush=True)

    del pipe
    if device == "cuda":
        torch.cuda.empty_cache()

    return out_mp4, f"{mode_used} ({used_model})"


def create_comparison_video(orig_mp4, anime_mp4, disney_mp4, work_dir):
    comp_mp4 = work_dir / "IpMan_Fight_Comparison_Original_Anime_Disney.mp4"
    run_cmd([
        "ffmpeg", "-y",
        "-i", str(orig_mp4),
        "-i", str(anime_mp4),
        "-i", str(disney_mp4),
        "-filter_complex",
        "[0:v]scale=384:-2,setsar=1[v0];"
        "[1:v]scale=384:-2,setsar=1[v1];"
        "[2:v]scale=384:-2,setsar=1[v2];"
        "[v0][v1][v2]hstack=inputs=3[v]",
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "21",
        "-c:a", "aac", "-shortest",
        str(comp_mp4), "-loglevel", "error",
    ])
    print(f"🎬 Created comparison video: {comp_mp4.name} ({comp_mp4.stat().st_size / 1024:.1f} KB)", flush=True)
    return comp_mp4


def github_upload_file(local_path, repo_path, commit_msg):
    token = os.environ.get("GH_TOKEN", "").strip()
    if not token:
        raise RuntimeError("GH_TOKEN is not set in environment; cannot upload to GitHub.")

    api_url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/contents/{repo_path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "AI-Creative-Studio-Colab-Pipeline",
    }

    sha = None
    req_get = urllib.request.Request(api_url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req_get, timeout=30) as resp:
            existing = json.loads(resp.read().decode("utf-8"))
            sha = existing.get("sha")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise

    b64_content = base64.b64encode(local_path.read_bytes()).decode("ascii")
    payload = {
        "message": commit_msg,
        "content": b64_content,
        "branch": "main",
    }
    if sha:
        payload["sha"] = sha

    data = json.dumps(payload).encode("utf-8")
    req_put = urllib.request.Request(api_url, data=data, headers={**headers, "Content-Type": "application/json"}, method="PUT")
    with urllib.request.urlopen(req_put, timeout=120) as resp:
        res_json = json.loads(resp.read().decode("utf-8"))
        html_url = res_json.get("content", {}).get("html_url", api_url)
        print(f"☁️ Uploaded to GitHub: {html_url}", flush=True)
        return html_url


def main():
    t0 = time.time()
    install_dependencies()

    import cv2
    import numpy as np
    import torch
    from controlnet_aux import OpenposeDetector
    from PIL import Image

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"🖥️ Device: {device} ({torch.cuda.get_device_name(0) if device == 'cuda' else 'CPU'})", flush=True)

    work_dir = pathlib.Path("/content/cinematic_fight_work")
    work_dir.mkdir(parents=True, exist_ok=True)

    source_video, used_url = download_fight_scene(work_dir)
    frame_paths, audio_path, orig_clip = extract_clip_and_frames(source_video, work_dir)

    raw_images = [Image.open(p).convert("RGB") for p in frame_paths]
    w, h = raw_images[0].size
    w, h = (w // 8) * 8, (h // 8) * 8
    raw_images = [img.resize((w, h)) for img in raw_images]

    print(f"🔍 Extracting Canny edges & OpenPose skeletons for {len(raw_images)} frames ({w}x{h})...", flush=True)
    canny_frames = []
    for img in raw_images:
        arr = np.array(img)
        edges = cv2.Canny(arr, 100, 200)
        edges_rgb = np.stack([edges, edges, edges], axis=-1)
        canny_frames.append(Image.fromarray(edges_rgb))

    pose_detector = OpenposeDetector.from_pretrained("lllyasviel/Annotators")
    if device == "cuda":
        pose_detector = pose_detector.to(device)
    pose_frames = [pose_detector(img).resize((w, h)) for img in raw_images]
    del pose_detector
    if device == "cuda":
        torch.cuda.empty_cache()

    anime_mp4, anime_engine = render_style("anime", raw_images, canny_frames, pose_frames, audio_path, work_dir, device)
    disney_mp4, disney_engine = render_style("disney", raw_images, canny_frames, pose_frames, audio_path, work_dir, device)
    comp_mp4 = create_comparison_video(orig_clip, anime_mp4, disney_mp4, work_dir)

    uploaded = {}
    for local_file in [orig_clip, anime_mp4, disney_mp4, comp_mp4]:
        repo_path = f"{OUTPUT_SUBDIR}/{local_file.name}"
        uploaded[local_file.name] = github_upload_file(
            local_file,
            repo_path,
            f"feat(video): add {local_file.name} from Colab cinematic fight style transfer",
        )

    summary = {
        "status": "success",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "elapsed_seconds": round(time.time() - t0, 1),
        "device": torch.cuda.get_device_name(0) if device == "cuda" else "CPU",
        "source_youtube_url": used_url,
        "frames_processed": len(raw_images),
        "fps": TARGET_FPS,
        "resolution": f"{w}x{h}",
        "anime_engine": anime_engine,
        "disney_engine": disney_engine,
        "uploaded_files": uploaded,
    }
    summary_path = work_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    github_upload_file(
        summary_path,
        f"{OUTPUT_SUBDIR}/summary.json",
        "docs(video): add cinematic fight style transfer run summary",
    )

    print("\n✅ PIPELINE COMPLETED SUCCESSFULLY!", flush=True)
    print(json.dumps(summary, indent=2, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
