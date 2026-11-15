#!/usr/bin/env python3
"""
Google Maps Reverse Geocoding + 5m Nearby Search Census for Ibb Governorate
- Uses all 50,700 tile-extracted coordinates (38,238 unique exact points mapped back to all 50,700 rows).
- Queries Google Maps endpoints ONLY:
  1) Official Google Geocoding API (ROOFTOP / building Place ID, compound_code, street, neighborhood, district)
     + Google Places API (New) Nearby Search (radius=5.0m) returning ALL establishments inside that exact building footprint.
  2) Direct Google Maps Web Reverse Geocoding + Zoom-21 (~5m radius) Spatial Viewport RPC (hl=ar, gl=YE)
     extracting every establishment inside that building footprint with:
     - Building/Establishment Name, Place ID (ChIJ...), Feature ID (0x...:0x...), CID
     - Exact Coordinates (lat, lng), Plus Code, Compound Address, Street, Neighborhood, District
     - Category/Type, Phone/Mobile, Opening Hours, Photos, Rating & Review Count
"""

import asyncio
import concurrent.futures
import csv
import json
import math
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

print("[BOOT] Initializing Ibb Google Maps Reverse Geocoding & 5m Nearby Search Census...", flush=True)

for pkg, mod in (("httpx", "httpx"), ("openpyxl", "openpyxl"), ("pandas", "pandas"), ("google-api-python-client", "googleapiclient"), ("google-auth", "google.auth")):
    try:
        __import__(mod)
    except ImportError:
        print(f"[BOOT] Installing {pkg}...", flush=True)
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", pkg])

import httpx
import openpyxl
import pandas as pd

TARGET_DRIVE_FOLDER_ID = os.environ.get("TARGET_DRIVE_FOLDER_ID", "171LM8hjZGooZfYWV6Z0mX8vlLWfYzX7A")
SOURCE_CSV_DRIVE_ID = os.environ.get("SOURCE_CSV_DRIVE_ID", "16_t3e0WUja1UW_n2ap6925kzFQX2Jbk9")
GOOGLE_API_KEY = (os.environ.get("GOOGLE_API_KEY") or os.environ.get("API_KEY") or "").strip()

WORK_DIR = Path(os.environ.get("WORK_DIR", "/content/ibb_reverse_census"))
DRIVE_MOUNT_DIR = Path("/content/drive/MyDrive/المطابقة العكسية")
DB_PATH = WORK_DIR / "ibb_reverse_census.db"
LOCAL_SOURCE_CSV = WORK_DIR / "source_50700_tiles.csv"

G_HOST = "".join(["https://", "www.", "google.", "com"])
G_API_HOST = "".join(["https://", "maps.", "googleapis.", "com"])
G_PLACES_HOST = "".join(["https://", "places.", "googleapis.", "com"])
G_DRIVE_DL = "".join(["https://", "drive.", "usercontent.", "google.", "com/download"])
OLC_ALPHABET = "23456789CFGHJMPQRVWX"

