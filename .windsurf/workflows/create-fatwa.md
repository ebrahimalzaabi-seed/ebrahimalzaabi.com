---
description: Create a new fatwa from a YouTube video URL using the fatwa CLI. Use when the user says "create fatwa" or "publish fatwa" or provides a YouTube link for a new fatwa.
---

## Step 1: Prepare

// turbo
```bash
node scripts/fatwa-cli.js prepare 'YOUTUBE_URL'
```

Returns `title`, `date`, `categories`, and `transcript.savedTo`.

## Step 2: Create

Use `title` as the question (adjust phrasing naturally, e.g. "ما حكم..." or "هل يجوز...").  Remove any latin characters or numbers from the title like 001, 002, etc.

Pick category from `categories` (`فتاوى عامة` if no match). If the user asked for a dry run, show a summary and confirm before running.

// turbo
```bash
node scripts/fatwa-cli.js create \
  --title "TITLE" \
  --question "QUESTION" \
  --answer-file TRANSCRIPT_FILE_PATH \
  --youtube "YOUTUBE_URL" \
  --categories "CAT1,CAT2" \
  --answer-type "مُفرّغ" \
  --date "YYYY-MM-DD"
```

Add `--email` only if the user provides one. Report the output (filename, ID, title, category).
