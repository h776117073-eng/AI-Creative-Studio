import os
import sys
import subprocess
import glob
import shutil
import time
import json
import urllib.request
import urllib.error

# ==========================================
# 1. إعدادات الفيديو ومسار المستودع المربوط
# ==========================================
VIDEO_URL = "https://youtube.com/shorts/5OAgixt3e4I"
GITHUB_USER = "h776117073-eng"
GITHUB_REPO = "AI-Creative-Studio"
OUTPUT_SUBDIR = "outputs/disney_parkour_5OAgixt3e4I"

GH_TOKEN = os.environ.get("GH_TOKEN", "").strip()
REPO_HTTPS_URL = f"https://github.com/{GITHUB_USER}/{GITHUB_REPO}.git"
AUTH_REPO_URL = (
    f"https://x-access-token:{GH_TOKEN}@github.com/{GITHUB_USER}/{GITHUB_REPO}.git"
    if GH_TOKEN
    else REPO_HTTPS_URL
)

possible_paths = [
    f"/content/{GITHUB_REPO}",
    f"/content/drive/MyDrive/{GITHUB_REPO}",
    "/content/repo",
]
REPO_DIR = next((p for p in possible_paths if os.path.exists(os.path.join(p, ".git"))), None)

if REPO_DIR is None:
    REPO_DIR = f"/content/{GITHUB_REPO}"
    print(f"📥 جاري استنساخ المستودع إلى {REPO_DIR}...", flush=True)
    subprocess.run(["git", "clone", AUTH_REPO_URL, REPO_DIR], check=True)
else:
    print(f"✅ تم العثور على المستودع المربوط في: {REPO_DIR}", flush=True)
    if GH_TOKEN:
        subprocess.run(["git", "-C", REPO_DIR, "remote", "set-url", "origin", AUTH_REPO_URL], check=False)

subprocess.run(["git", "-C", REPO_DIR, "config", "user.email", "colab-bot@users.noreply.github.com"], check=False)
subprocess.run(["git", "-C", REPO_DIR, "config", "user.name", "Colab Render Bot"], check=False)

WORK_DIR = "/content/disney_pipeline"
DEST_DIR = os.path.join(REPO_DIR, OUTPUT_SUBDIR)
os.makedirs(WORK_DIR, exist_ok=True)
os.makedirs(DEST_DIR, exist_ok=True)


def push_progress_to_github(file_path, commit_msg):
    """نسخ الملف الناتج ورفعه مباشرة عبر اتصال Git المربوط"""
    shutil.copy(file_path, DEST_DIR)
    subprocess.run(["git", "-C", REPO_DIR, "pull", "--rebase"], check=False)
    subprocess.run(["git", "-C", REPO_DIR, "add", OUTPUT_SUBDIR], check=True)
    status = subprocess.run(["git", "-C", REPO_DIR, "status", "--porcelain"], capture_output=True, text=True)
    if status.stdout.strip():
        subprocess.run(["git", "-C", REPO_DIR, "commit", "-m", commit_msg], check=True)
        push_res = subprocess.run(["git", "-C", REPO_DIR, "push"], capture_output=True, text=True)
        if push_res.returncode != 0:
            subprocess.run(["git", "-C", REPO_DIR, "pull", "--rebase"], check=False)
            subprocess.run(["git", "-C", REPO_DIR, "push"], check=True)
        print(f"✅ تم حفظ التقدم ورفعه إلى GitHub: {os.path.basename(file_path)}", flush=True)


# ==========================================
# 2. تحميل الفيديو وتقسيمه إلى مقاطع متداخلة (24fps)
# ==========================================
RAW_VIDEO = f"{WORK_DIR}/raw_video.mp4"
CLEAN_VIDEO = f"{WORK_DIR}/clean_24fps.mp4"
CHUNKS_DIR = f"{WORK_DIR}/chunks"
os.makedirs(CHUNKS_DIR, exist_ok=True)

CACHED_RAW = os.path.join(DEST_DIR, "raw_video.mp4")
if os.path.exists(CACHED_RAW) and os.path.getsize(CACHED_RAW) > 10000:
    print("♻️ تم العثور على الفيديو الأصلي محفوظاً مسبقاً في GitHub، جاري استخدامه...", flush=True)
    shutil.copy(CACHED_RAW, RAW_VIDEO)
