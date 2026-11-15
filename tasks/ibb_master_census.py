# ==============================================================================
# 🚀 محرك الاستخراج الكلي والمطابقة العكسية المكانية لمحافظة إب (بدون أخطاء)
# المصادر: Overture Maps Places + Foursquare Open Source Places + OpenStreetMap (.osm.pbf) + Google Open Buildings + Tile OCR
# ==============================================================================

import os
import sys
import io
import re
import json
import math
import gzip
import shutil
import subprocess
import urllib.request
import numpy as np
import pandas as pd
from PIL import Image
from pathlib import Path

print("📦 جاري التحقق من التبعيات والمكتبات اللازمة وتثبيتها...", flush=True)
os.system("apt-get update -qq && apt-get install -y -qq tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng libtesseract-dev curl > /dev/null")
os.system(f"{sys.executable} -m pip install -q geopandas shapely pyproj duckdb osmium openpyxl pillow tqdm requests h3 pytesseract")

import duckdb
import osmium
import pytesseract
from shapely import wkt
from shapely.geometry import box

WORK_DIR = Path("/content/ibb_master_census_work")
WORK_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_EXCEL = WORK_DIR / "الاستخراج_الكلي_محافظة_إب_النهائي.xlsx"
OUTPUT_CSV = WORK_DIR / "الاستخراج_الكلي_محافظة_إب_النهائي.csv"
OUTPUT_JSON = WORK_DIR / "الاستخراج_الكلي_محافظة_إب_النهائي.json"
OUTPUT_BUILDINGS_CSV = WORK_DIR / "ibb_google_open_buildings.csv"

LAT_MIN, LAT_MAX = 13.70, 14.50
LON_MIN, LON_MAX = 43.80, 44.50
IBB_BOX = box(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX)

print(f"✅ بيئة العمل جاهزة في: {WORK_DIR}", flush=True)

# ==============================================================================
# 1️⃣ مولد Plus Code الرياضي
# ==============================================================================
OLC_ALPHABET = "23456789CFGHJMPQRVWX"
def encode_plus_code(lat, lon):
    try:
        lat = min(max(float(lat) + 90.0, 0.0), 179.999999)
        lon = min(max(float(lon) + 180.0, 0.0), 359.999999)
        lat_val = int(round(lat * 8000))
        lon_val = int(round(lon * 8000))
        lat_digits, lon_digits = [], []
        for _ in range(5):
            lat_digits.append(OLC_ALPHABET[lat_val % 20])
            lon_digits.append(OLC_ALPHABET[lon_val % 20])
            lat_val //= 20
            lon_val //= 20
        lat_digits.reverse()
        lon_digits.reverse()
        code = []
        for i in range(5):
            code.append(lat_digits[i])
            code.append(lon_digits[i])
            if i == 3:
                code.append("+")
        return "".join(code)
    except Exception:
        return "7H66+XX إب، اليمن"

MASTER_RECORDS = []
SOURCE_COUNTS = {}

def add_record(name, category, lat, lng, source, address="", phone="", plus_code="", raw_text=""):
    if not name or len(str(name).strip()) < 2:
        return
    name_clean = str(name).strip()
    lat_f = round(float(lat), 6)
    lng_f = round(float(lng), 6)
    p_code = plus_code if plus_code else encode_plus_code(lat_f, lng_f)
    MASTER_RECORDS.append({
        "unique_id": f"{source}_{lat_f:.6f}_{lng_f:.6f}_{abs(hash(name_clean)) % 100000}",
        "displayName": name_clean,
        "category": str(category).strip() if category else "منشأة عامة أو محل تجاري",
        "latitude": lat_f,
        "longitude": lng_f,
        "plusCode": p_code,
        "address": str(address).strip() if address else "محافظة إب، اليمن",
        "phone": str(phone).strip() if phone else "غير متوفر",
        "source_engine": source,
        "raw_ocr_or_data": str(raw_text)[:300] if raw_text else "",
        "googleMapsUrl": f"https://www.google.com/maps/search/?api=1&query={lat_f},{lng_f}"
    })
    SOURCE_COUNTS[source] = SOURCE_COUNTS.get(source, 0) + 1