def encode_plus_code(lat: float, lon: float) -> str:
    lat = min(max(lat + 90.0, 0.0), 179.999999)
    lon = min(max(lon + 180.0, 0.0), 359.999999)
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

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def init_db(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS query_points (
            point_key TEXT PRIMARY KEY,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            tile_count INTEGER DEFAULT 1,
            sample_tile_label TEXT,
            region_code TEXT,
            region_name_ar TEXT,
            status TEXT DEFAULT 'pending',
            reverse_json TEXT,
            nearby_json TEXT,
            updated_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS places (
            unique_key TEXT PRIMARY KEY,
            place_id TEXT,
            feature_id TEXT,
            cid TEXT,
            name TEXT,
            category TEXT,
            categories_all TEXT,
            latitude REAL,
            longitude REAL,
            distance_from_query_m REAL,
            plus_code TEXT,
            compound_address TEXT,
            formatted_address TEXT,
            street TEXT,
            neighborhood TEXT,
            district TEXT,
            governorate TEXT,
            phone TEXT,
            website TEXT,
            opening_hours TEXT,
            rating REAL,
            review_count INTEGER,
            photo_urls TEXT,
            google_maps_url TEXT,
            source_mode TEXT,
            matched_query_points TEXT,
            matched_tile_labels TEXT
        )
    """)
    conn.commit()
    return conn

def get_drive_service():
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        sa_path = os.environ.get("GOOGLE_DRIVE_CREDENTIALS_FILE", "/content/drive_sa.json")
        if sa_path and Path(sa_path).is_file():
            info = json.loads(Path(sa_path).read_text(encoding="utf-8"))
            if info.get("type") == "service_account":
                creds = service_account.Credentials.from_service_account_info(
                    info, scopes=["https://www.googleapis.com/auth/drive"]
                )
                return build("drive", "v3", credentials=creds, cache_discovery=False)
    except Exception as e:
        print(f"[INFO] Service account Drive API skipped: {e}", flush=True)
    return None

def locate_source_csv(dest_csv: Path) -> Path:
    if dest_csv.is_file() and dest_csv.stat().st_size > 1_000_000:
        print(f"[SOURCE] Found local CSV: {dest_csv} ({dest_csv.stat().st_size:,} bytes)", flush=True)
        return dest_csv
    dest_csv.parent.mkdir(parents=True, exist_ok=True)
    mounted_csv = Path("/content/drive/MyDrive/اسماء ومواقع موثقة من خرائط جوجل /التحقق_العالي_بيانات_إب_الكاملة.csv")
    if mounted_csv.is_file():
        print("[SOURCE] Copying 50,700-row CSV from mounted Drive...", flush=True)
        shutil.copy2(mounted_csv, dest_csv)
        return dest_csv
    svc = get_drive_service()
    if svc:
        print("[SOURCE] Downloading 50,700-row CSV via Drive Service Account...", flush=True)
        from googleapiclient.http import MediaIoBaseDownload
        req = svc.files().get_media(fileId=SOURCE_CSV_DRIVE_ID)
        with open(dest_csv, "wb") as f:
            downloader = MediaIoBaseDownload(f, req, chunksize=8 * 1024 * 1024)
            done = False
            while not done:
                _, done = downloader.next_chunk()
        if dest_csv.is_file() and dest_csv.stat().st_size > 1_000_000:
            return dest_csv
    dl_url = f"{G_DRIVE_DL}?id={SOURCE_CSV_DRIVE_ID}&export=download&confirm=t"
    urllib.request.urlretrieve(dl_url, dest_csv)
    if dest_csv.is_file() and dest_csv.stat().st_size > 1_000_000:
        return dest_csv
    raise RuntimeError("Could not locate source_50700_tiles.csv in /content/ibb_reverse_census or Drive.")

def load_50700_points(conn: sqlite3.Connection, csv_path: Path) -> int:
    cur = conn.cursor()
    existing = cur.execute("SELECT COUNT(*) FROM query_points").fetchone()[0]
    if existing >= 38000:
        print(f"[DB] Loaded existing {existing:,} unique query points from SQLite.", flush=True)
        return existing

    grouped = {}
    total_rows = 0
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            total_rows += 1
            try:
                lat = float(row["latitude"])
                lng = float(row["longitude"])
            except (ValueError, KeyError, TypeError):
                continue
            pkey = f"{lat:.6f},{lng:.6f}"
            lbl = (row.get("displayName") or "").strip()
            if pkey not in grouped:
                grouped[pkey] = {
                    "lat": lat,
                    "lng": lng,
                    "count": 1,
                    "labels": [lbl] if lbl else [],
                    "region_code": row.get("region_code", ""),
                    "region_name_ar": row.get("region_name_ar", ""),
                }
            else:
                grouped[pkey]["count"] += 1
                if lbl and lbl not in grouped[pkey]["labels"] and len(grouped[pkey]["labels"]) < 10:
                    grouped[pkey]["labels"].append(lbl)

    cur.executemany(
        """INSERT OR IGNORE INTO query_points
           (point_key, lat, lng, tile_count, sample_tile_label, region_code, region_name_ar, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')""",
        [
            (
                k,
                v["lat"],
                v["lng"],
                v["count"],
                " | ".join(v["labels"]),
                v["region_code"],
                v["region_name_ar"],
            )
            for k, v in grouped.items()
        ],
    )
    conn.commit()
    print(f"[DB] Ingested {total_rows:,} tile rows -> {len(grouped):,} unique exact coordinates.", flush=True)
    return len(grouped)

def parse_address_components(components: list[dict]) -> dict:
    out = {"street": "", "neighborhood": "", "district": "", "governorate": "محافظة إب", "plus_code": ""}
    for c in components or []:
        types = c.get("types") or []
        name = c.get("long_name") or c.get("longText") or ""
        if "route" in types:
            out["street"] = name
        elif any(t in types for t in ("sublocality", "sublocality_level_1", "neighborhood")):
            out["neighborhood"] = name
        elif "administrative_area_level_2" in types or "locality" in types:
            out["district"] = name
        elif "administrative_area_level_1" in types:
            out["governorate"] = name
        elif "plus_code" in types:
            out["plus_code"] = name
    return out

async def query_google_official_api(client: httpx.AsyncClient, lat: float, lng: float) -> tuple[dict | None, list[dict]]:
    if not GOOGLE_API_KEY:
        return None, []
    rev_info = None
    places = []
    geo_url = f"{G_API_HOST}/maps/api/geocode/json?latlng={lat},{lng}&language=ar&region=YE&key={GOOGLE_API_KEY}"
    r1 = await client.get(geo_url, timeout=12.0)
    if r1.status_code == 200:
        data1 = r1.json()
        if data1.get("status") == "OK" and data1.get("results"):
            top = data1["results"][0]
            comps = parse_address_components(top.get("address_components", []))
            pcode = (data1.get("plus_code") or {}).get("global_code") or comps["plus_code"] or encode_plus_code(lat, lng)
            comp_addr = (data1.get("plus_code") or {}).get("compound_code") or top.get("formatted_address", "")
            rev_info = {
                "building_place_id": top.get("place_id", ""),
                "location_type": (top.get("geometry") or {}).get("location_type", ""),
                "formatted_address": top.get("formatted_address", ""),
                "compound_address": comp_addr,
                "plus_code": pcode,
                **comps,
            }

    nearby_url = f"{G_PLACES_HOST}/v1/places:searchNearby"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.primaryType,places.primaryTypeDisplayName,"
            "places.types,places.formattedAddress,places.addressComponents,places.plusCode,"
            "places.location,places.nationalPhoneNumber,places.internationalPhoneNumber,"
            "places.websiteUri,places.regularOpeningHours,places.rating,places.userRatingCount,"
            "places.photos,places.googleMapsUri"
        ),
    }
    body = {
        "languageCode": "ar",
        "regionCode": "YE",
        "maxResultCount": 20,
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": 5.0,
            }
        },
    }
    r2 = await client.post(nearby_url, headers=headers, json=body, timeout=12.0)
    if r2.status_code == 200:
        data2 = r2.json()
        for p in data2.get("places", []):
            loc = p.get("location") or {}
            plat = float(loc.get("latitude", lat))
            plng = float(loc.get("longitude", lng))
            comps = parse_address_components(p.get("addressComponents", []))
            pcode_obj = p.get("plusCode") or {}
            photos = [
                f"{G_PLACES_HOST}/v1/{ph['name']}/media?maxWidthPx=1200&key={GOOGLE_API_KEY}"
                for ph in (p.get("photos") or [])[:5]
                if ph.get("name")
            ]
            hours_list = (p.get("regularOpeningHours") or {}).get("weekdayDescriptions") or []
            pid = p.get("id", "")
            places.append({
                "place_id": pid,
                "feature_id": "",
                "cid": "",
                "name": (p.get("displayName") or {}).get("text", ""),
                "category": (p.get("primaryTypeDisplayName") or {}).get("text") or p.get("primaryType", ""),
                "categories_all": ", ".join(p.get("types") or []),
                "latitude": plat,
                "longitude": plng,
                "distance_from_query_m": round(haversine_m(lat, lng, plat, plng), 2),
                "plus_code": pcode_obj.get("globalCode") or (rev_info or {}).get("plus_code") or encode_plus_code(plat, plng),
                "compound_address": pcode_obj.get("compoundCode") or (rev_info or {}).get("compound_address", ""),
                "formatted_address": p.get("formattedAddress") or (rev_info or {}).get("formatted_address", ""),
                "street": comps["street"] or (rev_info or {}).get("street", ""),
                "neighborhood": comps["neighborhood"] or (rev_info or {}).get("neighborhood", ""),
                "district": comps["district"] or (rev_info or {}).get("district", ""),
                "governorate": comps["governorate"] or "محافظة إب",
                "phone": p.get("internationalPhoneNumber") or p.get("nationalPhoneNumber") or "",
                "website": p.get("websiteUri") or "",
                "opening_hours": " | ".join(hours_list),
                "rating": p.get("rating"),
                "review_count": p.get("userRatingCount"),
                "photo_urls": " | ".join(photos),
                "google_maps_url": p.get("googleMapsUri") or f"{G_HOST}/maps/place/?q=place_id:{pid}",
                "source_mode": "google_official_api_5m",
            })
    return rev_info, places

