#!/usr/bin/env node

// Build a JSON index of all content pages for Lunr.js search
// Inspired by https://gist.github.com/sebz/efddfc8fdcb6b480f567

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const removeMd = require("remove-markdown");

// Absolute path to the "content" directory of Hugo
const CONTENT_DIR = path.join(__dirname, "..", "content");
// Where we will store the generated index so that Hugo can publish it as a plain file
const OUTPUT_FILE = path.join(__dirname, "..", "static", "js", "lunr", "PagesIndex.json");

// Ensure the output directory exists
fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });

const pagesIndex = [];

function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(dir, entry.name);

    // Skip hidden files & folders (like .DS_Store)
    if (entry.name.startsWith(".")) return;

    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".md") || entry.name.endsWith(".html")) {
        const doc = processFile(fullPath, entry.name);
        if (doc) pagesIndex.push(doc);
      }
    }
  });
}

function buildHref(absPath) {
  // Remove the content dir prefix and file extension
  let href = absPath.replace(CONTENT_DIR, "").replace(/\\/g, "/");

  if (href.endsWith("index.md")) {
    href = href.slice(0, -"index.md".length);
  } else if (href.endsWith(".md")) {
    href = href.slice(0, -3); // remove .md
  } else if (href.endsWith(".html")) {
    href = href.slice(0, -5); // remove .html
  }

  // Ensure the href starts with a slash so it is an absolute URL on the site
  if (!href.startsWith("/")) href = "/" + href;

  return href;
}

function removeDiacritics(str) {
  return str.replace(/[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED]/g, "");
}

function cleanContent(rawContent) {
  // Remove simple HTML tags with a regex first (since markdown may contain inline HTML)
  const withoutHtml = rawContent.replace(/<[^>]*>/g, " ");
  // Strip markdown syntax
  const withoutMd = removeMd(withoutHtml);
  // Replace punctuation (Arabic and Latin) with spaces to improve tokenization
  const withoutPunct = withoutMd.replace(/[\.,!\?؛،:؛\-]/g, " ");
  const withoutDiac = removeDiacritics(withoutPunct);
  return withoutDiac.replace(/\s+/g, " ").trim();
}

function processFile(absPath, filename) {
  const raw = fs.readFileSync(absPath, "utf8");

  // Markdown files – use front-matter
  if (filename.endsWith(".md")) {
    const parsed = matter(raw);
    const rawTitle = parsed.data.title || path.basename(filename, ".md");
    const title = removeDiacritics(rawTitle);
    const tags = parsed.data.tags || parsed.data.categories || [];

    // Combine all string fields from front-matter (e.g., question, answer, description …) with markdown body
    const fmText = Object.values(parsed.data)
      .filter((v) => typeof v === "string")
      .join(" ");

    const combined = `${fmText}\n${parsed.content}`;

    return {
      title,
      tags,
      href: buildHref(absPath),
      content: cleanContent(combined),
    };
  }

  // HTML files – take file name as title
  if (filename.endsWith(".html")) {
    const title = path.basename(filename, ".html");
    return {
      title,
      tags: [],
      href: buildHref(absPath),
      content: cleanContent(raw),
    };
  }

  return null;
}

console.log("Building Lunr index from content directory:", CONTENT_DIR);
walk(CONTENT_DIR);

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(pagesIndex, null, 2));
console.log(`✅ Indexed ${pagesIndex.length} pages → ${OUTPUT_FILE}`); 