# ==============================================================================
# 2️⃣ المصدر الأول: Overture Maps Places (S3 GeoParquet via DuckDB)
# ==============================================================================
print("\n🌐 [1/5] جاري تحميل ومعالجة Overture Maps Places لمحافظة إب...", flush=True)
try:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2';")

    overture_release = "2026-10-21.0"
    try:
        stac_req = urllib.request.Request("https://stac.overturemaps.org/catalog.json", headers={"User-Agent": "IbbCensusBot/1.0"})
        with urllib.request.urlopen(stac_req, timeout=10) as resp:
            stac_data = json.loads(resp.read().decode("utf-8"))
            latest_rel = stac_data.get("latest")
            if latest_rel:
                overture_release = latest_rel
    except Exception:
        pass

    ov_path = f"s3://overturemaps-us-west-2/release/{overture_release}/theme=places/type=place/*.parquet"
    cols_df = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{ov_path}') LIMIT 0").fetchdf()
    col_names = set(cols_df["column_name"].tolist())
    cat_expr = "basic_category" if "basic_category" in col_names else ("categories.primary" if "categories" in col_names else "'place'")

    ov_query = f"""
        SELECT
            names.primary AS name,
            {cat_expr} AS category,
            ST_Y(geometry) AS lat,
            ST_X(geometry) AS lng,
            COALESCE(addresses[1].freeform, '') AS address,
            COALESCE(phones[1], '') AS phone
        FROM read_parquet('{ov_path}')
        WHERE bbox.xmin BETWEEN {LON_MIN} AND {LON_MAX}
          AND bbox.ymin BETWEEN {LAT_MIN} AND {LAT_MAX}
          AND names.primary IS NOT NULL
    """
    ov_df = con.execute(ov_query).fetchdf()
    for _, row in ov_df.iterrows():
        add_record(row["name"], row["category"], row["lat"], row["lng"], source="Overture_Maps_Places", address=row["address"], phone=row["phone"])
    print(f"✅ Overture Maps Places ({overture_release}): تم استخراج {len(ov_df)} سجلاً.", flush=True)
except Exception as e:
    print(f"⚠️ تعذر جلب Overture Maps Places: {e}", flush=True)

# ==============================================================================
# 3️⃣ المصدر الثاني: Foursquare Open Source Places (S3 Parquet via DuckDB)
# ==============================================================================
print("\n📍 [2/5] جاري تحميل ومعالجة Foursquare Open Source Places لمحافظة إب...", flush=True)
fsq_loaded = False
for fsq_dt in ["2025-07-08", "2025-04-08", "2024-11-19"]:
    try:
        con_fsq = duckdb.connect()
        con_fsq.execute("INSTALL httpfs; LOAD httpfs;")
        con_fsq.execute("SET s3_region='us-east-1';")
        fsq_path = f"s3://fsq-os-places-us-east-1/release/dt={fsq_dt}/places/parquet/*.parquet"
        fsq_df = con_fsq.execute(f"""
            SELECT
                name,
                CAST(fsq_category_labels AS VARCHAR) AS category,
                latitude AS lat,
                longitude AS lng,
                COALESCE(address, '') AS address,
                COALESCE(tel, '') AS phone
            FROM read_parquet('{fsq_path}')
            WHERE latitude BETWEEN {LAT_MIN} AND {LAT_MAX}
              AND longitude BETWEEN {LON_MIN} AND {LON_MAX}
              AND name IS NOT NULL
        """).fetchdf()
        for _, row in fsq_df.iterrows():
            add_record(row["name"], row["category"], row["lat"], row["lng"], source="Foursquare_OS_Places", address=row["address"], phone=row["phone"])
        print(f"✅ Foursquare OS Places (dt={fsq_dt}): تم استخراج {len(fsq_df)} سجلاً.", flush=True)
        fsq_loaded = True
        break
    except Exception as e:
        print(f"⚠️ محاولة Foursquare dt={fsq_dt} لم تنجح: {e}", flush=True)
if not fsq_loaded:
    print("ℹ️ ملاحظة: حزمة Foursquare S3 العامة انتقلت أو غير متاحة مباشرة بدون رمز Iceberg Portal.", flush=True)

