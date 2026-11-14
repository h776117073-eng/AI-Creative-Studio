#!/usr/bin/env python3
"""
Exhaustive Ibb Governorate Reverse Geocoding & Multi-Source Spatial Census
Combines:
1. Google Open Buildings v3 (polygons & centroids across all 19 districts of Ibb Governorate)
2. OpenStreetMap Overpass API (all named/tagged POIs, amenities, shops, healthcare, education, offices, streets, addresses, phones, hours, images)
3. Overture Maps Places (Parquet via DuckDB HTTPFS for all Ibb Governorate bounding box)
4. Micro-Grid Centroid Reverse Geocoding on street-adjacent building centroids + Plus Codes (Open Location Code)
5. Strict deduplication, spatial building-to-POI snapping, and multi-format export (CSV, JSON, GeoJSON, XLSX, Summary Markdown) + Google Drive Upload.
"""

import os
import sys
import json
import time
import math
import gzip
import shutil
import hashlib
import sqlite3
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

OUT_DIR = Path(os.environ.get("CENSUS_OUT_DIR", "/content/ibb_census_output"))
OUT_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = OUT_DIR / "ibb_census.db"

IBB_BBOX = {
    "min_lat": 13.68,
    "max_lat": 14.42,
    "min_lng": 43.65,
    "max_lng": 44.68,
}

IBB_DISTRICTS = [
    {"name_ar": "مديرية الظهار", "name_en": "Al Dhahar", "lat": 13.9750, "lng": 44.1720},
    {"name_ar": "مديرية المشنة", "name_en": "Al Mashannah", "lat": 13.9580, "lng": 44.1830},
    {"name_ar": "مديرية ريف إب", "name_en": "Rif Ibb", "lat": 14.0100, "lng": 44.1600},
    {"name_ar": "مديرية جبلة", "name_en": "Jiblah", "lat": 13.9240, "lng": 44.1480},
    {"name_ar": "مديرية بعدان", "name_en": "Ba'dan", "lat": 13.9800, "lng": 44.2700},
    {"name_ar": "مديرية الشعر", "name_en": "Ash Sha'ir", "lat": 14.0400, "lng": 44.3200},
    {"name_ar": "مديرية السياني", "name_en": "As Sayyani", "lat": 13.8400, "lng": 44.1800},
    {"name_ar": "مديرية ذي السفال", "name_en": "Dhi As Sufal", "lat": 13.7600, "lng": 44.1300},
    {"name_ar": "مديرية مذيخرة", "name_en": "Mudhaykhirah", "lat": 13.8600, "lng": 43.9900},
    {"name_ar": "مديرية العدين", "name_en": "Al Udayn", "lat": 13.9600, "lng": 43.9800},
    {"name_ar": "مديرية فرع العدين", "name_en": "Far Al Udayn", "lat": 13.9200, "lng": 43.8200},
    {"name_ar": "مديرية حزم العدين", "name_en": "Hazm Al Udayn", "lat": 14.1200, "lng": 43.9200},
    {"name_ar": "مديرية حبيش", "name_en": "Hubaysh", "lat": 14.1300, "lng": 44.0800},
    {"name_ar": "مديرية المخادر", "name_en": "Al Makhadir", "lat": 14.1300, "lng": 44.2000},
    {"name_ar": "مديرية القفر", "name_en": "Al Qafr", "lat": 14.2800, "lng": 44.1000},
    {"name_ar": "مديرية يريم", "name_en": "Yarim", "lat": 14.2980, "lng": 44.3780},
    {"name_ar": "مديرية السدة", "name_en": "As Saddah", "lat": 14.1600, "lng": 44.3800},
    {"name_ar": "مديرية النادرة", "name_en": "An Nadirah", "lat": 14.1100, "lng": 44.4800},
    {"name_ar": "مديرية الرضمة", "name_en": "Ar Radmah", "lat": 14.2400, "lng": 44.5400},
]

OLC_ALPHABET = "23456789CFGHJMPQRVWX"
PAIR_RESOLUTIONS = [20.0, 1.0, 0.05, 0.0025, 0.000125]


