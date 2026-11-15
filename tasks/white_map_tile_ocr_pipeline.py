#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
High-Precision Deep Visual Tile OCR & Spatial Context Pipeline (White Roadmap Z18-Z20)
Repository: h776117073-eng/AI-Creative-Studio
"""

from __future__ import annotations

import concurrent.futures
import json
import math
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def ensure_packages() -> None:
    try:
        import cv2  # noqa: F401
        import openpyxl  # noqa: F401
        import pytesseract  # noqa: F401
        import scipy  # noqa: F401
    except ImportError:
        subprocess.run(["apt-get", "update", "-qq"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(
            [
                "apt-get", "install", "-y", "-qq",
                "tesseract-ocr", "tesseract-ocr-ara", "tesseract-ocr-eng",
                "libtesseract-dev", "libgl1", "curl",
            ],
            check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        subprocess.run(
            [
                sys.executable, "-m", "pip", "install", "-q",
                "opencv-python-headless", "numpy", "pillow", "pytesseract",
                "pandas", "openpyxl", "requests", "tqdm", "scipy",
            ],
            check=False,
        )


ensure_packages()

import cv2
import numpy as np
import pandas as pd
import pytesseract
import requests
from scipy.spatial import cKDTree

TARGET_SCOPE = os.environ.get("OCR_TARGET_SCOPE", "URBAN_ALL").strip()
INCLUDE_Z20 = os.environ.get("OCR_INCLUDE_Z20", "true").strip().lower() in ("1", "true", "yes")
MAX_WORKERS = int(os.environ.get("OCR_MAX_WORKERS", str(max(4, (os.cpu_count() or 4) * 2))))
MAX_RUNTIME_SECONDS = int(os.environ.get("OCR_MAX_RUNTIME_SECONDS", "15000"))

BASE_WORK_DIR = Path(os.environ.get("OCR_WORK_DIR", "/content/ibb_tile_ocr_work"))
if not Path("/content").exists() and "OCR_WORK_DIR" not in os.environ:
    BASE_WORK_DIR = Path.cwd() / "output" / "ibb_tile_ocr_work"

TILES_DIR = BASE_WORK_DIR / "mbtiles_cache"
OUT_DIR = BASE_WORK_DIR / "deliverables"
TILES_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR.mkdir(parents=True, exist_ok=True)

RELEASE_HOST = "https://github.com/mhommdkuyr/ibb-map-gis-downloader/releases/download/v1.0-ibb-map"
PLACES_CSV_URL = "https://raw.githubusercontent.com/mhommdkuyr/ibb-geospatial-scraper/main/ibb_master_places.csv"
BUILDINGS_SAMPLE_URL = "https://raw.githubusercontent.com/mhommdkuyr/my-ibb-governorate-map/main/data/ibb_buildings_sample.json"

URBAN_REGIONS = [
    {"code": "U01_Ibb_City", "name_ar": "مدينة إب", "north": 14.0150, "south": 13.9250, "east": 44.2150, "west": 44.1400},
    {"code": "U02_Al_Udayn_City", "name_ar": "مدينة العدين", "north": 13.9920, "south": 13.9480, "east": 44.0150, "west": 43.9650},
    {"code": "U03_Al_Qaidah_City", "name_ar": "مدينة القاعدة", "north": 13.7820, "south": 13.7320, "east": 44.1620, "west": 44.1150},
    {"code": "U04_Yarim_City", "name_ar": "مدينة يريم", "north": 14.3220, "south": 14.2720, "east": 44.4020, "west": 44.3500},
    {"code": "U05_Dhi_As_Sufal_City", "name_ar": "مدينة ذي السفال", "north": 13.8550, "south": 13.8150, "east": 44.1320, "west": 44.0880},
    {"code": "U06_Al_Makhadir_City", "name_ar": "مدينة المخادر", "north": 14.1320, "south": 14.0900, "east": 44.2200, "west": 44.1780},
    {"code": "U07_An_Nadirah_City", "name_ar": "مدينة النادرة", "north": 14.1300, "south": 14.0900, "east": 44.5000, "west": 44.4600},
    {"code": "U08_As_Saddah_City", "name_ar": "مدينة السدة", "north": 14.1800, "south": 14.1400, "east": 44.4000, "west": 44.3600},
]

DISTRICT_REGIONS = [
    {"code": "D01_Ibb", "name_ar": "مديرية إب (ريف إب)"},
    {"code": "D02_Al_Dhihar", "name_ar": "مديرية الظهار"},
    {"code": "D03_Al_Mashannah", "name_ar": "مديرية المشنة"},
    {"code": "D04_Jiblah", "name_ar": "مديرية جبلة"},
    {"code": "D05_Badan", "name_ar": "مديرية بعدان"},
    {"code": "D06_As_Sabrah", "name_ar": "مديرية السبرة"},
    {"code": "D07_As_Sayyani", "name_ar": "مديرية السياني"},
    {"code": "D08_Dhi_As_Sufal", "name_ar": "مديرية ذي السفال"},
    {"code": "D09_Mudhaykhirah", "name_ar": "مديرية مذيخرة"},
    {"code": "D10_Al_Udayn", "name_ar": "مديرية العدين"},
    {"code": "D11_Far_Al_Udayn", "name_ar": "مديرية فرع العدين"},
    {"code": "D12_Hazm_Al_Udayn", "name_ar": "مديرية حزم العدين"},
    {"code": "D13_Hubaysh", "name_ar": "مديرية حبيش"},
    {"code": "D14_Al_Makhadir", "name_ar": "مديرية المخادر"},
    {"code": "D15_Al_Qafr", "name_ar": "مديرية القفر"},
    {"code": "D16_Yarim", "name_ar": "مديرية يريم"},
    {"code": "D17_Ar_Radmah", "name_ar": "مديرية الرضمة"},
    {"code": "D18_As_Saddah", "name_ar": "مديرية السدة"},
    {"code": "D19_An_Nadirah", "name_ar": "مديرية النادرة"},
    {"code": "D20_Ash_Shair", "name_ar": "مديرية الشعر"},
]

START_TS = time.monotonic()
OLC_ALPHABET = "23456789CFGHJMPQRVWX"
PAIR_RESOLUTIONS = [20.0, 1.0, 0.05, 0.0025, 0.000125]
ARABIC_CHAR_RE = re.compile(r"[\u0600-\u06FF]")
VALID_TOKEN_RE = re.compile(r"[\u0600-\u06FFA-Za-z0-9]")


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def encode_plus_code(lat: float, lng: float, code_length: int = 11) -> str:
    lat = min(max(float(lat), -90.0), 90.0)
    if lat == 90.0:
        lat -= 1e-6
    while lng < -180.0:
        lng += 360.0
    while lng >= 180.0:
        lng -= 360.0

    lat_adj, lng_adj = lat + 90.0, lng + 180.0
    code: list[str] = []
    for i in range(5):
        res = PAIR_RESOLUTIONS[i]
        ld, gd = int(lat_adj / res), int(lng_adj / res)
        lat_adj -= ld * res
        lng_adj -= gd * res
        code.extend([OLC_ALPHABET[ld], OLC_ALPHABET[gd]])
        if i == 3:
            code.append("+")
    if code_length > 10:
        lat_idx = min(4, max(0, int(lat_adj / (PAIR_RESOLUTIONS[4] / 5.0))))
        lng_idx = min(3, max(0, int(lng_adj / (PAIR_RESOLUTIONS[4] / 4.0))))
        code.append(OLC_ALPHABET[lat_idx * 4 + lng_idx])
    return "".join(code)


def pixel_to_latlng(z: int, x: int, y: int, px: float, py: float, tile_size: float = 256.0) -> tuple[float, float]:
    n = 2.0 ** z
    lng = ((x + px / tile_size) / n) * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * ((y + py / tile_size) / n)))))
    return lat, lng


def latlng_to_tile(lat: float, lng: float, z: int) -> tuple[int, int]:
    lat_rad = math.radians(lat)
    n = 2.0 ** z
    return int((lng + 180.0) / 360.0 * n), int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin(math.radians(lat2 - lat1) / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2.0) ** 2
    return 2.0 * r * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def compute_bbox_geometrics(z: int, x: int, y: int, left: float, top: float, width: float, height: float) -> dict[str, float]:
    clat, clng = pixel_to_latlng(z, x, y, left + width / 2.0, top + height / 2.0)
    nlat, wlng = pixel_to_latlng(z, x, y, left, top)
    slat, elng = pixel_to_latlng(z, x, y, left + width, top + height)
    return {
        "lat": round(clat, 7),
        "lng": round(clng, 7),
        "north_lat": round(nlat, 7),
        "south_lat": round(slat, 7),
        "west_lng": round(wlng, 7),
        "east_lng": round(elng, 7),
        "delta_lat_deg": round(abs(nlat - slat), 8),
        "delta_lng_deg": round(abs(elng - wlng), 8),
        "width_m": round(haversine_m(clat, wlng, clat, elng), 2),
        "height_m": round(haversine_m(nlat, clng, slat, clng), 2),
    }


def download_file(url: str, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 1024:
        return True
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Ibb-Tile-OCR-Pipeline/2.0"})
        with urllib.request.urlopen(req, timeout=120) as resp, open(dest, "wb") as f:
            shutil.copyfileobj(resp, f)
        return dest.exists() and dest.stat().st_size > 1024
    except Exception as exc:
        log(f"Warning downloading {url}: {exc}")
        return False


def build_zoom20_mbtiles(out_mbtiles: Path) -> Path:
    conn = sqlite3.connect(str(out_mbtiles))
    cur = conn.cursor()
    cur.execute("CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT);")
    cur.execute("CREATE TABLE IF NOT EXISTS tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB, PRIMARY KEY (zoom_level, tile_column, tile_row));")
    cur.executemany(
        "INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)",
        [("name", "Ibb_Urban_White_Roadmap_Z20"), ("format", "png"), ("minzoom", "20"), ("maxzoom", "20")],
    )
    conn.commit()

    existing = {(r[0], r[1]) for r in cur.execute("SELECT tile_column, tile_row FROM tiles WHERE zoom_level = 20").fetchall()}
    z, n = 20, 1 << 20
    tasks, seen = [], set()
    for reg in URBAN_REGIONS:
        x0, y0 = latlng_to_tile(reg["north"], reg["west"], z)
        x1, y1 = latlng_to_tile(reg["south"], reg["east"], z)
        for x in range(min(x0, x1), max(x0, x1) + 1):
            for y in range(min(y0, y1), max(y0, y1) + 1):
                tms_y = (n - 1) - y
                if (x, tms_y) not in existing and (x, y) not in seen:
                    seen.add((x, y))
                    tasks.append((x, y, tms_y))

    log(f"Zoom 20 urban tiles to fetch: {len(tasks):,} (cached: {len(existing):,})")
    if not tasks:
        conn.close()
        return out_mbtiles

    session = requests.Session()
    session.mount("https://", requests.adapters.HTTPAdapter(pool_connections=32, pool_maxsize=32, max_retries=3))

    def fetch_one(item: tuple[int, int, int]) -> tuple[int, int, bytes] | None:
        x, y, tms_y = item
        url = f"https://mt{(x + y) % 4}.google.com/vt/lyrs=m&hl=ar&gl=YE&x={x}&y={y}&z=20"
        try:
            r = session.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=12)
            if r.status_code == 200 and len(r.content) > 80:
                return (x, tms_y, r.content)
        except Exception:
            pass
        return None

    batch, inserted = [], 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
        for res in pool.map(fetch_one, tasks):
            if res is not None:
                batch.append((20, res[0], res[1], res[2]))
                if len(batch) >= 500:
                    cur.executemany("INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)", batch)
                    conn.commit()
                    inserted += len(batch)
                    batch.clear()
    if batch:
        cur.executemany("INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)", batch)
        conn.commit()
        inserted += len(batch)

    log(f"Stored {inserted:,} Zoom 20 tiles into {out_mbtiles.name}.")
    conn.close()
    return out_mbtiles


def classify_text_category(text: str, nearby_poi_cat: str = "") -> str:
    low = text.strip().lower()
    rules = [
        ("صحة وصيدليات", ["مستشفى", "مستوصف", "عيادة", "صيدلية", "مركز صحي", "مختبر", "طبي", "أسنان", "hospital", "pharmacy", "clinic"]),
        ("تعليم وجامعات", ["جامعة", "كلية", "مدرسة", "معهد", "روضة", "أكاديمية", "school", "university", "college", "institute"]),
        ("مساجد ودور عبادة", ["مسجد", "جامع", "مصلى", "mosque"]),
        ("بنوك وصرافة", ["بنك", "مصرف", "صرافة", "للصرافة", "تحويل", "bank", "exchange"]),
        ("مطاعم ومقاهي", ["مطعم", "مطبخ", "مقهى", "كافيه", "بوفية", "مخبز", "حلويات", "restaurant", "cafe", "bakery"]),
        ("فنادق وشقق", ["فندق", "للاجنحة", "شقق مفروشة", "استراحة", "hotel", "suites"]),
        ("تجارة وأسواق", ["سوبر", "ماركت", "مول", "مركز تجاري", "بقالة", "محلات", "شركة", "مؤسسة", "معرض", "market", "mall", "store", "shop"]),
        ("وقود وخدمات سيارات", ["محطة", "بترول", "غاز", "بنشر", "ورشة", "قطع غيار", "station", "fuel"]),
        ("شوارع وأحياء", ["شارع", "جولة", "حي", "حارة", "طريق", "سوق", "مديرية", "قرية", "عزلة", "street", "road", "st"]),
        ("جهات حكومية وخدمية", ["مكتب", "إدارة", "محكمة", "نيابة", "أمن", "شرطة", "بريد", "اتصالات", "كهرباء", "مياه", "office"]),
    ]
    for cat, kws in rules:
        if any(k in low for k in kws):
            return cat
    return f"معلم مجاور ({nearby_poi_cat})" if nearby_poi_cat else "نص/معلم خريطة"


def isolate_text_and_symbols(img_bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray, list[tuple[int, int, int, int]]]:
    b, g, r = cv2.split(img_bgr)
    max_c = np.maximum(np.maximum(r, g), b).astype(np.int16)
    min_c = np.minimum(np.minimum(r, g), b).astype(np.int16)
    chroma = max_c - min_c
    luma = (0.114 * b + 0.587 * g + 0.299 * r).astype(np.float32)

    text_stroke_mask = ((luma < 175) | ((chroma > 48) & (luma < 215))).astype(np.uint8) * 255
    if int(np.count_nonzero(text_stroke_mask)) < 18:
        empty = np.full((256, 256), 255, dtype=np.uint8)
        return empty, empty, []

    scale = 4
    up_bgr = cv2.resize(img_bgr, (0, 0), fx=scale, fy=scale, interpolation=cv2.INTER_LANCZOS4)
    up_mask = cv2.resize(text_stroke_mask, (0, 0), fx=scale, fy=scale, interpolation=cv2.INTER_LINEAR)
    _, up_mask = cv2.threshold(up_mask, 90, 255, cv2.THRESH_BINARY)

    dilated_mask = cv2.dilate(up_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=1)
    l_ch, _, _ = cv2.split(cv2.cvtColor(up_bgr, cv2.COLOR_BGR2LAB))
    l_enh = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8)).apply(l_ch)
    sharp_l = cv2.addWeighted(l_enh, 1.55, cv2.GaussianBlur(l_enh, (0, 0), 1.4), -0.55, 0)
    isolated_gray = np.where(dilated_mask > 0, sharp_l, 255).astype(np.uint8)

    fg = isolated_gray[dilated_mask > 0]
    thresh_val = min(max(int(cv2.threshold(fg, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[0]) + 12, 110), 210) if fg.size > 0 else 175
    _, binary_inv = cv2.threshold(isolated_gray, thresh_val, 255, cv2.THRESH_BINARY_INV)

    grouped = cv2.dilate(binary_inv, cv2.getStructuringElement(cv2.MORPH_RECT, (26, 9)), iterations=1)
    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(grouped, connectivity=8)

    boxes = []
    h_img, w_img = isolated_gray.shape
    for lbl in range(1, num_labels):
        bx, by, bw, bh, area = stats[lbl]
        if bw < 16 or bh < 10 or area < 160 or (bw > w_img * 0.96 and bh > h_img * 0.96):
            continue
        x0, y0 = max(0, bx - 14), max(0, by - 14)
        x1, y1 = min(w_img, bx + bw + 14), min(h_img, by + bh + 14)
        boxes.append((x0, y0, x1 - x0, y1 - y0))

    return isolated_gray, 255 - binary_inv, boxes


def clean_ocr_text(raw: str) -> str:
    txt = re.sub(r"\s+", " ", raw).strip()
    return re.sub(r"^[^\u0600-\u06FFA-Za-z0-9]+|[^\u0600-\u06FFA-Za-z0-9\)\]]+$", "", txt).strip()


def run_tile_deep_ocr(tile_bytes: bytes, z: int, x: int, y: int, region_code: str, region_name_ar: str) -> list[dict[str, Any]]:
    img_bgr = cv2.imdecode(np.frombuffer(tile_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img_bgr is None:
        return []
    isolated_gray, binary_clean, boxes = isolate_text_and_symbols(img_bgr)
    if not boxes:
        return []

    scale = 4.0
    detections: list[dict[str, Any]] = []
    seen_local: set[tuple[str, int, int]] = set()

    def parse_tesseract_dict(data: dict[str, list[Any]], ox: int, oy: int, pass_name: str) -> None:
        lines: dict[tuple[int, int, int], list[dict[str, Any]]] = {}
        for i, raw_w in enumerate(data.get("text", [])):
            word = str(raw_w).strip()
            try:
                conf = float(data["conf"][i])
            except Exception:
                conf = -1.0
            if not word or conf < 38.0 or not VALID_TOKEN_RE.search(word):
                continue
            key = (int(data["block_num"][i]), int(data["par_num"][i]), int(data["line_num"][i]))
            lines.setdefault(key, []).append(
                {
                    "text": word, "conf": conf,
                    "left": int(data["left"][i]) + ox, "top": int(data["top"][i]) + oy,
                    "width": int(data["width"][i]), "height": int(data["height"][i]),
                }
            )

        for words in lines.values():
            phrase = clean_ocr_text(" ".join(w["text"] for w in words))
            if len(phrase) < 2 or not VALID_TOKEN_RE.search(phrase) or (len(phrase) == 2 and not ARABIC_CHAR_RE.search(phrase)):
                continue
            avg_conf = sum(w["conf"] for w in words) / len(words)
            min_l, min_t = min(w["left"] for w in words), min(w["top"] for w in words)
            max_r, max_b = max(w["left"] + w["width"] for w in words), max(w["top"] + w["height"] for w in words)
            px_left, px_top = min_l / scale, min_t / scale
            px_w, px_h = max(1.0, (max_r - min_l) / scale), max(1.0, (max_b - min_t) / scale)

            dkey = (phrase, int(round(px_left / 8.0)), int(round(px_top / 8.0)))
            if dkey in seen_local:
                continue
            seen_local.add(dkey)

            geo = compute_bbox_geometrics(z, x, y, px_left, px_top, px_w, px_h)
            detections.append(
                {
                    "extracted_text": phrase, "confidence": round(avg_conf, 1), "ocr_pass": pass_name,
                    "region_code": region_code, "region_name_ar": region_name_ar,
                    "zoom": z, "tile_x": x, "tile_y": y,
                    "pixel_left": round(px_left, 2), "pixel_top": round(px_top, 2),
                    "pixel_width": round(px_w, 2), "pixel_height": round(px_h, 2),
                    "plus_code": encode_plus_code(geo["lat"], geo["lng"], 11),
                    **geo,
                }
            )

    try:
        parse_tesseract_dict(
            pytesseract.image_to_data(isolated_gray, lang="ara+eng", config="--oem 3 --psm 11", output_type=pytesseract.Output.DICT),
            0, 0, "full_tile_psm11_gray",
        )
    except Exception:
        pass

    for bx, by, bw, bh in boxes[:24]:
        try:
            parse_tesseract_dict(
                pytesseract.image_to_data(binary_clean[by : by + bh, bx : bx + bw], lang="ara+eng", config="--oem 3 --psm 6", output_type=pytesseract.Output.DICT),
                bx, by, "roi_crop_psm6_bin",
            )
        except Exception:
            continue
    return detections


class SpatialContextEngine:
    def __init__(self) -> None:
        self.places_df = pd.DataFrame()
        self.places_tree: cKDTree | None = None
        self.buildings_df = pd.DataFrame()
        self.buildings_tree: cKDTree | None = None
        self._load()

    def _load(self) -> None:
        places_path = TILES_DIR / "ibb_master_places.csv"
        if download_file(PLACES_CSV_URL, places_path):
            try:
                df = pd.read_csv(places_path)
                lat_c = next((c for c in df.columns if c.lower() in ("lat", "latitude")), None)
                lng_c = next((c for c in df.columns if c.lower() in ("lng", "lon", "longitude")), None)
                nm_c = next((c for c in df.columns if c.lower() in ("name", "displayname", "name_ar", "title")), None)
                cat_c = next((c for c in df.columns if c.lower() in ("category", "type", "amenity", "shop")), None)
                adr_c = next((c for c in df.columns if c.lower() in ("address", "addr", "street", "district")), None)
                if lat_c and lng_c and nm_c:
                    df = df.dropna(subset=[lat_c, lng_c, nm_c]).copy()
                    df["_lat"] = pd.to_numeric(df[lat_c], errors="coerce")
                    df["_lng"] = pd.to_numeric(df[lng_c], errors="coerce")
                    df = df.dropna(subset=["_lat", "_lng"]).reset_index(drop=True)
                    df["_name"] = df[nm_c].astype(str)
                    df["_cat"] = df[cat_c].astype(str) if cat_c else ""
                    df["_addr"] = df[adr_c].astype(str) if adr_c else ""
                    self.places_df = df
                    self.places_tree = cKDTree(np.deg2rad(df[["_lat", "_lng"]].values))
            except Exception:
                pass

        bldg_path = TILES_DIR / "ibb_buildings_sample.json"
        if download_file(BUILDINGS_SAMPLE_URL, bldg_path):
            try:
                raw = json.loads(bldg_path.read_text(encoding="utf-8"))
                records = raw if isinstance(raw, list) else raw.get("features") or raw.get("buildings") or []
                rows = []
                for idx, item in enumerate(records):
                    if isinstance(item, dict):
                        props = item.get("properties", item)
                        geom = item.get("geometry", {})
                        lat, lng = props.get("latitude") or props.get("lat"), props.get("longitude") or props.get("lng") or props.get("lon")
                        if (lat is None or lng is None) and isinstance(geom, dict) and geom.get("type") == "Point":
                            coords = geom.get("coordinates", [])
                            if len(coords) >= 2:
                                lng, lat = coords[0], coords[1]
                        if lat is not None and lng is not None:
                            rows.append({"bldg_id": props.get("full_plus_code") or f"GOB_{idx}", "_lat": float(lat), "_lng": float(lng), "area_m2": float(props.get("area_in_meters") or props.get("area_m2") or 0.0)})
                if rows:
                    self.buildings_df = pd.DataFrame(rows)
                    self.buildings_tree = cKDTree(np.deg2rad(self.buildings_df[["_lat", "_lng"]].values))
            except Exception:
                pass

    def query_neighbors(self, lat: float, lng: float) -> dict[str, str]:
        nearby, addr, cat = [], "", ""
        if self.places_tree is not None and not self.places_df.empty:
            idxs = self.places_tree.query_ball_point(np.deg2rad([lat, lng]), r=300.0 / 6371000.0)
            scored = sorted((haversine_m(lat, lng, float(self.places_df.iloc[i]["_lat"]), float(self.places_df.iloc[i]["_lng"])), i) for i in idxs)
            for dist, i in scored[:5]:
                row = self.places_df.iloc[i]
                if row["_name"].strip() and row["_name"].lower() != "nan":
                    nearby.append(f"{row['_name'].strip()} ({int(round(dist))}م)")
                if not cat and row["_cat"] and row["_cat"].lower() != "nan":
                    cat = row["_cat"].strip()
                if not addr and row["_addr"] and row["_addr"].lower() != "nan":
                    addr = row["_addr"].strip()

        bldg_info = ""
        if self.buildings_tree is not None and not self.buildings_df.empty:
            dist_rad, idx = self.buildings_tree.query(np.deg2rad([lat, lng]), k=1)
            dist_m = float(dist_rad) * 6371000.0
            if dist_m <= 80.0:
                br = self.buildings_df.iloc[int(idx)]
                bldg_info = f"مبنى {br['bldg_id']} (مساحة {br['area_m2']:.1f} م²، على بعد {dist_m:.1f} م)"

        return {
            "nearby_landmarks": " | ".join(nearby) if nearby else "لا يوجد معلم مسجل ضمن 300م",
            "nearest_address": addr,
            "nearest_poi_category": cat,
            "nearest_building": bldg_info or "غير مرتبط بمبنى قريب (<80م)",
        }


def fetch_elevations_batch(coords: list[tuple[float, float]]) -> dict[tuple[float, float], float]:
    unique_coords = list({(round(lat, 5), round(lng, 5)) for lat, lng in coords})
    elev_map: dict[tuple[float, float], float] = {}
    session = requests.Session()
    for i in range(0, len(unique_coords), 100):
        chunk = unique_coords[i : i + 100]
        lats = ",".join(str(c[0]) for c in chunk)
        lngs = ",".join(str(c[1]) for c in chunk)
        try:
            r = session.get(f"https://api.open-meteo.com/v1/elevation?latitude={lats}&longitude={lngs}", timeout=15)
            if r.status_code == 200:
                for pt, el in zip(chunk, r.json().get("elevation", [])):
                    if el is not None:
                        elev_map[pt] = round(float(el), 1)
        except Exception:
            pass
        time.sleep(0.15)
    return elev_map


def spatial_text_deduplicate(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    df = df.sort_values(by=["zoom", "confidence"], ascending=[False, False]).reset_index(drop=True)
    kept, buckets = [], {}
    for idx, row in df.iterrows():
        norm = re.sub(r"\s+", "", str(row["extracted_text"])).lower()
        lat, lng = float(row["lat"]), float(row["lng"])
        if any(haversine_m(lat, lng, kl, kg) < 35.0 for kl, kg in buckets.get(norm, [])):
            continue
        buckets.setdefault(norm, []).append((lat, lng))
        kept.append(idx)
    return df.iloc[kept].reset_index(drop=True)


def upload_to_drive(files: list[Path]) -> None:
    folder_id = os.environ.get("TARGET_DRIVE_FOLDER_ID", "1hXAsTJNXS_E_L6kYsNDUqszjZbSuq9aK")
    mounted = Path("/content/drive/MyDrive/المطابقة العكسية")
    if Path("/content/drive/MyDrive").is_dir():
        mounted.mkdir(parents=True, exist_ok=True)
        for fp in files:
            if fp.is_file():
                shutil.copy2(fp, mounted / fp.name)
    try:
        import google.auth
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload

        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/drive"])
        service = build("drive", "v3", credentials=creds, cache_discovery=False)
        for fp in files:
            if fp.is_file():
                service.files().create(body={"name": fp.name, "parents": [folder_id]}, media_body=MediaFileUpload(str(fp), resumable=True), fields="id").execute()
    except Exception:
        pass


def process_mbtiles_file(mbtiles_path: Path, region_code: str, region_name_ar: str, min_zoom: int = 18, max_zoom: int = 20) -> list[dict[str, Any]]:
    if not mbtiles_path.exists():
        return []
    conn = sqlite3.connect(str(mbtiles_path))
    rows = conn.execute("SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles WHERE zoom_level BETWEEN ? AND ?", (min_zoom, max_zoom)).fetchall()
    conn.close()
    log(f"Scanning {len(rows):,} white tiles (Z{min_zoom}-Z{max_zoom}) for [{region_name_ar}]...")
    if not rows:
        return []

    results = []
    def worker(r: tuple[int, int, int, bytes]) -> list[dict[str, Any]]:
        z, col, tms_row, blob = r
        return run_tile_deep_ocr(blob, z, col, ((1 << z) - 1) - tms_row, region_code, region_name_ar)

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for i, batch_res in enumerate(pool.map(worker, rows, chunksize=32), 1):
            if batch_res:
                results.extend(batch_res)
            if i % 5000 == 0:
                log(f"   [{region_name_ar}] Scanned {i:,}/{len(rows):,} tiles | Extracted: {len(results):,}")
            if (time.monotonic() - START_TS) > MAX_RUNTIME_SECONDS:
                break
    return results


def main() -> int:
    regions_to_scan = list(URBAN_REGIONS) + (DISTRICT_REGIONS if TARGET_SCOPE.upper() == "GOVERNORATE_ALL" else [])
    all_raw = []
    for reg in regions_to_scan:
        mbt_name = f"{reg['code']}_roadmap.mbtiles"
        mbt_path = TILES_DIR / mbt_name
        if download_file(f"{RELEASE_HOST}/{mbt_name}", mbt_path):
            all_raw.extend(process_mbtiles_file(mbt_path, reg["code"], reg["name_ar"], 18, 19))
            if reg["code"].startswith("D"):
                mbt_path.unlink(missing_ok=True)

    if INCLUDE_Z20:
        z20_mbt = build_zoom20_mbtiles(TILES_DIR / "Ibb_Urban_White_Roadmap_Z20.mbtiles")
        all_raw.extend(process_mbtiles_file(z20_mbt, "URBAN_Z20", "المراكز الحضرية الثمانية (Zoom 20)", 20, 20))

    if not all_raw:
        return 0

    df_clean = spatial_text_deduplicate(pd.DataFrame(all_raw))
    ctx_engine = SpatialContextEngine()
    elev_map = fetch_elevations_batch(list(zip(df_clean["lat"], df_clean["lng"])))

    enriched_rows = []
    for idx, row in df_clean.iterrows():
        lat, lng = float(row["lat"]), float(row["lng"])
        nbr = ctx_engine.query_neighbors(lat, lng)
        elev_m = elev_map.get((round(lat, 5), round(lng, 5)))
        enriched_rows.append(
            {
                "id": idx + 1,
                "النص_المستخرج": row["extracted_text"],
                "التصنيف_المستنتج": classify_text_category(str(row["extracted_text"]), nbr["nearest_poi_category"]),
                "نسبة_الثقة_OCR": row["confidence"],
                "خط_العرض_Lat": lat,
                "خط_الطول_Lng": lng,
                "الارتفاع_متر_Elevation": elev_m if elev_m is not None else "غير متوفر",
                "رمز_Plus_Code": row["plus_code"],
                "الموقع_والعنوان_الكامل": f"{nbr['nearest_address']} — {row['region_name_ar']}، محافظة إب، اليمن" if nbr["nearest_address"] else f"{row['region_name_ar']}، محافظة إب، اليمن",
                "الأدلة_والمعالم_المجاورة": nbr["nearby_landmarks"],
                "المبنى_المجاور_OpenBuildings": nbr["nearest_building"],
                "أبعاد_النص_خط_العرض_ΔLat": row["delta_lat_deg"],
                "أبعاد_النص_خط_الطول_ΔLng": row["delta_lng_deg"],
                "العرض_المكاني_متر": row["width_m"],
                "الارتفاع_المكاني_متر": row["height_m"],
                "الحد_الشمالي_Lat": row["north_lat"],
                "الحد_الجنوبي_Lat": row["south_lat"],
                "الحد_الغربي_Lng": row["west_lng"],
                "الحد_الشرقي_Lng": row["east_lng"],
                "مستوى_الزوم": row["zoom"],
                "إحداثي_البلاطة_X": row["tile_x"],
                "إحداثي_البلاطة_Y": row["tile_y"],
                "موقع_البكسل_X": row["pixel_left"],
                "موقع_البكسل_Y": row["pixel_top"],
                "المنطقة": row["region_name_ar"],
                "مسار_الفحص": row["ocr_pass"],
            }
        )

    df_out = pd.DataFrame(enriched_rows)
    csv_path = OUT_DIR / "ibb_white_map_tile_ocr_z18_z20.csv"
    json_path = OUT_DIR / "ibb_white_map_tile_ocr_z18_z20.json"
    geojson_path = OUT_DIR / "ibb_white_map_tile_ocr_z18_z20.geojson"
    xlsx_path = OUT_DIR / "ibb_white_map_tile_ocr_z18_z20.xlsx"
    db_path = OUT_DIR / "ibb_white_map_tile_ocr_z18_z20.db"
    md_path = OUT_DIR / "ibb_white_map_tile_ocr_summary.md"

    df_out.to_csv(csv_path, index=False, encoding="utf-8-sig")
    df_out.to_excel(xlsx_path, sheet_name="نتائج_OCR_الخريطة_البيضاء", index=False)
    json_path.write_text(json.dumps({"total": len(df_out), "records": enriched_rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    geojson_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [r["خط_الطول_Lng"], r["خط_العرض_Lat"]]}, "properties": r} for r in enriched_rows],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    conn_out = sqlite3.connect(str(db_path))
    df_out.to_sql("tile_ocr_entities", conn_out, if_exists="replace", index=False)
    conn_out.close()

    md_lines = [
        "# تقرير المسح البصري العميق للخريطة البيضاء (Tile OCR Z18–Z20) — محافظة إب",
        f"- **إجمالي النصوص والمنشآت المستخرجة الفريدة:** {len(df_out):,}",
        "| التصنيف | العدد |",
        "| :--- | :---: |",
    ] + [f"| {k} | {v:,} |" for k, v in df_out["التصنيف_المستنتج"].value_counts().items()]
    md_path.write_text("\n".join(md_lines), encoding="utf-8")

    deliverables = [csv_path, json_path, geojson_path, xlsx_path, db_path, md_path]
    if INCLUDE_Z20 and (TILES_DIR / "Ibb_Urban_White_Roadmap_Z20.mbtiles").exists():
        deliverables.append(TILES_DIR / "Ibb_Urban_White_Roadmap_Z20.mbtiles")
    upload_to_drive(deliverables)

    repo_out = Path.cwd() / "output"
    repo_out.mkdir(parents=True, exist_ok=True)
    for p in (md_path, csv_path, geojson_path):
        shutil.copy2(p, repo_out / p.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