# ==============================================================================
# 4️⃣ المصدر الثالث: OpenStreetMap (yemen-latest.osm.pbf via Geofabrik + Osmium)
# ==============================================================================
print("\n🗺️ [3/5] جاري تحميل ومعالجة ملف OpenStreetMap (yemen-latest.osm.pbf)...", flush=True)
pbf_path = WORK_DIR / "yemen-latest.osm.pbf"
try:
    if not pbf_path.exists() or pbf_path.stat().st_size < 1_000_000:
        subprocess.run(["curl", "-sL", "-o", str(pbf_path), "https://download.geofabrik.de/asia/yemen-latest.osm.pbf"], check=True)
    print(f"📥 تم تحميل {pbf_path.name} ({pbf_path.stat().st_size / (1024*1024):.1f} MB)", flush=True)

    POI_KEYS = ("amenity", "shop", "craft", "tourism", "historic", "office", "healthcare", "leisure")

    class IbbOSMHandler(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.count = 0

        def _process_tags(self, tags, lat, lon):
            if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
                return
            name = tags.get("name:ar") or tags.get("name") or tags.get("brand")
            if not name:
                return
            cat = None
            for k in POI_KEYS:
                if k in tags:
                    cat = f"{k}:{tags[k]}"
                    break
            if not cat:
                return
            addr = tags.get("addr:street") or tags.get("addr:full") or "محافظة إب، اليمن"
            phone = tags.get("phone") or tags.get("contact:phone") or ""
            add_record(name, cat, lat, lon, source="OpenStreetMap_PBF", address=addr, phone=phone)
            self.count += 1

        def node(self, n):
            if n.location.valid():
                self._process_tags(n.tags, n.location.lat, n.location.lon)

        def way(self, w):
            if w.nodes:
                lats = [nd.lat for nd in w.nodes if nd.location.valid()]
                lons = [nd.lon for nd in w.nodes if nd.location.valid()]
                if lats and lons:
                    self._process_tags(w.tags, sum(lats) / len(lats), sum(lons) / len(lons))

    handler = IbbOSMHandler()
    handler.apply_file(str(pbf_path), locations=True)
    print(f"✅ OpenStreetMap (.osm.pbf): تم استخراج {handler.count} سجلاً لمحافظة إب.", flush=True)
except Exception as e:
    print(f"⚠️ تعذر معالجة OSM .osm.pbf: {e}", flush=True)

# ==============================================================================
# 5️⃣ المصدر الرابع: Google Open Buildings v3 (S2 Level-4 CSV.GZ)
# ==============================================================================
print("\n🏢 [4/5] جاري تحميل ومعالجة Google Open Buildings v3 لمحافظة إب...", flush=True)
total_buildings_ibb = 0
try:
    thresh_path = WORK_DIR / "score_thresholds_s2_level_4.csv"
    if not thresh_path.exists():
        subprocess.run(["curl", "-sL", "-o", str(thresh_path), "https://storage.googleapis.com/open-buildings-data/v3/score_thresholds_s2_level_4.csv"], check=True)
    thresh_df = pd.read_csv(thresh_path)
    matching_tokens = []
    for _, row in thresh_df.iterrows():
        geom = wkt.loads(row["geometry"])
        if geom.intersects(IBB_BOX):
            matching_tokens.append(str(row["s2_token"]))
    print(f"🔎 خلايا S2 المطابقة لمحافظة إب: {matching_tokens}", flush=True)

    first_chunk_write = True
    for token in matching_tokens:
        gz_file = WORK_DIR / f"{token}_buildings.csv.gz"
        url = f"https://storage.googleapis.com/open-buildings-data/v3/points_s2_level_4_gzip/{token}_buildings.csv.gz"
        if not gz_file.exists():
            subprocess.run(["curl", "-sL", "-o", str(gz_file), url], check=True)
        for chunk in pd.read_csv(gz_file, compression="gzip", chunksize=250_000):
            sub = chunk[
                (chunk["latitude"] >= LAT_MIN) & (chunk["latitude"] <= LAT_MAX) &
                (chunk["longitude"] >= LON_MIN) & (chunk["longitude"] <= LON_MAX) &
                (chunk["confidence"] >= 0.75)
            ]
            if not sub.empty:
                total_buildings_ibb += len(sub)
                sub.to_csv(OUTPUT_BUILDINGS_CSV, mode="w" if first_chunk_write else "a", header=first_chunk_write, index=False)
                first_chunk_write = False
        gz_file.unlink(missing_ok=True)
    print(f"✅ Google Open Buildings v3: تم استخراج {total_buildings_ibb:,} مبنى داخل محافظة إب وحفظها في {OUTPUT_BUILDINGS_CSV.name}.", flush=True)
except Exception as e:
    print(f"⚠️ تعذر جلب Google Open Buildings v3: {e}", flush=True)

# ==============================================================================
# 6️⃣ المصدر الخامس: Tile OCR Pipeline (Zoom 18)
# ==============================================================================
print("\n🔎 [5/5] تشغيل محرك Tile OCR Pipeline للبلاطات...", flush=True)
def process_tile_ocr(tile_img_bytes, z, x, y):
    try:
        im = Image.open(io.BytesIO(tile_img_bytes)).convert("RGB")
        w, h = im.size
        im_2x = im.resize((w * 2, h * 2), Image.Resampling.BICUBIC)
        arr = np.array(im_2x)
        if ((arr.min(axis=2) < 120) & (arr.max(axis=2) < 230)).sum() < 10:
            return []
        ocr_data = pytesseract.image_to_data(im_2x, lang='ara+eng', config=r'--psm 11 --oem 3', output_type=pytesseract.Output.DICT)
        spots = []
        for i in range(len(ocr_data['text'])):
            text = ocr_data['text'][i].strip()
            conf = int(float(str(ocr_data['conf'][i]).strip() or -1))
            if len(text) >= 3 and conf >= 40:
                px = (ocr_data['left'][i] + ocr_data['width'][i] / 2.0) / 2.0
                py = (ocr_data['top'][i] + ocr_data['height'][i] / 2.0) / 2.0
                n = 2.0 ** z
                lon_deg = (x + px / 256.0) / n * 360.0 - 180.0
                lat_deg = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * (y + py / 256.0) / n))))
                if LAT_MIN <= lat_deg <= LAT_MAX and LON_MIN <= lon_deg <= LON_MAX:
                    spots.append({"name": text, "lat": round(lat_deg, 6), "lng": round(lon_deg, 6)})
        return spots
    except Exception:
        return []