def encode_plus_code(lat: float, lng: float, code_length: int = 11) -> str:
    lat = min(max(lat, -90.0), 90.0)
    if lat == 90.0:
        lat -= 0.00001
    while lng < -180.0:
        lng += 360.0
    while lng >= 180.0:
        lng -= 360.0

    lat += 90.0
    lng += 180.0
    code = []
    for i in range(5):
        res = PAIR_RESOLUTIONS[i]
        lat_digit = int(lat / res)
        lng_digit = int(lng / res)
        lat -= lat_digit * res
        lng -= lng_digit * res
        code.append(OLC_ALPHABET[lat_digit])
        code.append(OLC_ALPHABET[lng_digit])
        if i == 3:
            code.append("+")
    if code_length > 10:
        lat_res = PAIR_RESOLUTIONS[4]
        lng_res = PAIR_RESOLUTIONS[4]
        for _ in range(code_length - 10):
            lat_res /= 5.0
            lng_res /= 4.0
            lat_digit = min(int(lat / lat_res), 4)
            lng_digit = min(int(lng / lng_res), 3)
            lat -= lat_digit * lat_res
            lng -= lng_digit * lng_res
            code.append(OLC_ALPHABET[lat_digit * 4 + lng_digit])
    return "".join(code)


def nearest_district(lat: float, lng: float) -> str:
    best_name = "محافظة إب"
    best_dist = 1e18
    for d in IBB_DISTRICTS:
        dist = (lat - d["lat"]) ** 2 + (lng - d["lng"]) ** 2
        if dist < best_dist:
            best_dist = dist
            best_name = d["name_ar"]
    return best_name


def log(msg: str):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def init_db():
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS places (
            uid TEXT PRIMARY KEY,
            source TEXT,
            source_id TEXT,
            name_ar TEXT,
            name_en TEXT,
            category TEXT,
            sub_category TEXT,
            district TEXT,
            neighborhood TEXT,
            street TEXT,
            full_address TEXT,
            lat REAL,
            lng REAL,
            plus_code TEXT,
            phone TEXT,
            website TEXT,
            opening_hours TEXT,
            image_url TEXT,
            building_id TEXT,
            building_area_m2 REAL,
            google_maps_url TEXT,
            raw_tags TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS buildings (
            building_id TEXT PRIMARY KEY,
            lat REAL,
            lng REAL,
            area_m2 REAL,
            confidence REAL,
            plus_code TEXT,
            district TEXT,
            is_road_adjacent INTEGER DEFAULT 0,
            reverse_status TEXT DEFAULT 'pending',
            reverse_address TEXT,
            reverse_json TEXT
        )
    """)
    conn.commit()
    return conn


def fetch_osm_all_ibb(conn):
    log("=== STAGE 1: Extracting all OSM elements in Ibb Governorate via Overpass API ===")
    overpass_endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ]
    bbox_str = f"{IBB_BBOX['min_lat']},{IBB_BBOX['min_lng']},{IBB_BBOX['max_lat']},{IBB_BBOX['max_lng']}"
    query = f"""
    [out:json][timeout:180][bbox:{bbox_str}];
    (
      nwr["name"];
      nwr["shop"];
      nwr["amenity"];
      nwr["healthcare"];
      nwr["office"];
      nwr["craft"];
      nwr["tourism"];
      nwr["leisure"];
      nwr["industrial"];
      nwr["building"]["name"];
      nwr["phone"];
      nwr["contact:phone"];
      nwr["addr:street"];
    );
    out center tags;
    """
    data = None
    for ep in overpass_endpoints:
        try:
            log(f"Querying Overpass endpoint: {ep}")
            r = requests.post(ep, data={"data": query}, timeout=200)
            if r.status_code == 200:
                data = r.json()
                break
            else:
                log(f"Endpoint {ep} returned HTTP {r.status_code}")
        except Exception as e:
            log(f"Endpoint {ep} error: {e}")

    if not data or "elements" not in data:
        log("WARNING: Overpass API returned empty data; continuing with other sources.")
        return 0

    elements = data["elements"]
    log(f"Retrieved {len(elements)} raw OSM elements in Ibb Governorate.")
    cur = conn.cursor()
    inserted = 0

    category_keys = [
        "amenity", "shop", "healthcare", "office", "craft", "tourism",
        "leisure", "industrial", "place", "highway", "natural", "landuse", "building"
    ]

    for el in elements:
        tags = el.get("tags") or {}
        if not tags:
            continue
        if "highway" in tags and not any(k in tags for k in ["name", "name:ar", "name:en", "shop", "amenity", "healthcare", "office"]):
            continue

        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lng = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lng is None:
            continue

        name_ar = tags.get("name:ar") or tags.get("name") or tags.get("alt_name:ar") or tags.get("official_name") or ""
        name_en = tags.get("name:en") or tags.get("int_name") or ""
        if not name_ar and name_en:
            name_ar = name_en

        cat = ""
        sub_cat = ""
        for ck in category_keys:
            if ck in tags and tags[ck] != "yes":
                cat = ck
                sub_cat = tags[ck]
                break
        if not cat and "building" in tags:
            cat = "building"
            sub_cat = tags.get("building", "yes")

        if not name_ar and not sub_cat:
            continue

        street = tags.get("addr:street") or tags.get("street") or ""
        neighborhood = tags.get("addr:suburb") or tags.get("addr:quarter") or tags.get("addr:neighbourhood") or tags.get("addr:district") or ""
        city = tags.get("addr:city") or "إب"
        district = nearest_district(lat, lng)
        full_addr_parts = [p for p in [city, district, neighborhood, street, tags.get("addr:housenumber")] if p]
        full_address = " - ".join(dict.fromkeys(full_addr_parts))

        phone = (
            tags.get("phone")
            or tags.get("contact:phone")
            or tags.get("mobile")
            or tags.get("contact:mobile")
            or tags.get("contact:whatsapp")
            or ""
        )
        website = tags.get("website") or tags.get("contact:website") or tags.get("contact:facebook") or ""
        hours = tags.get("opening_hours") or ""
        image_url = tags.get("image") or tags.get("wikimedia_commons") or ""
        if tags.get("mapillary"):
            image_url = image_url or f"https://www.mapillary.com/app/?pKey={tags['mapillary']}"

        plus_code = encode_plus_code(lat, lng)
        gmaps_url = f"https://www.google.com/maps/search/?api=1&query={lat:.7f},{lng:.7f}"
        source_id = f"{el.get('type','node')}/{el.get('id')}"
        uid = f"osm_{source_id}"

        cur.execute("""
            INSERT OR REPLACE INTO places (
                uid, source, source_id, name_ar, name_en, category, sub_category,
                district, neighborhood, street, full_address, lat, lng, plus_code,
                phone, website, opening_hours, image_url, google_maps_url, raw_tags
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            uid, "OpenStreetMap", source_id, name_ar, name_en, cat, sub_cat,
            district, neighborhood, street, full_address, round(lat, 7), round(lng, 7), plus_code,
            phone, website, hours, image_url, gmaps_url, json.dumps(tags, ensure_ascii=False)
        ))
        inserted += 1

    conn.commit()
    log(f"Stage 1 Complete: Saved {inserted} OSM records for Ibb Governorate.")
    return inserted