else:
    print("🎬 جاري تحميل الفيديو الأصلي بأعلى جودة...", flush=True)
    subprocess.run([sys.executable, "-m", "pip", "install", "-U", "yt-dlp"], check=True)

    yt_attempts = [
        ["yt-dlp", "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best", "--merge-output-format", "mp4", "-o", RAW_VIDEO, VIDEO_URL],
        ["yt-dlp", "--extractor-args", "youtube:player_client=web_creator,tv_embedded", "-f", "best", "--merge-output-format", "mp4", "-o", RAW_VIDEO, VIDEO_URL],
        ["yt-dlp", "--extractor-args", "youtube:player_client=android,ios", "-f", "best", "--merge-output-format", "mp4", "-o", RAW_VIDEO, VIDEO_URL],
    ]
    for cmd in yt_attempts:
        if os.path.exists(RAW_VIDEO) and os.path.getsize(RAW_VIDEO) > 10000:
            break
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"⚠️ محاولة yt-dlp فشلت: {res.stderr[-300:]}", flush=True)

    if not os.path.exists(RAW_VIDEO) or os.path.getsize(RAW_VIDEO) < 10000:
        raise RuntimeError("فشل تحميل الفيديو الأصلي من يوتيوب على هذا الخادم.")

    if os.path.getsize(RAW_VIDEO) < 45 * 1024 * 1024:
        push_progress_to_github(RAW_VIDEO, "Cache raw source video for 5OAgixt3e4I")

subprocess.run(
    [
        "ffmpeg", "-y", "-i", RAW_VIDEO,
        "-vf", "scale=576:1024:force_original_aspect_ratio=increase,crop=576:1024,fps=24",
        "-c:v", "libx264", "-crf", "16", "-an", CLEAN_VIDEO,
    ],
    check=True,
)

duration_cmd = subprocess.check_output(
    [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", CLEAN_VIDEO,
    ]
).decode().strip()
total_duration = float(duration_cmd)

chunk_len = 4.0
overlap = 0.33  # ~8 frames at 24fps
start = 0.0
idx = 0
chunk_files = []

while start < total_duration:
    chunk_path = f"{CHUNKS_DIR}/chunk_{idx:03d}.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-ss", str(start), "-i", CLEAN_VIDEO,
            "-t", str(chunk_len), "-c:v", "libx264", "-crf", "16", chunk_path,
            "-loglevel", "error",
        ],
        check=True,
    )
    chunk_files.append(chunk_path)
    start += (chunk_len - overlap)
    idx += 1

print(f"✂️ تم تقسيم الفيديو إلى {len(chunk_files)} مقاطع جاهزة للمعالجة.", flush=True)

# ==========================================
# 3. تثبيت ComfyUI والعقد والموديلات الاحترافية
# ==========================================
print("⚙️ جاري تثبيت ComfyUI والإضافات (AnimateDiff + Advanced ControlNet + VHS)...", flush=True)
COMFY_DIR = "/content/ComfyUI"
if not os.path.exists(COMFY_DIR):
    subprocess.run(["git", "clone", "https://github.com/comfyanonymous/ComfyUI.git", COMFY_DIR], check=True)
    subprocess.run([sys.executable, "-m", "pip", "install", "-r", f"{COMFY_DIR}/requirements.txt"], check=True)

COMFY_INPUT = f"{COMFY_DIR}/input"
os.makedirs(COMFY_INPUT, exist_ok=True)
for c_path in chunk_files:
    shutil.copy(c_path, os.path.join(COMFY_INPUT, os.path.basename(c_path)))

CUSTOM_NODES = f"{COMFY_DIR}/custom_nodes"
nodes = [
    "https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved.git",
    "https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet.git",
    "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git",
    "https://github.com/Fannovel16/comfyui_controlnet_aux.git",
]
for repo in nodes:
    name = repo.split("/")[-1].replace(".git", "")
    dest = f"{CUSTOM_NODES}/{name}"
    if not os.path.exists(dest):
        subprocess.run(["git", "clone", repo, dest], check=True)
        if os.path.exists(f"{dest}/requirements.txt"):
            subprocess.run([sys.executable, "-m", "pip", "install", "-r", f"{dest}/requirements.txt"], check=True)

subprocess.run([sys.executable, "-m", "pip", "install", "aria2"], check=True)