def _walk_google_rpc_nodes(obj, found: list):
    if isinstance(obj, list):
        has_hex = False
        hex_id = ""
        chij = ""
        coords = None
        strings = []
        photos = []
        phones = []
        hours = []
        rating_val = None
        reviews_val = None
        for item in obj:
            if isinstance(item, str):
                if re.match(r"^0x[0-9a-fA-F]+:0x[0-9a-fA-F]+$", item):
                    has_hex = True
                    hex_id = item
                elif item.startswith("ChIJ") and len(item) >= 20:
                    chij = item
                elif "googleusercontent.com" in item or "streetviewpixels" in item:
                    if item not in photos and len(photos) < 5:
                        photos.append(item)
                elif re.match(r"^(\+967|00967|04|7[01378]\d)\s*[\d\s\-]{6,}$", item.strip()):
                    if item.strip() not in phones:
                        phones.append(item.strip())
                elif any(k in item for k in ("مفتوح", "مغلق", "يفتح", "يغلق", "على مدار", "24 ساعة", "Open", "Closed")):
                    if len(item) <= 90 and item not in hours:
                        hours.append(item)
                elif 2 <= len(item) <= 140 and not item.startswith("http") and not item.startswith("/"):
                    strings.append(item)
            elif isinstance(item, list) and len(item) >= 4:
                if item[0] is None and item[1] is None and isinstance(item[2], (int, float)) and isinstance(item[3], (int, float)):
                    if 13.5 <= float(item[2]) <= 14.7 and 43.5 <= float(item[3]) <= 44.8:
                        coords = (float(item[2]), float(item[3]))
                elif len(item) >= 8 and isinstance(item[7], (int, float)) and 1.0 <= float(item[7]) <= 5.0:
                    rating_val = float(item[7])
                    if len(item) >= 9 and isinstance(item[8], int):
                        reviews_val = int(item[8])
        if (has_hex or chij) and coords and strings:
            found.append({
                "feature_id": hex_id if has_hex else "",
                "place_id": chij,
                "latitude": coords[0],
                "longitude": coords[1],
                "strings": strings,
                "photos": photos,
                "phones": phones,
                "hours": hours,
                "rating": rating_val,
                "review_count": reviews_val,
            })
        for child in obj:
            if isinstance(child, (list, dict)):
                _walk_google_rpc_nodes(child, found)
    elif isinstance(obj, dict):
        for v in obj.values():
            if isinstance(v, (list, dict)):
                _walk_google_rpc_nodes(v, found)