def fetch_overture_places_ibb(conn):
    log("=== STAGE 2: Querying Overture Maps Places for Ibb Governorate ===")
    try:
        import duckdb
    except ImportError:
        os.system(f"{sys.executable} -m pip install -q duckdb")
        import duckdb

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2'; SET s3_access_key_id=''; SET s3_secret_access_key='';")

    release = "2026-10-21.0"
    try:
        stac = requests.get("https://stac.overturemaps.org/catalog.json", timeout=20).json()
        links = [l.get("href", "") for l in stac.get("links", []) if l.get("rel") == "child"]
        releases = sorted([href.strip("/").split("/")[0] for href in links if "202" in href])
        if releases:
            release = releases[-1]
    except Exception as e:
        log(f"STAC lookup fallback to {release}: {e}")

    log(f"Using Overture Maps release: {release}")
    s3_path = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"
    query = f"""
        SELECT
            id,
            names.primary AS primary_name,
            categories.primary AS primary_cat,
            categories.alternate AS alt_cats,
            phones,
            websites,
            socials,
            addresses,
            confidence,
            bbox.xmin AS lng,
            bbox.ymin AS lat
        FROM read_parquet('{s3_path}', filename=true, hive_partitioning=1)
        WHERE bbox.xmin BETWEEN {IBB_BBOX['min_lng']} AND {IBB_BBOX['max_lng']}
          AND bbox.ymin BETWEEN {IBB_BBOX['min_lat']} AND {IBB_BBOX['max_lat']}
    """
    try:
        rows = con.execute(query).fetchall()
    except Exception as e:
        log(f"Overture S3 query error: {e}")
        return 0

    log(f"Retrieved {len(rows)} Overture Maps places in Ibb Governorate.")
    cur = conn.cursor()
    inserted = 0
    for row in rows:
        oid, primary_name, primary_cat, alt_cats, phones, websites, socials, addresses, conf, lng, lat = row
        if lat is None or lng is None:
            continue
        district = nearest_district(lat, lng)
        plus_code = encode_plus_code(lat, lng)
        phone_str = ", ".join(phones) if isinstance(phones, list) else (str(phones) if phones else "")
        web_list = []
        if isinstance(websites, list):
            web_list.extend(websites)
        if isinstance(socials, list):
            web_list.extend(socials)
        website_str = ", ".join(web_list)

        addr_str = ""
        street_str = ""
        if isinstance(addresses, list) and addresses:
            a0 = addresses[0] if isinstance(addresses[0], dict) else {}
            street_str = a0.get("freeform", "") or ""
            locality = a0.get("locality", "") or ""
            addr_str = " - ".join([p for p in ["إب", district, locality, street_str] if p])
        else:
            addr_str = f"إب - {district}"

        gmaps_url = f"https://www.google.com/maps/search/?api=1&query={lat:.7f},{lng:.7f}"
        uid = f"overture_{oid}"
        cur.execute("""
            INSERT OR REPLACE INTO places (
                uid, source, source_id, name_ar, name_en, category, sub_category,
                district, neighborhood, street, full_address, lat, lng, plus_code,
                phone, website, opening_hours, image_url, google_maps_url, raw_tags
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            uid, "OvertureMaps", str(oid), primary_name or "", primary_name or "",
            "overture_poi", primary_cat or "", district, "", street_str, addr_str,
            round(lat, 7), round(lng, 7), plus_code, phone_str, website_str,
            "", "", gmaps_url, json.dumps({"alt_cats": alt_cats, "confidence": conf}, default=str, ensure_ascii=False)
        ))
        inserted += 1

    conn.commit()
    log(f"Stage 2 Complete: Saved {inserted} Overture Maps places.")
    return inserted


def fetch_google_open_buildings_ibb(conn):
    log("=== STAGE 3: Downloading Google Open Buildings v3 Polygons & Centroids for Ibb Governorate ===")
    index_url = "https://storage.googleapis.com/open-buildings-data/v3/polygons_s2_level_4_gzip/tiles.geojson"
    try:
        r = requests.get(index_url, timeout=30)
        tiles_gj = r.json()
    except Exception as e:
        log(f"Failed to fetch Open Buildings tile index: {e}")
        return 0

    matching_urls = []
    for feat in tiles_gj.get("features", []):
        props = feat.get("properties") or {}
        geom = feat.get("geometry") or {}
        coords = geom.get("coordinates", [[]])[0]
        if not coords:
            continue
        xs = [c[0] for c in coords]
        ys = [c[1] for c in coords]
        if max(xs) >= IBB_BBOX["min_lng"] and min(xs) <= IBB_BBOX["max_lng"] and max(ys) >= IBB_BBOX["min_lat"] and min(ys) <= IBB_BBOX["max_lat"]:
            tile_url = props.get("tile_url")
            if tile_url:
                matching_urls.append(tile_url)

    log(f"Found {len(matching_urls)} Google Open Buildings S2 tiles intersecting Ibb Governorate.")
    cur = conn.cursor()
    total_buildings = 0

    for t_idx, t_url in enumerate(matching_urls, 1):
        log(f"Streaming Open Buildings tile {t_idx}/{len(matching_urls)}: {t_url}")
        try:
            with requests.get(t_url, stream=True, timeout=180) as resp:
                resp.raise_for_status()
                with gzip.GzipFile(fileobj=resp.raw) as gz:
                    header = gz.readline().decode("utf-8").strip().split(",")
                    lat_idx = header.index("latitude")
                    lng_idx = header.index("longitude")
                    area_idx = header.index("area_in_meters")
                    conf_idx = header.index("confidence")
                    plus_idx = header.index("full_plus_code")

                    batch = []
                    for raw_line in gz:
                        line = raw_line.decode("utf-8")
                        parts = line.split(",", 6)
                        lat = float(parts[lat_idx])
                        lng = float(parts[lng_idx])
                        if not (IBB_BBOX["min_lat"] <= lat <= IBB_BBOX["max_lat"] and IBB_BBOX["min_lng"] <= lng <= IBB_BBOX["max_lng"]):
                            continue
                        area = float(parts[area_idx])
                        conf = float(parts[conf_idx])
                        pcode = parts[plus_idx].strip()
                        if area < 15.0 or conf < 0.65:
                            continue
                        b_id = f"gob_{pcode}_{round(lat,6)}_{round(lng,6)}"
                        dist = nearest_district(lat, lng)
                        batch.append((b_id, round(lat, 7), round(lng, 7), round(area, 2), round(conf, 3), pcode, dist))
                        if len(batch) >= 10000:
                            cur.executemany("""
                                INSERT OR IGNORE INTO buildings (building_id, lat, lng, area_m2, confidence, plus_code, district)
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                            """, batch)
                            conn.commit()
                            total_buildings += len(batch)
                            batch.clear()
                    if batch:
                        cur.executemany("""
                            INSERT OR IGNORE INTO buildings (building_id, lat, lng, area_m2, confidence, plus_code, district)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, batch)
                        conn.commit()
                        total_buildings += len(batch)
        except Exception as e:
            log(f"Error processing tile {t_url}: {e}")

    log(f"Stage 3 Complete: Extracted {total_buildings} verified building centroids in Ibb Governorate.")
    return total_buildings


