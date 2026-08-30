#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

DEFAULT_PAGE = "https://capcut.en.uptodown.com/android/download"
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


def download(url: str, output: Path) -> dict[str, object]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/octet-stream,*/*"})
    output.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(req, timeout=180) as response, output.open("wb") as f:
        sha = hashlib.sha256()
        total = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
            sha.update(chunk)
            total += len(chunk)
    if total < 100_000:
        raise RuntimeError(f"Downloaded object is unexpectedly small: {total} bytes")
    with output.open("rb") as f:
        magic = f.read(4)
    # APK is a ZIP container and normally begins with PK\x03\x04.
    if magic != b"PK\x03\x04":
        raise RuntimeError(f"Downloaded object does not look like an APK/ZIP (magic={magic!r})")
    return {"url": url, "path": str(output), "bytes": total, "sha256": sha.hexdigest()}


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch a publicly available CapCut Android APK from a distribution page.")
    parser.add_argument("--page-url", default=DEFAULT_PAGE)
    parser.add_argument("--output", default="target/capcut_target.apk")
    parser.add_argument("--metadata", default="target/capcut_fetch.json")
    args = parser.parse_args()

    print(f"[*] Fetch page: {args.page_url}")
    html = fetch_page(args.page_url)
    urls = candidate_urls(args.page_url, html)
    if not urls:
        raise RuntimeError("No direct APK URL discovered from the page. The site markup may have changed or the download may require an interactive flow.")

    last_error: Exception | None = None
    for url in urls:
        print(f"[*] Candidate APK URL: {url}")
        try:
            meta = download(url, Path(args.output))
            Path(args.metadata).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"[PASS] Downloaded {meta['bytes']} bytes; SHA-256={meta['sha256']}")
            return 0
        except Exception as exc:  # try next candidate without silently swallowing final failure
            last_error = exc
            print(f"[!] Candidate failed: {exc}")
    raise RuntimeError(f"All discovered APK candidates failed. Last error: {last_error}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)
