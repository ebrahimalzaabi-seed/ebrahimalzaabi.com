#!/usr/bin/env python3
"""Fetch the latest channel videos and write them as JSON for the YOUTUBE_CACHE KV.

Sources, tried in order:
  1. The channel's public RSS feed (structured and stable, but YouTube sometimes
     returns 404/500 for every feed for days at a time).
  2. The channel's public /videos page, read from the embedded ytInitialData.

No dependencies beyond the standard library. Exits non-zero if every source
fails, so the workflow leaves the last good KV value in place.

Usage: python3 scripts/refresh-youtube.py [output_path]
"""
import datetime
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

CHANNEL_ID = "UChYrhls3RB-rZru10I0EF2w"
MAX_VIDEOS = 6
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")


def http_get(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": "CONSENT=YES+1; SOCS=CAI",
    })
    with urllib.request.urlopen(req, timeout=20) as res:
        return res.read().decode("utf-8")


def video(vid, title, views, published_time):
    return {
        "videoId": vid,
        "title": title,
        "url": f"https://www.youtube.com/watch?v={vid}",
        "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
        "views": views,
        "publishedTime": published_time,
    }


def relative_time(iso_str, now):
    diff = now - datetime.datetime.fromisoformat(iso_str)
    days = diff.days
    if days == 0:
        hours = diff.seconds // 3600
        if hours == 0:
            return "just now"
        return f'{hours} hour{"s" if hours != 1 else ""} ago'
    if days == 1:
        return "1 day ago"
    if days < 7:
        return f"{days} days ago"
    if days < 30:
        weeks = days // 7
        return f'{weeks} week{"s" if weeks != 1 else ""} ago'
    if days < 365:
        months = days // 30
        return f'{months} month{"s" if months != 1 else ""} ago'
    years = days // 365
    return f'{years} year{"s" if years != 1 else ""} ago'


def from_rss():
    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
        "media": "http://search.yahoo.com/mrss/",
    }
    xml = http_get(f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}")
    root = ET.fromstring(xml)
    now = datetime.datetime.now(datetime.timezone.utc)
    videos = []
    for entry in root.findall("atom:entry", ns)[:MAX_VIDEOS]:
        stats = entry.find("media:group/media:community/media:statistics", ns)
        videos.append(video(
            entry.find("yt:videoId", ns).text,
            entry.find("atom:title", ns).text,
            stats.get("views", "") if stats is not None else "",
            relative_time(entry.find("atom:published", ns).text, now),
        ))
    return videos


def from_channel_page():
    html = http_get(f"https://www.youtube.com/channel/{CHANNEL_ID}/videos?hl=en&gl=US")
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html, re.S)
    if not m:
        raise RuntimeError("ytInitialData not found in channel page")
    data = json.loads(m.group(1))

    lockups = []

    def walk(o):
        if isinstance(o, dict):
            if "lockupViewModel" in o:
                lockups.append(o["lockupViewModel"])
                return
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(data)

    videos = []
    for lv in lockups:
        if lv.get("contentType") != "LOCKUP_CONTENT_TYPE_VIDEO":
            continue
        md = lv["metadata"]["lockupMetadataViewModel"]
        parts = [p for row in md.get("metadata", {}).get("contentMetadataViewModel", {}).get("metadataRows", [])
                 for p in row.get("metadataParts", [])]
        labels = [p.get("accessibilityLabel") or p.get("text", {}).get("content", "") for p in parts]
        views = next((re.sub(r"\s*views?$", "", l) for l in labels if re.search(r"\bviews?$", l)), "")
        published = next((l for l in labels if l.endswith("ago")), "")
        videos.append(video(lv["contentId"], md["title"]["content"], views, published))
        if len(videos) == MAX_VIDEOS:
            break
    return videos


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/youtube.json"
    for name, fetch in (("rss", from_rss), ("channel page", from_channel_page)):
        try:
            videos = fetch()
        except Exception as e:  # noqa: BLE001 - any failure means try the next source
            print(f"::warning::{name} failed: {e}")
            continue
        if not videos:
            print(f"::warning::{name} returned 0 videos")
            continue
        with open(out_path, "w") as f:
            json.dump({"success": True, "videos": videos}, f, ensure_ascii=False, indent=2)
        print(f"Parsed {len(videos)} videos from {name}")
        for i, v in enumerate(videos, 1):
            print(f'  [{i}] {v["title"]} ({v["publishedTime"]}, {v["views"]} views)')
        return 0
    print("::error::All YouTube sources failed; KV left unchanged")
    return 1


if __name__ == "__main__":
    sys.exit(main())