def download_model(url, folder, filename, min_bytes=10_000_000):
    os.makedirs(folder, exist_ok=True)
    filepath = os.path.join(folder, filename)
    if os.path.exists(filepath) and os.path.getsize(filepath) >= min_bytes:
        return True
    if os.path.exists(filepath):
        os.remove(filepath)
    print(f"⬇️ تحميل {filename}...", flush=True)
    subprocess.run(
        ["aria2c", "--console-log-level=error", "-c", "-x", "16", "-s", "16", "-k", "1M", url, "-d", folder, "-o", filename],
        check=False,
    )
    return os.path.exists(filepath) and os.path.getsize(filepath) >= min_bytes


# 1. نموذج Disney Pixar Cartoon 3D
ckpt_urls = [
    "https://huggingface.co/casque/disneyPixarCartoon_v10/resolve/main/disneyPixarCartoon_v10.safetensors",
    "https://huggingface.co/ckpt/disney-pixar-cartoon-type-a/resolve/main/disneyPixarCartoon_v10.safetensors",
    "https://huggingface.co/HAttORi/Disney-Pixar-Cartoon-Type-A/resolve/main/disneyPixarCartoon_v10.safetensors",
]
ckpt_ok = False
for u in ckpt_urls:
    if download_model(u, f"{COMFY_DIR}/models/checkpoints", "disney_pixar_3d.safetensors", min_bytes=500_000_000):
        ckpt_ok = True
        break
if not ckpt_ok:
    raise RuntimeError("فشل تحميل نموذج disney_pixar_3d.safetensors من جميع المرايا.")

# 2. وحدة الحركة AnimateDiff v3
if not download_model(
    "https://huggingface.co/guoyww/animatediff/resolve/main/v3_sd15_mm.ckpt",
    f"{COMFY_DIR}/custom_nodes/ComfyUI-AnimateDiff-Evolved/models",
    "v3_sd15_mm.ckpt",
    min_bytes=500_000_000,
):
    raise RuntimeError("فشل تحميل v3_sd15_mm.ckpt")

# 3. وحدة ControlNet Depth للحفاظ على هندسة المشهد والحركة
if not download_model(
    "https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11f1p_sd15_depth.pth",
    f"{COMFY_DIR}/models/controlnet",
    "control_v11f1p_sd15_depth.pth",
    min_bytes=500_000_000,
):
    raise RuntimeError("فشل تحميل control_v11f1p_sd15_depth.pth")

# 4. VAE لتحسين الألوان والإضاءة
if not download_model(
    "https://huggingface.co/stabilityai/sd-vae-ft-mse-original/resolve/main/vae-ft-mse-840000-ema-pruned.safetensors",
    f"{COMFY_DIR}/models/vae",
    "vae-ft-mse-840000-ema-pruned.safetensors",
    min_bytes=100_000_000,
):
    raise RuntimeError("فشل تحميل vae-ft-mse-840000-ema-pruned.safetensors")

# ==========================================
# 4. تشغيل خادم ComfyUI في الخلفية وتجهيز مسار العمل (Workflow)
# ==========================================
comfy_log = open(f"{WORK_DIR}/comfyui.log", "w")
server_proc = subprocess.Popen(
    [sys.executable, "main.py", "--listen", "127.0.0.1", "--port", "8188", "--fp16-vae"],
    cwd=COMFY_DIR,
    stdout=comfy_log,
    stderr=comfy_log,
)

print("⏳ انتظار جاهزية خادم ComfyUI...", flush=True)
ready = False
for _ in range(90):
    if server_proc.poll() is not None:
        comfy_log.flush()
        raise RuntimeError("ComfyUI server exited prematurely:\n" + open(f"{WORK_DIR}/comfyui.log").read()[-3000:])
    try:
        urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=2)
        print("🟢 خادم ComfyUI يعمل الآن!", flush=True)
        ready = True
        break
    except Exception:
        time.sleep(2)

if not ready:
    raise RuntimeError("ComfyUI server failed to become ready in time.")

obj_info = json.loads(urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=15).read().decode("utf-8"))
print(f"ℹ️ عدد العقد المحملة في ComfyUI: {len(obj_info)}", flush=True)


