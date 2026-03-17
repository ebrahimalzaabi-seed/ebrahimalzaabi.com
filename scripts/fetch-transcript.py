#!/usr/bin/env python3
"""Fetch YouTube transcript and output merged paragraphs as JSON.

Usage: fetch-transcript.py <video_url_or_id>

Outputs JSON: { "success": true, "text": "merged paragraphs..." }
On error:    { "success": false, "error": "message" }
"""

import json
import re
import sys

from youtube_transcript_api import YouTubeTranscriptApi

GAP_THRESHOLD = 2.0  # seconds gap = paragraph break
PARA_CHAR_LIMIT = 300  # max chars before forcing a paragraph break


def extract_video_id(url_or_id):
    """Extract video ID from various YouTube URL formats or return as-is."""
    patterns = [
        r'(?:youtube\.com/watch\?.*v=|youtu\.be/|youtube\.com/embed/|youtube\.com/v/)([a-zA-Z0-9_-]{11})',
    ]
    for pat in patterns:
        m = re.search(pat, url_or_id)
        if m:
            return m.group(1)
    # Assume it's already an ID if 11 chars
    cleaned = url_or_id.strip()
    if re.match(r'^[a-zA-Z0-9_-]{11}$', cleaned):
        return cleaned
    return None


def merge_transcript(transcript):
    """Merge transcript segments into paragraphs based on gaps and char limits."""
    # First pass: merge by timestamp gaps
    paragraphs = []
    current = ""
    last_end = 0

    for seg in transcript:
        gap = seg.start - last_end

        should_break = current and (
            gap > GAP_THRESHOLD or len(current) > PARA_CHAR_LIMIT
        )

        if should_break:
            paragraphs.append(current.strip())
            current = ""

        current += (" " if current else "") + seg.text
        last_end = seg.start + seg.duration

    if current.strip():
        paragraphs.append(current.strip())

    # Clean up artifacts
    cleaned = []
    for p in paragraphs:
        p = p.replace('\u200f', '').strip()
        p = re.sub(r'\s*Ok\.\s*$', '', p).strip()
        if p:
            cleaned.append(p)

    return cleaned


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Missing YouTube URL or video ID"}))
        sys.exit(1)

    video_id = extract_video_id(sys.argv[1])
    if not video_id:
        print(json.dumps({"success": False, "error": "Could not extract video ID from: " + sys.argv[1]}))
        sys.exit(1)

    try:
        api = YouTubeTranscriptApi()
        transcript = api.fetch(video_id, languages=["ar"])
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

    paragraphs = merge_transcript(transcript)
    text = "\n\n".join(paragraphs)

    print(json.dumps({"success": True, "text": text}, ensure_ascii=False))


if __name__ == "__main__":
    main()