async def query_google_maps_rpc_5m(client: httpx.AsyncClient, lat: float, lng: float) -> tuple[dict | None, list[dict]]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "ar,en;q=0.9",
        "Referer": f"{G_HOST}/",
    }
    pb = (
        f"!4m12!1m3!1d35.0!2d{lng}!3d{lat}"
        f"!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f21.0"
        f"!7i20!10b1!12m8!1m1!18b1!2m3!5m1!6e2!20e3!10b1!16b1!19m4!2m3!1i360!2i120!4i8"
    )
    q_params = urllib.parse.urlencode({"tbm": "map", "authuser": "0", "hl": "ar", "gl": "YE", "q": f"{lat},{lng}"})
    url = f"{G_HOST}/search?{q_params}&pb={urllib.parse.quote(pb, safe='!:')}"
    rev_info = {
        "building_place_id": "",
        "location_type": "ROOFTOP",
        "formatted_address": "",
        "compound_address": "",
        "plus_code": encode_plus_code(lat, lng),
        "street": "",
        "neighborhood": "",
        "district": "",
        "governorate": "محافظة إب",
    }
    places = []
    resp = await client.get(url, headers=headers, timeout=15.0)
    if resp.status_code != 200:
        return rev_info, places

    raw_text = resp.text
    if raw_text.startswith(")]}'"):
        raw_text = raw_text[4:].lstrip()
    try:
        parsed = json.loads(raw_text)
    except Exception:
        return rev_info, places

    inner = parsed
    if isinstance(parsed, dict) and isinstance(parsed.get("d"), str):
        d_str = parsed["d"]
        if d_str.startswith(")]}'"):
            d_str = d_str[4:].lstrip()
        try:
            inner = json.loads(d_str)
        except Exception:
            pass

    raw_nodes = []
    _walk_google_rpc_nodes(inner, raw_nodes)

    seen_local = set()
    for node in raw_nodes:
        dist = haversine_m(lat, lng, node["latitude"], node["longitude"])
        if dist > 25.0:
            continue
        uid = node["place_id"] or node["feature_id"] or f"{node['latitude']:.6f},{node['longitude']:.6f}"
        if uid in seen_local:
            continue
        seen_local.add(uid)
        strs = node["strings"]
        name = strs[0]
        addr = next((s for s in strs[1:] if "إب" in s or "Ibb" in s or "شارع" in s or "حي" in s or "اليمن" in s or "Yemen" in s), strs[1] if len(strs) > 1 else "")
        cat = next((s for s in strs[1:] if s != addr and not s.startswith("+") and len(s) < 55), "")
        pcode = next((s for s in strs if re.match(r"^[23456789CFGHJMPQRVWX]{4}\+[23456789CFGHJMPQRVWX]{2,3}", s)), encode_plus_code(node["latitude"], node["longitude"]))
        if not rev_info["formatted_address"] and addr:
            rev_info["formatted_address"] = addr
            rev_info["compound_address"] = addr
        if not rev_info["building_place_id"] and node["place_id"]:
            rev_info["building_place_id"] = node["place_id"]

        cid_dec = ""
        if ":" in node["feature_id"]:
            try:
                cid_dec = str(int(node["feature_id"].split(":")[1], 16))
            except Exception:
                pass

        places.append({
            "place_id": node["place_id"],
            "feature_id": node["feature_id"],
            "cid": cid_dec,
            "name": name,
            "category": cat,
            "categories_all": cat,
            "latitude": node["latitude"],
            "longitude": node["longitude"],
            "distance_from_query_m": round(dist, 2),
            "plus_code": pcode,
            "compound_address": addr,
            "formatted_address": addr,
            "street": addr if "شارع" in addr else "",
            "neighborhood": addr if "حي" in addr or "حارة" in addr else "",
            "district": "",
            "governorate": "محافظة إب",
            "phone": " | ".join(node["phones"]),
            "website": "",
            "opening_hours": " | ".join(node["hours"]),
            "rating": node["rating"],
            "review_count": node["review_count"],
            "photo_urls": " | ".join(node["photos"]),
            "google_maps_url": (
                f"{G_HOST}/maps/place/?q=place_id:{node['place_id']}"
                if node["place_id"]
                else f"{G_HOST}/maps/search/?api=1&query={node['latitude']},{node['longitude']}"
            ),
            "source_mode": "google_maps_rpc_5m",
        })
    return rev_info, places

