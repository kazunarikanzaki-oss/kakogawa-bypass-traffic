#!/usr/bin/env python3
"""Fetch @mlit_himeji recent tweets via Twitter syndication endpoint and write tweets.json."""
import datetime
import json
import re
import sys
import urllib.request
import urllib.error
from email.utils import parsedate_to_datetime
from pathlib import Path

SCREEN_NAME = "mlit_himeji"
URL = f"https://syndication.twitter.com/srv/timeline-profile/screen-name/{SCREEN_NAME}?showReplies=false"
OUT = Path(__file__).resolve().parent.parent / "tweets.json"
LIMIT = 20


def to_iso(twitter_date: str) -> str:
    """Convert 'Fri May 08 23:31:32 +0000 2026' to '2026-05-08T23:31:32+00:00' (ISO 8601)."""
    if not twitter_date:
        return ""
    try:
        # Twitter date is rfc-2822-ish: 'Fri May 08 23:31:32 +0000 2026'
        # Reorder to a form email.utils can parse: 'Fri, 08 May 2026 23:31:32 +0000'
        parts = twitter_date.split()
        if len(parts) == 6:
            rfc = f"{parts[0]}, {parts[2]} {parts[1]} {parts[5]} {parts[3]} {parts[4]}"
            dt = parsedate_to_datetime(rfc)
            return dt.isoformat()
    except Exception:
        pass
    return twitter_date  # fallback: keep raw


def fetch() -> str:
    req = urllib.request.Request(URL, headers={
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en;q=0.8",
        "Referer": "https://platform.twitter.com/",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def parse(html: str):
    m = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.+?)</script>',
        html, re.DOTALL)
    if not m:
        raise RuntimeError("__NEXT_DATA__ not found")
    data = json.loads(m.group(1))
    entries = data["props"]["pageProps"]["timeline"]["entries"]
    out = []
    for e in entries:
        t = (e.get("content") or {}).get("tweet")
        if not t:
            continue
        urls = []
        ents = t.get("entities") or {}
        for u in (ents.get("urls") or []):
            urls.append({
                "url": u.get("url"),
                "expanded_url": u.get("expanded_url"),
                "display_url": u.get("display_url"),
            })
        photos = []
        ext = (t.get("extended_entities") or {}).get("media") or []
        for m in ext:
            if m.get("type") == "photo":
                photos.append(m.get("media_url_https"))
        raw_created = t.get("created_at")
        out.append({
            "id": t.get("id_str"),
            "created_at": to_iso(raw_created),       # ISO 8601 (ブラウザ確実解釈)
            "created_at_raw": raw_created,           # 元のTwitter形式（互換用）
            "text": t.get("full_text") or t.get("text") or "",
            "permalink": t.get("permalink") or f"https://x.com/{SCREEN_NAME}/status/{t.get('id_str')}",
            "urls": urls,
            "photos": photos,
        })
    out.sort(key=lambda x: x["id"], reverse=True)
    return out[:LIMIT]


def main() -> int:
    try:
        html = fetch()
        tweets = parse(html)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        # Don't crash workflow if upstream is down; keep existing tweets.json
        if OUT.exists():
            print("Keeping existing tweets.json", file=sys.stderr)
            return 0
        return 1
    payload = {
        "screen_name": SCREEN_NAME,
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "tweets": tweets,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(tweets)} tweets to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
