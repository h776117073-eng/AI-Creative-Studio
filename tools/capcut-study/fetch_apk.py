#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import urljoin

DEFAULT_PAGE = "https://capcut.en.uptodown.com/android/download"
DEFAULT_DIRECT = "https://d.apkpure.net/b/APK/com.lemon.lvoverseas?version=latest"
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"


def fetch_page(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"})
    with urllib.request.urlopen(req, timeout=45) as response:
        return response.read().decode("utf-8", errors="ignore")


def candidate_urls(page_url: str, html: str) -> list[str]:
    patterns = [
        r'data-url=["\'](https?://[^"\']+\.apk(?:\?[^"\']*)?)["\']',
        r'href=["\'](https?://[^"\']+\.apk(?:\?[^"\']*)?)["\']',
        r'(https?://[^\s"\'<>]+\.apk(?:\?[^\s"\'<>]*)?)',
        r'https://d\.apkpure\.net/b/APK/com\.lemon\.lvoverseas\?version=[^\s"\'<>]+'
    ]
    seen: set[str] = set()
    out: list[str] = []
    for pattern in patterns:
        for raw in re.findall(pattern, html, flags=re.I):
            url = urljoin(page_url, raw.replace("&amp;", "&"))
            if url not in seen:
                seen.add(url)
                out.append(url)
    return out


def validate_apk(path: Path) -> None:
    if path.stat().st_size < 100_000:
        raise RuntimeError(f"Downloaded object is unexpectedly small: {path.stat().st_size} bytes")
    if not zipfile.is_zipfile(path):
        with path.open("rb") as f:
            magic = f.read(8)
        raise RuntimeError(f"Downloaded object is not a ZIP/APK container (magic={magic!r})")
    with zipfile.ZipFile(path) as z:
        if "AndroidManifest.xml" not in z.namelist():
            raise RuntimeError("ZIP container does not contain AndroidManifest.xml")


def download(url: str, output: Path) -> dict[str, object]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/octet-stream,*/*"})
    output.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(req, timeout=600) as response, output.open("wb") as f:
        sha = hashlib.sha256()
        total = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
            sha.update(chunk)
            total += len(chunk)
    validate_apk(output)
    return {"url": url, "path": str(output), "bytes": total, "sha256": sha.hexdigest()}


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch a public CapCut Android APK for structural analysis.")
    parser.add_argument("--page-url", default=DEFAULT_PAGE)
    parser.add_argument("--direct-url", default=DEFAULT_DIRECT)
    parser.add_argument("--output", default="target/capcut_target.apk")
    parser.add_argument("--metadata", default="target/capcut_fetch.json")
    args = parser.parse_args()

    candidates = [args.direct_url]
    print(f"[*] Trying stable package endpoint: {args.direct_url}")
    try:
        meta = download(args.direct_url, Path(args.output))
        Path(args.metadata).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[PASS] Downloaded {meta['bytes']} bytes; SHA-256={meta['sha256']}")
        return 0
    except Exception as exc:
        print(f"[!] Direct endpoint failed: {exc}")

    print(f"[*] Fetch fallback distribution page: {args.page_url}")
    html = fetch_page(args.page_url)
    candidates.extend(candidate_urls(args.page_url, html))
    seen: set[str] = set()
    last_error: Exception | None = None
    for url in candidates:
        if url in seen:
            continue
        seen.add(url)
        print(f"[*] Candidate APK URL: {url}")
        try:
            meta = download(url, Path(args.output))
            Path(args.metadata).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"[PASS] Downloaded {meta['bytes']} bytes; SHA-256={meta['sha256']}")
            return 0
        except Exception as exc:
            last_error = exc
            print(f"[!] Candidate failed: {exc}")
    raise RuntimeError(f"All APK candidates failed. Last error: {last_error}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)