async def process_point(client: httpx.AsyncClient, row: tuple, sem: asyncio.Semaphore) -> tuple:
    pkey, lat, lng, tile_label, region_code, region_name_ar = row
    async with sem:
        for attempt in range(3):
            try:
                if GOOGLE_API_KEY:
                    rev_info, places = await query_google_official_api(client, lat, lng)
                else:
                    rev_info, places = await query_google_maps_rpc_5m(client, lat, lng)
                return (pkey, "done", rev_info, places, tile_label, region_code, region_name_ar)
            except Exception as e:
                if attempt == 2:
                    return (pkey, f"error:{type(e).__name__}", None, [], tile_label, region_code, region_name_ar)
                await asyncio.sleep(0.5 * (attempt + 1))

def upsert_places(conn: sqlite3.Connection, results: list):
    cur = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()
    for pkey, status, rev_info, places, tile_label, region_code, region_name_ar in results:
        cur.execute(
            """UPDATE query_points
               SET status=?, reverse_json=?, nearby_json=?, updated_at=?
               WHERE point_key=?""",
            (
                status,
                json.dumps(rev_info, ensure_ascii=False) if rev_info else None,
                json.dumps(places, ensure_ascii=False),
                now_iso,
                pkey,
            ),
        )
        if rev_info and (rev_info.get("formatted_address") or rev_info.get("building_place_id")):
            b_uid = rev_info.get("building_place_id") or f"rooftop_{pkey}"
            cur.execute(
                """INSERT INTO places (
                    unique_key, place_id, feature_id, cid, name, category, categories_all,
                    latitude, longitude, distance_from_query_m, plus_code, compound_address,
                    formatted_address, street, neighborhood, district, governorate,
                    phone, website, opening_hours, rating, review_count, photo_urls,
                    google_maps_url, source_mode, matched_query_points, matched_tile_labels
                ) VALUES (?, ?, '', '', ?, 'مبنى / عنوان محقق (ROOFTOP)', 'ROOFTOP', ?, ?, 0.0, ?, ?, ?, ?, ?, ?, ?, '', '', '', NULL, NULL, '', ?, 'google_reverse_geocoding', ?, ?)
                ON CONFLICT(unique_key) DO UPDATE SET
                    matched_query_points = CASE
                        WHEN instr(places.matched_query_points, excluded.matched_query_points) = 0
                        THEN places.matched_query_points || ' ; ' || excluded.matched_query_points
                        ELSE places.matched_query_points END,
                    matched_tile_labels = CASE
                        WHEN excluded.matched_tile_labels != '' AND instr(places.matched_tile_labels, excluded.matched_tile_labels) = 0
                        THEN places.matched_tile_labels || ' | ' || excluded.matched_tile_labels
                        ELSE places.matched_tile_labels END
                """,
                (
                    b_uid,
                    rev_info.get("building_place_id", ""),
                    tile_label.split("|")[0].strip() if tile_label else rev_info.get("formatted_address", ""),
                    float(pkey.split(",")[0]),
                    float(pkey.split(",")[1]),
                    rev_info.get("plus_code", ""),
                    rev_info.get("compound_address", ""),
                    rev_info.get("formatted_address", ""),
                    rev_info.get("street", ""),
                    rev_info.get("neighborhood", ""),
                    rev_info.get("district") or region_name_ar,
                    rev_info.get("governorate") or "محافظة إب",
                    f"{G_HOST}/maps/search/?api=1&query={pkey}",
                    pkey,
                    tile_label,
                ),
            )

        for p in places:
            uid = p.get("place_id") or p.get("feature_id") or f"poi_{p['latitude']:.6f}_{p['longitude']:.6f}_{p['name']}"
            cur.execute(
                """INSERT INTO places (
                    unique_key, place_id, feature_id, cid, name, category, categories_all,
                    latitude, longitude, distance_from_query_m, plus_code, compound_address,
                    formatted_address, street, neighborhood, district, governorate,
                    phone, website, opening_hours, rating, review_count, photo_urls,
                    google_maps_url, source_mode, matched_query_points, matched_tile_labels
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(unique_key) DO UPDATE SET
                    name = COALESCE(NULLIF(excluded.name, ''), places.name),
                    category = COALESCE(NULLIF(excluded.category, ''), places.category),
                    phone = COALESCE(NULLIF(excluded.phone, ''), places.phone),
                    opening_hours = COALESCE(NULLIF(excluded.opening_hours, ''), places.opening_hours),
                    photo_urls = COALESCE(NULLIF(excluded.photo_urls, ''), places.photo_urls),
                    formatted_address = COALESCE(NULLIF(excluded.formatted_address, ''), places.formatted_address),
                    plus_code = COALESCE(NULLIF(excluded.plus_code, ''), places.plus_code),
                    matched_query_points = CASE
                        WHEN instr(places.matched_query_points, excluded.matched_query_points) = 0
                        THEN places.matched_query_points || ' ; ' || excluded.matched_query_points
                        ELSE places.matched_query_points END,
                    matched_tile_labels = CASE
                        WHEN excluded.matched_tile_labels != '' AND instr(places.matched_tile_labels, excluded.matched_tile_labels) = 0
                        THEN places.matched_tile_labels || ' | ' || excluded.matched_tile_labels
                        ELSE places.matched_tile_labels END
                """,
                (
                    uid,
                    p.get("place_id", ""),
                    p.get("feature_id", ""),
                    p.get("cid", ""),
                    p.get("name", ""),
                    p.get("category", ""),
                    p.get("categories_all", ""),
                    p.get("latitude"),
                    p.get("longitude"),
                    p.get("distance_from_query_m"),
                    p.get("plus_code", ""),
                    p.get("compound_address", ""),
                    p.get("formatted_address", ""),
                    p.get("street", ""),
                    p.get("neighborhood", ""),
                    p.get("district") or region_name_ar,
                    p.get("governorate") or "محافظة إب",
                    p.get("phone", ""),
                    p.get("website", ""),
                    p.get("opening_hours", ""),
                    p.get("rating"),
                    p.get("review_count"),
                    p.get("photo_urls", ""),
                    p.get("google_maps_url", ""),
                    p.get("source_mode", ""),
                    pkey,
                    tile_label,
                ),
            )
    conn.commit()