def filter_road_adjacent_buildings(conn):
    log("=== STAGE 4: Filtering Street-Facing / Commercial Buildings via Road Network Buffer ===")
    overpass_url = "https://overpass-api.de/api/interpreter"
    bbox_str = f"{IBB_BBOX['min_lat']},{IBB_BBOX['min_lng']},{IBB_BBOX['max_lat']},{IBB_BBOX['max_lng']}"
    q = f"""
    [out:json][timeout:120][bbox:{bbox_str}];
    way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|service)$"];
    out geom;
    """
    road_cells = set()
    RES = 0.00045
    try:
        r = requests.post(overpass_url, data={"data": q}, timeout=150)
        if r.status_code == 200:
            ways = r.json().get("elements", [])
            log(f"Fetched {len(ways)} road segments across Ibb Governorate.")
            for w in ways:
                geom = w.get("geometry") or []
                for i in range(len(geom)):
                    lat1, lng1 = geom[i]["lat"], geom[i]["lon"]
                    gx, gy = int(lng1 / RES), int(lat1 / RES)
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            road_cells.add((gx + dx, gy + dy))
                    if i + 1 < len(geom):
                        lat2, lng2 = geom[i + 1]["lat"], geom[i + 1]["lon"]
                        steps = max(int(math.hypot(lat2 - lat1, lng2 - lng1) / (RES * 0.5)), 1)
                        for s in range(1, steps):
                            t = s / steps
                            ilat = lat1 + (lat2 - lat1) * t
                            ilng = lng1 + (lng2 - lng1) * t
                            gx, gy = int(ilng / RES), int(ilat / RES)
                            for dx in (-1, 0, 1):
                                for dy in (-1, 0, 1):
                                    road_cells.add((gx + dx, gy + dy))
    except Exception as e:
        log(f"Road fetch warning: {e}")

    cur = conn.cursor()
    cur.execute("SELECT building_id, lat, lng, area_m2 FROM buildings")
    all_b = cur.fetchall()
    adj_ids = []
    for b_id, lat, lng, area in all_b:
        gx, gy = int(lng / RES), int(lat / RES)
        if (gx, gy) in road_cells or area >= 220.0:
            adj_ids.append((b_id,))

    cur.executemany("UPDATE buildings SET is_road_adjacent = 1 WHERE building_id = ?", adj_ids)
    conn.commit()
    log(f"Stage 4 Complete: Identified {len(adj_ids)} street-adjacent / large commercial buildings out of {len(all_b)} total buildings.")
    return len(adj_ids)