def sanitize_workflow(wf):
    """مواءمة حقول العقد مع تعريفات /object_info الفعلية في ComfyUI"""
    depth_node = wf["4"]["class_type"]
    if depth_node not in obj_info:
        for alt in ["DepthAnythingPreprocessor", "MiDaS-DepthMapPreprocessor", "Zoe-DepthMapPreprocessor"]:
            if alt in obj_info:
                print(f"🔄 استبدال {depth_node} بـ {alt}", flush=True)
                wf["4"]["class_type"] = alt
                break

    for node_id, node in wf.items():
        ct = node["class_type"]
        if ct not in obj_info:
            print(f"⚠️ العقدة {ct} غير موجودة في object_info!", flush=True)
            continue
        spec = obj_info[ct].get("input", {})
        allowed = {}
        allowed.update(spec.get("required", {}))
        allowed.update(spec.get("optional", {}))
        filtered = {}
        for k, v in node["inputs"].items():
            if k in allowed:
                filtered[k] = v
            else:
                print(f"ℹ️ إزالة الحقل غير المدعوم {ct}.{k}", flush=True)
        for req_k, req_spec in spec.get("required", {}).items():
            if req_k not in filtered and isinstance(req_spec, list) and len(req_spec) > 1 and isinstance(req_spec[1], dict):
                if "default" in req_spec[1]:
                    filtered[req_k] = req_spec[1]["default"]
            elif req_k not in filtered and isinstance(req_spec, list) and isinstance(req_spec[0], list) and req_spec[0]:
                filtered[req_k] = req_spec[0][0]
        node["inputs"] = filtered
    return wf


def build_workflow(input_video_name, output_prefix):
    cn_loader = "ControlNetLoaderAdvanced" if "ControlNetLoaderAdvanced" in obj_info else "ControlNetLoader"
    cn_apply = "ACN_AdvancedControlNetApply" if "ACN_AdvancedControlNetApply" in obj_info else "ControlNetApplyAdvanced"
    wf = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "disney_pixar_3d.safetensors"}},
        "2": {"class_type": "VAELoader", "inputs": {"vae_name": "vae-ft-mse-840000-ema-pruned.safetensors"}},
        "3": {
            "class_type": "VHS_LoadVideo",
            "inputs": {
                "video": input_video_name, "force_rate": 24,
                "custom_width": 576, "custom_height": 1024, "frame_load_cap": 0,
                "skip_first_frames": 0, "select_every_nth": 1,
            },
        },
        "4": {
            "class_type": "DepthAnythingV2Preprocessor",
            "inputs": {"ckpt_name": "depth_anything_v2_vitl.pth", "resolution": 576, "image": ["3", 0]},
        },
        "5": {"class_type": cn_loader, "inputs": {"control_net_name": "control_v11f1p_sd15_depth.pth"}},
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "disney pixar 3d animation style, cinematic lighting, vibrant colors, smooth subsurface scattering, highly detailed 3d render, unreal engine 5, parkour action POV, sharp focus, masterpiece, 8k",
                "clip": ["1", 1],
            },
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "photorealistic, real life, live action, grainy, blurry, motion blur, distorted hands, extra fingers, deformed, low quality, watermark, text, ugly, flicker",
                "clip": ["1", 1],
            },
        },
        "8": {
            "class_type": cn_apply,
            "inputs": {
                "strength": 0.85, "start_percent": 0.0, "end_percent": 0.95,
                "positive": ["6", 0], "negative": ["7", 0], "control_net": ["5", 0], "image": ["4", 0],
            },
        },
        "9": {
            "class_type": "ADE_StandardUniformContextOptions",
            "inputs": {
                "context_length": 16, "context_stride": 1, "context_overlap": 4,
                "fuse_method": "pyramid", "use_on_equal_length": False,
            },
        },
        "10": {"class_type": "ADE_LoadAnimateDiffModel", "inputs": {"model_name": "v3_sd15_mm.ckpt"}},
        "11": {"class_type": "ADE_ApplyAnimateDiffModelSimple", "inputs": {"motion_model": ["10", 0]}},
        "12": {
            "class_type": "ADE_UseEvolvedSampling",
            "inputs": {
                "beta_schedule": "autoselect", "model": ["1", 0], "m_models": ["11", 0], "context_options": ["9", 0],
            },
        },
        "13": {"class_type": "VAEEncode", "inputs": {"pixels": ["3", 0], "vae": ["2", 0]}},
        "14": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 424242, "steps": 26, "cfg": 7.5, "sampler_name": "dpmpp_2m_sde",
                "scheduler": "karras", "denoise": 0.68,
                "model": ["12", 0], "positive": ["8", 0], "negative": ["8", 1], "latent_image": ["13", 0],
            },
        },
        "15": {"class_type": "VAEDecode", "inputs": {"samples": ["14", 0], "vae": ["2", 0]}},
        "16": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "frame_rate": 24, "loop_count": 0, "filename_prefix": output_prefix,
                "format": "video/h264-mp4", "pingpong": False,
                "save_output": True, "images": ["15", 0],
            },
        },
    }
    return sanitize_workflow(wf)