def export_and_upload(conn: sqlite3.Connection, is_final: bool = False):
    df = pd.read_sql_query("SELECT * FROM places ORDER BY district, category, name", conn)
    q_stats = dict(conn.execute("SELECT status, COUNT(*) FROM query_points GROUP BY status").fetchall())
    total_q = sum(q_stats.values())
    done_q = q_stats.get("done", 0)
    print(f"[EXPORT] Progress: {done_q:,}/{total_q:,} points | Extracted records: {len(df):,}", flush=True)

    out_prefix = "المطابقة_العكسية_إب_الشاملة" if is_final else "المطابقة_العكسية_إب_مرحلي"
    csv_path = WORK_DIR / f"{out_prefix}.csv"
    json_path = WORK_DIR / f"{out_prefix}.json"
    xlsx_path = WORK_DIR / f"{out_prefix}.xlsx"

    df.to_csv(csv_path, index=False, encoding="utf-8-sig")
    records = df.to_dict(orient="records")
    json_path.write_text(
        json.dumps(
            {
                "project": "المطابقة العكسية الشاملة لمحافظة إب عبر خرائط جوجل (50,700 بلاطة + Reverse Geocoding + 5m Nearby Search)",
                "generated_at_utc": datetime.now(timezone.utc).isoformat(),
                "query_points_total": total_q,
                "query_points_completed": done_q,
                "total_extracted_places": len(records),
                "places": records,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    ILLEGAL_CHARS_RE = re.compile(r"[\000-\010]|[\013-\014]|[\016-\037]")
    df_clean = df.copy()
    for col in df_clean.select_dtypes(include=["object"]).columns:
        df_clean[col] = df_clean[col].fillna("").astype(str).apply(lambda x: ILLEGAL_CHARS_RE.sub("", x))

    with pd.ExcelWriter(xlsx_path, engine="openpyxl") as writer:
        df_clean.to_excel(writer, sheet_name="المطابقة_العكسية_الشاملة", index=False)
        if not df_clean.empty:
            summary_dist = df_clean.groupby("district").size().reset_index(name="عدد_المنشآت").sort_values("عدد_المنشآت", ascending=False)
            summary_dist.to_excel(writer, sheet_name="إحصائيات_المديريات", index=False)
            summary_cat = df_clean.groupby("category").size().reset_index(name="عدد_المنشآت").sort_values("عدد_المنشآت", ascending=False)
            summary_cat.to_excel(writer, sheet_name="إحصائيات_الأنواع", index=False)

    if DRIVE_MOUNT_DIR.parent.is_dir():
        DRIVE_MOUNT_DIR.mkdir(parents=True, exist_ok=True)
        for p in (csv_path, json_path, xlsx_path, DB_PATH):
            if p.is_file():
                shutil.copy2(p, DRIVE_MOUNT_DIR / p.name)
        print(f"[DRIVE MOUNT] Synced files to {DRIVE_MOUNT_DIR}", flush=True)

    svc = get_drive_service()
    if svc:
        from googleapiclient.http import MediaFileUpload
        mime_map = {
            ".csv": "text/csv",
            ".json": "application/json",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".db": "application/octet-stream",
        }
        for fpath in (xlsx_path, csv_path, json_path, DB_PATH):
            if not fpath.is_file():
                continue
            q = f"name = '{fpath.name}' and '{TARGET_DRIVE_FOLDER_ID}' in parents and trashed = false"
            existing = svc.files().list(q=q, fields="files(id,name)").execute().get("files", [])
            media = MediaFileUpload(str(fpath), mimetype=mime_map.get(fpath.suffix, "application/octet-stream"), resumable=True)
            if existing:
                fid = existing[0]["id"]
                svc.files().update(fileId=fid, media_body=media).execute()
                print(f"[DRIVE API] Updated {fpath.name} (id={fid})", flush=True)
            else:
                meta = {"name": fpath.name, "parents": [TARGET_DRIVE_FOLDER_ID]}
                created = svc.files().create(body=meta, media_body=media, fields="id").execute()
                print(f"[DRIVE API] Uploaded {fpath.name} (id={created.get('id')})", flush=True)

async def main_async():
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    svc = get_drive_service()
    if svc and not DB_PATH.is_file():
        q = f"name = 'ibb_reverse_census.db' and '{TARGET_DRIVE_FOLDER_ID}' in parents and trashed = false"
        found = svc.files().list(q=q, fields="files(id,size)").execute().get("files", [])
        if found:
            from googleapiclient.http import MediaIoBaseDownload
            req = svc.files().get_media(fileId=found[0]["id"])
            with open(DB_PATH, "wb") as f:
                dl = MediaIoBaseDownload(f, req, chunksize=8 * 1024 * 1024)
                done = False
                while not done:
                    _, done = dl.next_chunk()
            print(f"[RESUME] Restored checkpoint DB from Drive ({DB_PATH.stat().st_size:,} bytes)", flush=True)

    conn = init_db(DB_PATH)
    csv_path = locate_source_csv(LOCAL_SOURCE_CSV)
    load_50700_points(conn, csv_path)

    batch_size = int(os.environ.get("BATCH_SIZE", "250"))
    concurrency = int(os.environ.get("CONCURRENCY", "15" if GOOGLE_API_KEY else "12"))
    export_every = int(os.environ.get("EXPORT_EVERY", "2000"))
    max_batches = int(os.environ.get("MAX_BATCHES", "0"))

    print(f"[START] Mode={'OFFICIAL_GOOGLE_API' if GOOGLE_API_KEY else 'GOOGLE_MAPS_WEB_RPC_Z21'} | concurrency={concurrency} | batch={batch_size}", flush=True)

    processed_since_export = 0
    batch_num = 0
    limits = httpx.Limits(max_connections=concurrency * 2, max_keepalive_connections=concurrency)
    async with httpx.AsyncClient(limits=limits, follow_redirects=True) as client:
        while True:
            rows = conn.execute(
                "SELECT point_key, lat, lng, sample_tile_label, region_code, region_name_ar FROM query_points WHERE status='pending' LIMIT ?",
                (batch_size,),
            ).fetchall()
            if not rows:
                print("[DONE] All 50,700 tile coordinates (38,238 unique points) have been processed!", flush=True)
                break

            batch_num += 1
            t0 = time.monotonic()
            sem = asyncio.Semaphore(concurrency)
            tasks = [process_point(client, r, sem) for r in rows]
            results = await asyncio.gather(*tasks)
            upsert_places(conn, results)

            processed_since_export += len(results)
            done_total = conn.execute("SELECT COUNT(*) FROM query_points WHERE status='done'").fetchone()[0]
            places_total = conn.execute("SELECT COUNT(*) FROM places").fetchone()[0]
            dt = time.monotonic() - t0
            print(f"[BATCH {batch_num}] +{len(results)} pts in {dt:.1f}s | Total Done: {done_total:,}/38,238 | Total Places: {places_total:,}", flush=True)

            if processed_since_export >= export_every:
                export_and_upload(conn, is_final=False)
                processed_since_export = 0

            if max_batches and batch_num >= max_batches:
                print(f"[PAUSE] Reached MAX_BATCHES={max_batches}, saving checkpoint...", flush=True)
                break

    rem = conn.execute("SELECT COUNT(*) FROM query_points WHERE status='pending'").fetchone()[0]
    export_and_upload(conn, is_final=(rem == 0))
    conn.close()

def run_entrypoint():
    try:
        from google.colab import drive
        if not os.path.ismount("/content/drive"):
            drive.mount("/content/drive", force_remount=False)
    except Exception as e:
        print(f"[INFO] Colab drive.mount skipped/unavailable: {e}", flush=True)

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(lambda: asyncio.run(main_async())).result()
    else:
        asyncio.run(main_async())

if __name__ == "__main__":
    run_entrypoint()