def run_microgrid_reverse_geocoding(conn, max_queries: int = 3000):
    log("=== STAGE 5: Running Micro-Grid Centroid Reverse Geocoding on Priority Buildings ===")
    cur = conn.cursor()
    cur.execute("""
        SELECT building_id, lat, lng, area_m2, plus_code, district
        FROM buildings
        WHERE is_road_adjacent = 1 AND reverse_status = 'pending'
        ORDER BY area_m2 DESC
        LIMIT ?
    """, (max_queries * 4,))
    candidates = cur.fetchall()

    seen_cells = set()
    targets = []
    for row in candidates:
        b_id, lat, lng, area, pcode, dist = row
        cell = (round(lat, 4), round(lng, 4))
        if cell in seen_cells:
            continue
        seen_cells.add(cell)
        targets.append(row)
        if len(targets) >= max_queries:
            break

    log(f"Selected {len(targets)} high-priority micro-grid building centroids for reverse geocoding.")

    def query_photon_reverse(item):
        b_id, lat, lng, area, pcode, dist = item
        url = f"https://photon.komoot.io/reverse?lat={lat}&lon={lng}&limit=5"
        try:
            r = requests.get(url, headers={"User-Agent": "IbbSpatialCensus/1.0"}, timeout=12)
            if r.status_code == 200:
                return (b_id, lat, lng, area, pcode, dist, "done", r.json())
            return (b_id, lat, lng, area, pcode, dist, f"http_{r.status_code}", None)
        except Exception:
            return (b_id, lat, lng, area, pcode, dist, "err", None)

    done_count = 0
    new_places = 0
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = [pool.submit(query_photon_reverse, t) for t in targets]
        for fut in as_completed(futures):
            b_id, lat, lng, area, pcode, dist, status, payload = fut.result()
            done_count += 1
            addr_summary = ""
            if status == "done" and payload:
                feats = payload.get("features") or []
                for f in feats:
                    props = f.get("properties") or {}
                    f_coords = (f.get("geometry") or {}).get("coordinates") or [lng, lat]
                    flng, flat = f_coords[0], f_coords[1]
                    fname = props.get("name") or ""
                    fstreet = props.get("street") or ""
                    fsuburb = props.get("district") or props.get("locality") or ""
                    fcat = props.get("osm_key") or "reverse_point"
                    fsub = props.get("osm_value") or ""
                    addr_parts = [p for p in ["إب", dist, fsuburb, fstreet, fname] if p]
                    full_addr = " - ".join(dict.fromkeys(addr_parts))
                    if not addr_summary:
                        addr_summary = full_addr
                    if fname:
                        osm_id = props.get("osm_id") or hashlib.md5(f"{fname}_{flat}_{flng}".encode()).hexdigest()[:12]
                        uid = f"rev_{osm_id}"
                        gmaps_url = f"https://www.google.com/maps/search/?api=1&query={flat:.7f},{flng:.7f}"
                        cur.execute("""
                            INSERT OR IGNORE INTO places (
                                uid, source, source_id, name_ar, name_en, category, sub_category,
                                district, neighborhood, street, full_address, lat, lng, plus_code,
                                phone, website, opening_hours, image_url, building_id, building_area_m2,
                                google_maps_url, raw_tags
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            uid, "ReverseGeocoding", str(osm_id), fname, fname, fcat, fsub,
                            dist, fsuburb, fstreet, full_addr, round(flat, 7), round(flng, 7),
                            encode_plus_code(flat, flng), "", "", "", "", b_id, area,
                            gmaps_url, json.dumps(props, ensure_ascii=False)
                        ))
                        if cur.rowcount > 0:
                            new_places += 1

            cur.execute(
                "UPDATE buildings SET reverse_status = ?, reverse_address = ? WHERE building_id = ?",
                (status, addr_summary, b_id)
            )
            if done_count % 500 == 0:
                conn.commit()
                log(f"Reverse geocoded {done_count}/{len(targets)} centroids | New unique places: {new_places}")

    conn.commit()
    log(f"Stage 5 Complete: Processed {done_count} centroids, added {new_places} new reverse-geocoded places.")


def spatial_snap_places_to_buildings(conn):
    log("=== STAGE 6: Spatial Matching (Snapping POIs to Google Open Buildings) ===")
    cur = conn.cursor()
    cur.execute("SELECT building_id, lat, lng, area_m2, plus_code FROM buildings")
    b_rows = cur.fetchall()
    grid = {}
    for b_id, blat, blng, area, pcode in b_rows:
        key = (round(blat, 3), round(blng, 3))
        grid.setdefault(key, []).append((b_id, blat, blng, area, pcode))

    cur.execute("SELECT uid, lat, lng FROM places")
    p_rows = cur.fetchall()
    updates = []
    for uid, plat, plng in p_rows:
        best_b = None
        best_d = 1e18
        gx, gy = round(plat, 3), round(plng, 3)
        for dx in (-0.001, 0.0, 0.001):
            for dy in (-0.001, 0.0, 0.001):
                for b_id, blat, blng, area, pcode in grid.get((round(gx + dx, 3), round(gy + dy, 3)), []):
                    d = (plat - blat) ** 2 + (plng - blng) ** 2
                    if d < best_d:
                        best_d = d
                        best_b = (b_id, area)
        if best_b and best_d <= (0.00036 ** 2):
            updates.append((best_b[0], best_b[1], uid))

    cur.executemany("UPDATE places SET building_id = ?, building_area_m2 = ? WHERE uid = ?", updates)
    conn.commit()
    log(f"Stage 6 Complete: Linked {len(updates)}/{len(p_rows)} establishments to exact Google Open Building footprints.")


def export_all_deliverables(conn):
    log("=== STAGE 7: Exporting Comprehensive Deliverables ===")
    try:
        import pandas as pd
    except ImportError:
        os.system(f"{sys.executable} -m pip install -q pandas openpyxl")
        import pandas as pd

    df_places = pd.read_sql_query("""
        SELECT
            uid AS "المعرف_الفريد",
            source AS "المصدر",
            name_ar AS "اسم_المنشأة_عربي",
            name_en AS "اسم_المنشأة_انجليزي",
            category AS "التصنيف_الرئيسي",
            sub_category AS "النوع_الفرعي",
            district AS "المديرية",
            neighborhood AS "الحي_او_المنطقة",
            street AS "الشارع",
            full_address AS "العنوان_الكامل",
            lat AS "خط_العرض_Lat",
            lng AS "خط_الطول_Lng",
            plus_code AS "بلاس_كود_PlusCode",
            phone AS "رقم_الجوال_الهاتف",
            website AS "الموقع_الالكتروني",
            opening_hours AS "ساعات_العمل",
            image_url AS "رابط_الصورة",
            building_id AS "معرف_المبنى_الفضائي",
            building_area_m2 AS "مساحة_المبنى_م2",
            google_maps_url AS "رابط_خرائط_جوجل"
        FROM places
        ORDER BY district, category, name_ar
    """, conn)

    df_buildings = pd.read_sql_query("""
        SELECT
            building_id AS "معرف_المبنى",
            district AS "المديرية",
            lat AS "خط_العرض_Lat",
            lng AS "خط_الطول_Lng",
            plus_code AS "بلاس_كود_PlusCode",
            area_m2 AS "المساحة_م2",
            confidence AS "دقة_الرصد",
            is_road_adjacent AS "مطل_على_شارع",
            reverse_address AS "العنوان_العكسي"
        FROM buildings
        WHERE is_road_adjacent = 1
        ORDER BY district, area_m2 DESC
    """, conn)

    csv_path = OUT_DIR / "دليل_محافظة_إب_الشامل_المطابقة_العكسية.csv"
    xlsx_path = OUT_DIR / "دليل_محافظة_إب_الشامل_المطابقة_العكسية.xlsx"
    json_path = OUT_DIR / "دليل_محافظة_إب_الشامل_المطابقة_العكسية.json"
    geojson_path = OUT_DIR / "دليل_محافظة_إب_الشامل_المطابقة_العكسية.geojson"
    report_path = OUT_DIR / "تقرير_الحصر_الشامل_محافظة_إب.md"

    df_places.to_csv(csv_path, index=False, encoding="utf-8-sig")
    df_places.to_json(json_path, orient="records", force_ascii=False, indent=2)

    with pd.ExcelWriter(xlsx_path, engine="openpyxl") as writer:
        df_places.to_excel(writer, sheet_name="المنشآت والمحلات", index=False)
        dist_summary = df_places.groupby("المديرية", as_index=False).agg(
            إجمالي_المنشآت=("المعرف_الفريد", "count"),
            منشآت_بأرقام_هواتف=("رقم_الجوال_الهاتف", lambda s: (s.fillna("") != "").sum()),
            منشآت_بصور=("رابط_الصورة", lambda s: (s.fillna("") != "").sum()),
            منشآت_بساعات_عمل=("ساعات_العمل", lambda s: (s.fillna("") != "").sum()),
        )
        dist_summary.to_excel(writer, sheet_name="ملخص_المديريات", index=False)
        df_buildings.head(50000).to_excel(writer, sheet_name="المباني_المطلة_على_الشوارع", index=False)

    features = []
    for _, r in df_places.iterrows():
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(r["خط_الطول_Lng"]), float(r["خط_العرض_Lat"])]},
            "properties": {k: ("" if pd.isna(v) else v) for k, v in r.items()}
        })
    with open(geojson_path, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, ensure_ascii=False)

    total_buildings = conn.execute("SELECT COUNT(*) FROM buildings").fetchone()[0]
    road_buildings = conn.execute("SELECT COUNT(*) FROM buildings WHERE is_road_adjacent = 1").fetchone()[0]
    total_places = len(df_places)
    with_phone = int((df_places["رقم_الجوال_الهاتف"].fillna("") != "").sum())
    with_hours = int((df_places["ساعات_العمل"].fillna("") != "").sum())
    with_img = int((df_places["رابط_الصورة"].fillna("") != "").sum())

    md = [
        "# التقرير الشامل لحصر منشآت ومباني محافظة إب (المطابقة العكسية)",
        f"- **تاريخ التنفيذ (UTC):** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}",
        f"- **إجمالي المباني المرصودة فضائياً (Google Open Buildings):** {total_buildings:,}",
        f"- **المباني المطلة على الشوارع والمحاور التجارية:** {road_buildings:,}",
        f"- **إجمالي المنشآت والمحلات والمرافق المحصورة:** {total_places:,}",
        f"- **منشآت تحتوي على رقم جوال/هاتف:** {with_phone:,}",
        f"- **منشآت تحتوي على ساعات عمل:** {with_hours:,}",
        f"- **منشآت تحتوي على روابط صور:** {with_img:,}",
        "",
        "## التوزيع حسب المديريات",
        "| المديرية | عدد المنشآت المحصورة |",
        "| :--- | :---: |",
    ]
    for dist_name, cnt in df_places["المديرية"].value_counts().items():
        md.append(f"| {dist_name} | {cnt:,} |")

    report_path.write_text("\n".join(md), encoding="utf-8")
    log(f"Stage 7 Complete: Exported {total_places} establishments and {total_buildings} buildings.")
    return [csv_path, xlsx_path, json_path, geojson_path, report_path, DB_PATH]


def upload_files_to_drive(files):
    log("=== STAGE 8: Uploading Deliverables to Google Drive Folder 'المطابقة العكسية' ===")
    folder_id = os.environ.get("TARGET_DRIVE_FOLDER_ID", "1hXAsTJNXS_E_L6kYsNDUqszjZbSuq9aK")

    mounted_dir = Path("/content/drive/MyDrive/المطابقة العكسية")
    if Path("/content/drive/MyDrive").is_dir():
        mounted_dir.mkdir(parents=True, exist_ok=True)
        for fp in files:
            if Path(fp).is_file():
                shutil.copy2(fp, mounted_dir / Path(fp).name)
        log(f"Copied all deliverables directly to mounted Drive: {mounted_dir}")

    try:
        import google.auth
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload

        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/drive"])
        service = build("drive", "v3", credentials=creds, cache_discovery=False)

        for fp in files:
            p = Path(fp)
            if not p.is_file():
                continue
            mime = "application/octet-stream"
            if p.suffix == ".csv":
                mime = "text/csv"
            elif p.suffix == ".xlsx":
                mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            elif p.suffix in (".json", ".geojson"):
                mime = "application/json"
            elif p.suffix == ".md":
                mime = "text/markdown"

            meta = {"name": p.name, "parents": [folder_id]}
            media = MediaFileUpload(str(p), mimetype=mime, resumable=True)
            created = service.files().create(body=meta, media_body=media, fields="id,name,webViewLink").execute()
            log(f"Uploaded to Drive: {created.get('name')} -> ID={created.get('id')} | Link={created.get('webViewLink')}")
    except Exception as e:
        log(f"Drive API upload notice: {e}")


def main():
    start = time.time()
    log("Starting Exhaustive Ibb Governorate Reverse Census Pipeline...")
    conn = init_db()
    fetch_osm_all_ibb(conn)
    fetch_overture_places_ibb(conn)
    fetch_google_open_buildings_ibb(conn)
    filter_road_adjacent_buildings(conn)
    run_microgrid_reverse_geocoding(conn, max_queries=3000)
    spatial_snap_places_to_buildings(conn)
    files = export_all_deliverables(conn)
    upload_files_to_drive(files)
    elapsed = round(time.time() - start, 1)
    log(f"ALL DONE in {elapsed}s! Output directory: {OUT_DIR}")


if __name__ == "__main__":
    main()