# ==========================================
# 5. تنفيذ التحويل لكل مقطع ورفعه فوراً إلى GitHub
# ==========================================
rendered_chunks = []
COMFY_OUT = f"{COMFY_DIR}/output"

for i, chunk_path in enumerate(chunk_files):
    chunk_name = f"disney_chunk_{i:03d}"
    existing_on_github = glob.glob(f"{DEST_DIR}/{chunk_name}*.mp4")

    if existing_on_github:
        print(f"⏭️ المقطع {i+1}/{len(chunk_files)} موجود مسبقاً على GitHub، جاري التخطي...", flush=True)
        rendered_chunks.append(existing_on_github[0])
        continue

    print(f"🎨 جاري رندر المقطع {i+1} من {len(chunk_files)} بأسلوب ديزني 3D...", flush=True)
    workflow = build_workflow(os.path.basename(chunk_path), chunk_name)
    req = urllib.request.Request(
        "http://127.0.0.1:8188/prompt",
        data=json.dumps({"prompt": workflow}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        resp = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"❌ خطأ ComfyUI /prompt ({e.code}): {err_body}", flush=True)
        comfy_log.flush()
        print("📋 آخر سطور comfyui.log:\n" + open(f"{WORK_DIR}/comfyui.log").read()[-2500:], flush=True)
        raise
    prompt_id = resp["prompt_id"]

    while True:
        hist_req = urllib.request.urlopen(f"http://127.0.0.1:8188/history/{prompt_id}")
        hist = json.loads(hist_req.read().decode("utf-8"))
        if prompt_id in hist:
            status_obj = hist[prompt_id].get("status", {})
            if status_obj.get("status_str") == "error":
                print(f"❌ فشل تنفيذ المقطع {i+1}: {json.dumps(status_obj)}", flush=True)
                comfy_log.flush()
                print("📋 آخر سطور comfyui.log:\n" + open(f"{WORK_DIR}/comfyui.log").read()[-2500:], flush=True)
                raise RuntimeError(f"ComfyUI execution error on chunk {i+1}")
            break
        time.sleep(5)

    out_files = sorted(glob.glob(f"{COMFY_OUT}/{chunk_name}*.mp4"))
    if out_files:
        latest_out = out_files[-1]
        rendered_chunks.append(latest_out)
        push_progress_to_github(latest_out, f"Render Disney 3D chunk {i+1}/{len(chunk_files)}")

# ==========================================
# 6. دمج جميع المقاطع مع الصوت الأصلي ورفع الفيديو النهائي
# ==========================================
print("🎞️ جاري دمج المقاطع النهائية وإعادة الصوت الأصلي...", flush=True)
concat_list = f"{WORK_DIR}/concat.txt"
with open(concat_list, "w") as f:
    for idx_c, c_file in enumerate(rendered_chunks):
        if idx_c == 0:
            f.write(f"file '{c_file}'\n")
        else:
            trimmed = f"{WORK_DIR}/trimmed_{idx_c:03d}.mp4"
            subprocess.run(
                ["ffmpeg", "-y", "-ss", str(overlap), "-i", c_file, "-c:v", "libx264", "-crf", "16", trimmed, "-loglevel", "error"],
                check=True,
            )
            f.write(f"file '{trimmed}'\n")

MERGED_SILENT = f"{WORK_DIR}/merged_silent.mp4"
FINAL_DISNEY_VIDEO = f"{WORK_DIR}/FINAL_DISNEY_3D_5OAgixt3e4I.mp4"

subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list, "-c", "copy", MERGED_SILENT, "-loglevel", "error"], check=True)
subprocess.run(
    [
        "ffmpeg", "-y", "-i", MERGED_SILENT, "-i", RAW_VIDEO,
        "-c:v", "copy", "-c:a", "aac", "-map", "0:v:0", "-map", "1:a:0", "-shortest",
        FINAL_DISNEY_VIDEO, "-loglevel", "error",
    ],
    check=True,
)

push_progress_to_github(FINAL_DISNEY_VIDEO, "Complete Disney 3D full video render")
print(f"🎉 اكتمل التحويل بالكامل! تجد الفيديو النهائي في مستودعك تحت المسار:\n{OUTPUT_SUBDIR}/FINAL_DISNEY_3D_5OAgixt3e4I.mp4", flush=True)