for tile_info in [
    {"z": 18, "x": 163222, "y": 120856},
    {"z": 18, "x": 163223, "y": 120856},
    {"z": 18, "x": 163221, "y": 120857},
]:
    try:
        tile_url = f"https://mt0.google.com/vt/lyrs=m&hl=ar&gl=YE&x={tile_info['x']}&y={tile_info['y']}&z={tile_info['z']}"
        req = urllib.request.Request(tile_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            for s in process_tile_ocr(resp.read(), tile_info['z'], tile_info['x'], tile_info['y']):
                add_record(s['name'], "معلم مستخرج بـ Tile OCR", s['lat'], s['lng'], source="Tile_OCR_Pipeline_Zoom18")
    except Exception:
        pass

# ==============================================================================
# 7️⃣ التصدير النهائي الشامل الموثق (Excel, CSV, JSON)
# ==============================================================================
df_final = pd.DataFrame(MASTER_RECORDS)
if not df_final.empty:
    df_final = df_final.drop_duplicates(subset=['latitude', 'longitude', 'displayName']).reset_index(drop=True)

ILLEGAL_CHARS_RE = re.compile(r'[\000-\010]|[\013-\014]|[\016-\037]')
for col in df_final.select_dtypes(include=['object']).columns:
    df_final[col] = df_final[col].fillna("").astype(str).apply(lambda x: ILLEGAL_CHARS_RE.sub('', x))

df_final.to_excel(OUTPUT_EXCEL, sheet_name="المطابقة_العكسية_إب_الشاملة", index=False)
df_final.to_csv(OUTPUT_CSV, index=False, encoding="utf-8-sig")

output_data_dict = {
    "project": "الاستخراج الكلي والمطابقة العكسية المكانية لمحافظة إب",
    "generated_at": str(pd.Timestamp.now()),
    "total_records": len(df_final),
    "google_open_buildings_count": total_buildings_ibb,
    "source_counts": SOURCE_COUNTS,
    "records": df_final.to_dict(orient="records")
}
OUTPUT_JSON.write_text(json.dumps(output_data_dict, ensure_ascii=False, indent=2), encoding="utf-8")

print("\n" + "="*70)
print(f"🎉 تم إنتاج جميع الملفات بنجاح تام!")
print(f"📊 إجمالي المعالم والمنشآت (Overture + FSQ + OSM + OCR): {len(df_final):,} سجلاً.")
print(f"🏢 إجمالي مباني Google Open Buildings في إب: {total_buildings_ibb:,} مبنى.")
print(f"📁 تفاصيل المصادر: {SOURCE_COUNTS}")
print("="*70, flush=True)
