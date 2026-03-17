#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const matter = require('gray-matter');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const PORT = 3111;
const PROJECT_ROOT = path.join(__dirname, '..');
const FATAWA_DIR = path.join(PROJECT_ROOT, 'content', 'fatawa', 'posts');
const WORKER_URL = 'https://blue-dew-502c.ebrahimalzaabi-seed.workers.dev';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'sk_fatwa_94964aeb7180572d5acb636b0a48c021';
if (!process.env.NOTIFY_EMAIL_PRIMARY || !process.env.NOTIFY_EMAIL_DEV) {
  console.error('NOTIFY_EMAIL_PRIMARY and NOTIFY_EMAIL_DEV must be set in scripts/.env');
  process.exit(1);
}
const NOTIFY_EMAIL_PRIMARY = process.env.NOTIFY_EMAIL_PRIMARY;
const NOTIFY_EMAIL_DEV = process.env.NOTIFY_EMAIL_DEV;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFatwaList() {
  if (!fs.existsSync(FATAWA_DIR)) return [];
  return fs.readdirSync(FATAWA_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const raw = fs.readFileSync(path.join(FATAWA_DIR, f), 'utf8');
      const parsed = matter(raw);
      return {
        id: f.replace('.md', ''),
        title: parsed.data.title || f.replace('.md', ''),
        email: parsed.data.email || '',
        date: parsed.data.date || '',
      };
    })
    .sort((a, b) => (b.id > a.id ? 1 : -1));
}

function runScript(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: PROJECT_ROOT, env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ── Routes ───────────────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Serve admin UI
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildAdminHTML());
    return;
  }

  // API: list fatawa
  if (req.method === 'GET' && url.pathname === '/api/fatawa') {
    const list = getFatwaList();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
    return;
  }

  // API: rebuild search index
  if (req.method === 'POST' && url.pathname === '/api/build-index') {
    const result = await runScript('node', [path.join(__dirname, 'build-search-index.js')]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: result.code === 0, output: result.stdout + result.stderr }));
    return;
  }

  // API: send fatwa notification
  if (req.method === 'POST' && url.pathname === '/api/notify-fatwa') {
    const body = await parseBody(req);
    const { fatwaId, email, dryRun } = body;
    if (!fatwaId || !email) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, output: 'Missing fatwaId or email' }));
      return;
    }

    const scriptArgs = [path.join(__dirname, 'notify-fatwa-answered.js'), fatwaId];
    if (dryRun) scriptArgs.push('--dry-run');
    const child = spawn('node', scriptArgs, {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);

    // The script prompts for email via readline — feed it
    child.stdin.write(email + '\n');
    child.stdin.end();

    child.on('close', code => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: code === 0, output: stdout + stderr }));
    });
    return;
  }

  // API: list pending questions from KV
  if (req.method === 'GET' && url.pathname === '/api/pending-questions') {
    try {
      const resp = await fetch(WORKER_URL + '/questions', {
        headers: { 'Authorization': 'Bearer ' + ADMIN_API_KEY },
      });
      const data = await resp.text();
      res.writeHead(resp.status, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch pending questions: ' + e.message }));
    }
    return;
  }

  // API: delete a pending question from KV
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/pending-questions/')) {
    const qId = url.pathname.replace('/api/pending-questions/', '');
    try {
      const resp = await fetch(WORKER_URL + '/questions/' + qId, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + ADMIN_API_KEY },
      });
      const data = await resp.text();
      res.writeHead(resp.status, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to delete question: ' + e.message }));
    }
    return;
  }

  // API: fetch YouTube transcript via youtube-transcript-api (Python)
  if (req.method === 'POST' && url.pathname === '/api/youtube-transcript') {
    const body = await parseBody(req);
    const ytUrl = (body.url || '').trim();
    if (!ytUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Missing YouTube URL' }));
      return;
    }
    const pythonBin = path.join(__dirname, '.venv', 'bin', 'python3');
    const scriptPath = path.join(__dirname, 'fetch-transcript.py');
    const result = await runScript(pythonBin, [scriptPath, ytUrl]);
    try {
      const data = JSON.parse(result.stdout);
      res.writeHead(data.success ? 200 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: result.stderr || result.stdout || 'Transcript fetch failed' }));
    }
    return;
  }

  // API: get next fatwa ID and categories
  if (req.method === 'GET' && url.pathname === '/api/fatwa-meta') {
    const files = fs.readdirSync(FATAWA_DIR).filter(f => f.endsWith('.md'));
    // Find highest ID
    let maxId = 0;
    const catSet = new Set();
    files.forEach(f => {
      const match = f.match(/-(\d+)\.md$/);
      if (match) maxId = Math.max(maxId, parseInt(match[1], 10));
      const raw = fs.readFileSync(path.join(FATAWA_DIR, f), 'utf8');
      const parsed = matter(raw);
      if (parsed.data.categories) {
        parsed.data.categories.forEach(c => { if (c !== '\u0641\u062a\u0627\u0648\u0649') catSet.add(c); });
      }
    });
    const today = new Date();
    const utcDate = today.getUTCFullYear() + '-' +
      String(today.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(today.getUTCDate()).padStart(2, '0');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      nextId: maxId + 1,
      date: utcDate,
      categories: Array.from(catSet).sort(),
    }));
    return;
  }

  // API: create new fatwa
  if (req.method === 'POST' && url.pathname === '/api/create-fatwa') {
    const body = await parseBody(req);
    const { title, date, categories, youtube, question, answer, email, answer_type } = body;
    if (!title || !date || !question || !answer) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, output: 'Missing required fields (title, date, question, answer)' }));
      return;
    }
    // Get next ID
    const files = fs.readdirSync(FATAWA_DIR).filter(f => f.endsWith('.md'));
    let maxId = 0;
    files.forEach(f => {
      const match = f.match(/-(\d+)\.md$/);
      if (match) maxId = Math.max(maxId, parseInt(match[1], 10));
    });
    const newId = maxId + 1;
    const filename = date + '-' + newId + '.md';
    const filepath = path.join(FATAWA_DIR, filename);

    // Build front matter
    const cats = ['\u0641\u062a\u0627\u0648\u0649', ...(categories || [])];
    const catsYaml = '[' + cats.map(c => '"' + c + '"').join(', ') + ']';

    // Format question/answer paragraphs as <p dir="rtl"> blocks
    function formatParagraphs(text) {
      return text.trim().split(/\n\s*\n|\n/).filter(Boolean)
        .map(p => '    <p dir="rtl">' + p.trim() + '</p>').join('\n\n');
    }

    let fm = '---\n';
    fm += 'title: "' + title.replace(/"/g, '\\"') + '"\n';
    fm += 'date: ' + date + '\n';
    fm += 'draft: false\n';
    fm += 'categories: ' + catsYaml + '\n';
    if (youtube) fm += 'youtube: "' + youtube + '"\n';
    if (email) fm += 'email: "' + email.trim() + '"\n';
    if (answer_type) fm += 'answer_type: "' + answer_type + '"\n';
    fm += 'question: |\n' + formatParagraphs(question) + '\n';
    fm += 'answer: |\n' + formatParagraphs(answer) + '\n';
    fm += '---\n';

    try {
      fs.writeFileSync(filepath, fm, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, output: 'Created: ' + filename, filename, id: newId }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, output: 'Error writing file: ' + e.message }));
    }
    return;
  }

  // API: get single fatwa for editing
  if (req.method === 'GET' && url.pathname.startsWith('/api/fatwa/')) {
    const fatwaId = url.pathname.replace('/api/fatwa/', '');
    const file = fs.readdirSync(FATAWA_DIR).find(f => f === fatwaId + '.md');
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Fatwa not found' }));
      return;
    }
    const raw = fs.readFileSync(path.join(FATAWA_DIR, file), 'utf8');
    const parsed = matter(raw);
    const d = parsed.data;
    // Strip <p dir="rtl"> tags for editing
    function stripPTags(val) {
      if (!val) return '';
      return val.replace(/<p dir="rtl">/g, '').replace(/<\/p>/g, '').replace(/\n{2,}/g, '\n').trim();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: fatwaId,
      title: d.title || '',
      date: d.date instanceof Date ? d.date.toISOString().slice(0, 10) : (d.date || ''),
      youtube: d.youtube || '',
      email: d.email || '',
      answer_type: d.answer_type || '',
      categories: (d.categories || []).filter(c => c !== '\u0641\u062a\u0627\u0648\u0649'),
      question: stripPTags(d.question),
      answer: stripPTags(d.answer),
    }));
    return;
  }

  // API: update existing fatwa
  if (req.method === 'PUT' && url.pathname.startsWith('/api/fatwa/')) {
    const fatwaId = url.pathname.replace('/api/fatwa/', '');
    const file = fs.readdirSync(FATAWA_DIR).find(f => f === fatwaId + '.md');
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, output: 'Fatwa not found' }));
      return;
    }
    const body = await parseBody(req);
    const { title, date, categories, youtube, question, answer, email, answer_type } = body;
    if (!title || !question || !answer) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, output: 'Missing required fields' }));
      return;
    }
    const filepath = path.join(FATAWA_DIR, file);
    const cats = ['\u0641\u062a\u0627\u0648\u0649', ...(categories || [])];
    const catsYaml = '[' + cats.map(c => '"' + c + '"').join(', ') + ']';
    function formatParagraphs(text) {
      return text.trim().split(/\n\s*\n|\n/).filter(Boolean)
        .map(p => '    <p dir="rtl">' + p.trim() + '</p>').join('\n\n');
    }
    let fm = '---\n';
    fm += 'title: "' + title.replace(/"/g, '\\"') + '"\n';
    fm += 'date: ' + (date || fatwaId.substring(0, 10)) + '\n';
    fm += 'draft: false\n';
    fm += 'categories: ' + catsYaml + '\n';
    if (youtube) fm += 'youtube: "' + youtube + '"\n';
    if (email) fm += 'email: "' + email.trim() + '"\n';
    if (answer_type) fm += 'answer_type: "' + answer_type + '"\n';
    fm += 'question: |\n' + formatParagraphs(question) + '\n';
    fm += 'answer: |\n' + formatParagraphs(answer) + '\n';
    fm += '---\n';
    try {
      fs.writeFileSync(filepath, fm, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, output: 'Updated: ' + file }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, output: 'Error: ' + e.message }));
    }
    return;
  }

  // API: delete fatwa
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/fatwa/')) {
    const fatwaId = url.pathname.replace('/api/fatwa/', '');
    const file = fs.readdirSync(FATAWA_DIR).find(f => f === fatwaId + '.md');
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, output: 'Fatwa not found' }));
      return;
    }
    try {
      fs.unlinkSync(path.join(FATAWA_DIR, file));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, output: 'Deleted: ' + file }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, output: 'Error: ' + e.message }));
    }
    return;
  }

  // Serve admin client JS
  if (req.method === 'GET' && url.pathname === '/admin-client.js') {
    const jsPath = path.join(__dirname, 'admin-client.js');
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(fs.readFileSync(jsPath, 'utf8'));
    return;
  }

  // Serve font files for the admin page
  if (req.method === 'GET' && url.pathname.startsWith('/fonts/')) {
    const fontPath = path.join(PROJECT_ROOT, 'static', url.pathname);
    if (fs.existsSync(fontPath)) {
      res.writeHead(200, { 'Content-Type': 'font/woff2' });
      res.end(fs.readFileSync(fontPath));
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// ── Admin HTML ───────────────────────────────────────────────────────────────

function buildAdminHTML() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>لوحة الإدارة</title>
  <style>
    @font-face {
      font-family: 'Noto Naskh Arabic';
      src: url('/fonts/NotoNaskhArabic-arabic.woff2') format('woff2');
      font-weight: 400 700;
      font-style: normal;
      font-display: block;
    }
    @font-face {
      font-family: 'Noto Naskh Arabic';
      src: url('/fonts/NotoNaskhArabic-latin.woff2') format('woff2');
      font-weight: 400 700;
      font-style: normal;
      font-display: block;
    }

    :root {
      --gold: #C5A059;
      --gold-dark: #a8864a;
      --bg: #e0e0e0;
      --card-bg: #ffffff;
      --text: #2c3e50;
      --text-muted: #666;
      --border: #e0e0e0;
      --success: #4caf50;
      --error: #e53935;
      --font: 'Noto Naskh Arabic', 'Traditional Arabic', system-ui, sans-serif;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #000000;
        --card-bg: #2d2d2d;
        --text: #e0e0e0;
        --text-muted: #aaa;
        --border: #444;
      }
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    html, body {
      font-family: var(--font);
      background-color: var(--bg);
      background-image: radial-gradient(rgba(128,128,128,0.3) 1px, transparent 1px);
      background-size: 12px 12px;
      color: var(--text);
      direction: rtl;
      min-height: 100vh;
    }

    .container {
      max-width: 900px;
      margin: 30px auto;
      padding: 0 15px;
    }

    /* Header */
    .admin-header {
      background: linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%);
      border-radius: 12px 12px 0 0;
      padding: 28px 32px;
      text-align: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    }
    .admin-header h1 {
      color: #fff;
      font-size: 1.6rem;
      font-weight: 700;
      text-shadow: 0 2px 4px rgba(0,0,0,0.2);
      margin: 0;
    }
    .admin-header p {
      color: rgba(255,255,255,0.85);
      font-size: 0.95rem;
      margin-top: 6px;
    }

    /* Main body */
    .admin-body {
      background: var(--card-bg);
      padding: 28px 32px 36px;
      border-radius: 0 0 12px 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12);
    }

    /* Section card */
    .section {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 24px;
      margin-bottom: 24px;
      background: var(--card-bg);
      position: relative;
    }
    .section::before {
      content: '';
      position: absolute;
      top: 0; right: 0; bottom: 0;
      width: 4px;
      background: var(--gold);
      border-radius: 0 10px 10px 0;
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 14px;
    }
    .section-title .icon {
      font-size: 1.4rem;
    }
    .section-desc {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-bottom: 18px;
      line-height: 1.7;
    }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 28px;
      border: none;
      border-radius: 8px;
      font-family: var(--font);
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .btn-gold {
      background: linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%);
      color: #fff;
      box-shadow: 0 4px 12px rgba(197,160,89,0.35);
    }
    .btn-gold:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(197,160,89,0.45);
    }
    .btn-outline {
      background: transparent;
      color: var(--gold);
      border: 2px solid var(--gold);
    }
    .btn-outline:hover:not(:disabled) {
      background: var(--gold);
      color: #fff;
    }
    .btn-sm {
      padding: 0.3rem 0.7rem;
      font-size: 0.8rem;
    }

    /* Form elements */
    .form-row {
      display: flex;
      gap: 12px;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }
    .form-group {
      flex: 1;
      min-width: 200px;
    }
    .form-group label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    select, input[type="email"], input[type="text"], textarea {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-family: var(--font);
      font-size: 0.95rem;
      color: var(--text);
      background: var(--card-bg);
      direction: rtl;
      transition: border-color 0.2s;
      box-sizing: border-box;
    }
    textarea {
      min-height: 120px;
      resize: vertical;
      line-height: 1.8;
    }
    select:focus, input[type="email"]:focus, input[type="text"]:focus, textarea:focus {
      outline: none;
      border-color: var(--gold);
      box-shadow: 0 0 0 3px rgba(197,160,89,0.15);
    }

    /* Category tags */
    .cat-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    .cat-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 14px;
      border-radius: 20px;
      font-size: 0.82rem;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text-muted);
      transition: all 0.15s;
      user-select: none;
    }
    .cat-tag:hover { border-color: var(--gold); color: var(--gold); }
    .cat-tag.selected {
      background: var(--gold);
      color: #fff;
      border-color: var(--gold);
    }
    .cat-custom-wrap {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-top: 8px;
    }
    .cat-custom-wrap input {
      flex: 1;
      padding: 7px 12px;
      font-size: 0.85rem;
    }
    .cat-custom-wrap button {
      padding: 7px 16px;
      font-size: 0.82rem;
      white-space: nowrap;
    }

    /* Hint text */
    .field-hint {
      font-size: 0.78rem;
      color: var(--text-muted);
      margin-top: 4px;
    }

    /* ID badge */
    .id-badge {
      display: inline-block;
      background: var(--gold);
      color: #fff;
      padding: 3px 12px;
      border-radius: 12px;
      font-size: 0.85rem;
      font-weight: 600;
      direction: ltr;
    }

    /* Fatwa management list */
    .fatwa-list-wrap {
      margin-bottom: 14px;
    }
    .fatwa-list-search {
      margin-bottom: 12px;
    }
    .fatwa-list {
      max-height: 420px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .fatwa-row {
      display: block;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      transition: background 0.15s;
      cursor: pointer;
    }
    .fatwa-row:last-child { border-bottom: none; }
    .fatwa-row:hover { background: rgba(197,160,89,0.06); }
    .fatwa-row.selected {
      background: rgba(197,160,89,0.12);
      border-right: 3px solid var(--gold);
    }
    .fatwa-row-info {
      flex: 1;
      min-width: 0;
    }
    .fatwa-row-title {
      font-size: 0.9rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .fatwa-row-id {
      font-size: 0.75rem;
      color: var(--text-muted);
      direction: ltr;
      display: inline;
    }

    /* Inline actions inside selected fatwa row */
    .fatwa-row-actions {
      display: none;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
    }
    .fatwa-row.selected .fatwa-row-actions { display: flex; }
    .fatwa-row-actions .btn {
      padding: 7px 16px;
      font-size: 0.82rem;
    }
    .fatwa-row-actions select {
      padding: 7px 12px;
      border-radius: 6px;
      border: 1px solid #ddd;
      font-size: 0.82rem;
      cursor: pointer;
      color: #555;
      width: auto;
    }
    .btn-notify-action {
      background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%);
      color: #fff;
      box-shadow: 0 2px 8px rgba(33,150,243,0.3);
    }
    .btn-notify-action:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(33,150,243,0.4);
    }

    /* Notify inline form */
    .notify-inline {
      display: none;
      margin-top: 14px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--card-bg);
    }
    .notify-inline.visible { display: block; }
    .notify-inline .form-row { margin-bottom: 12px; }
    .notify-inline-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 6px;
    }

    /* Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0,0,0,0.5);
      justify-content: center;
      align-items: flex-start;
      padding: 40px 16px;
      overflow-y: auto;
    }
    .modal-overlay.open { display: flex; }
    .modal {
      background: var(--card-bg);
      border-radius: 12px;
      width: 100%;
      max-width: 700px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.25);
      animation: modalIn 0.2s ease;
    }
    @keyframes modalIn {
      from { opacity: 0; transform: translateY(-20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 24px;
      border-bottom: 1px solid var(--border);
    }
    .modal-header h2 {
      font-size: 1.1rem;
      margin: 0;
    }
    .modal-close {
      background: none;
      border: none;
      font-size: 1.4rem;
      cursor: pointer;
      color: var(--text-muted);
      padding: 4px 8px;
      border-radius: 6px;
      transition: all 0.15s;
    }
    .modal-close:hover { color: var(--error); background: #fff5f5; }
    .modal-body {
      padding: 24px;
    }
    .modal-footer {
      padding: 16px 24px;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 10px;
      justify-content: flex-start;
    }
    .btn-danger {
      background: var(--error);
      color: #fff;
      box-shadow: 0 2px 8px rgba(229,57,53,0.3);
    }
    .btn-danger:hover:not(:disabled) {
      background: #c62828;
    }

    @media (prefers-color-scheme: dark) {
      .fatwa-row:hover { background: rgba(197,160,89,0.1); }
      .modal-close:hover { background: #3a1b1b; }
      .modal { background: #2a2a2a; }
    }

    /* Output console */
    .output-wrap {
      position: relative;
      margin-top: 16px;
      display: none;
    }
    .output-wrap.visible { display: block; }
    .output {
      padding: 14px 18px;
      background: #1e1e1e;
      color: #e0e0e0;
      border-radius: 8px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.82rem;
      line-height: 1.6;
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      direction: ltr;
      text-align: left;
    }
    .output.success { border-right: 3px solid var(--success); }
    .output.error { border-right: 3px solid var(--error); }

    /* Spinner */
    .spinner {
      display: inline-block;
      width: 18px; height: 18px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Status badge */
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 600;
      margin-top: 10px;
    }
    .status-badge.success {
      background: #e8f5e9;
      color: #2e7d32;
      border: 1px solid #a5d6a7;
    }
    .status-badge.error {
      background: #ffebee;
      color: #c62828;
      border: 1px solid #ef9a9a;
    }

    @media (prefers-color-scheme: dark) {
      .section {
        border-color: #444;
        background: #1e1e1e;
      }
      select, input[type="email"] {
        background: #333;
        border-color: #555;
        color: #e0e0e0;
      }
      .status-badge.success { background: #1b3a1b; color: #81c784; border-color: #2e7d32; }
      .status-badge.error   { background: #3a1b1b; color: #ef9a9a; border-color: #c62828; }
    }

    /* Clear icon button -- half outside top-left corner of output box */
    .btn-clear {
      position: absolute;
      top: -13px;
      left: -13px;
      z-index: 2;
      background: #555;
      color: #fff;
      border: 2px solid #1e1e1e;
      width: 28px;
      height: 28px;
      padding: 0;
      border-radius: 50%;
      font-size: 0.85rem;
      font-weight: bold;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-clear:hover {
      background: #e53935;
      border-color: #e53935;
      color: #fff;
    }

    .btn-row {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    /* Searchable combobox */
    .combobox {
      position: relative;
      width: 100%;
    }
    .combobox-input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-family: var(--font);
      font-size: 0.95rem;
      color: var(--text);
      background: var(--card-bg);
      direction: rtl;
      transition: border-color 0.2s;
    }
    .combobox-input:focus {
      outline: none;
      border-color: var(--gold);
      box-shadow: 0 0 0 3px rgba(197,160,89,0.15);
    }
    .combobox-list {
      display: none;
      position: absolute;
      top: 100%;
      right: 0;
      left: 0;
      z-index: 100;
      max-height: 260px;
      overflow-y: auto;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-top: none;
      border-radius: 0 0 8px 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    }
    .combobox.open .combobox-list { display: block; }
    .combobox.open .combobox-input {
      border-radius: 8px 8px 0 0;
    }
    .combobox-item {
      padding: 10px 14px;
      cursor: pointer;
      font-size: 0.9rem;
      line-height: 1.6;
      border-bottom: 1px solid var(--border);
      transition: background 0.15s;
    }
    .combobox-item:last-child { border-bottom: none; }
    .combobox-item:hover,
    .combobox-item.active {
      background: rgba(197,160,89,0.12);
      color: var(--gold-dark);
    }
    .combobox-item .fatwa-id {
      font-size: 0.78rem;
      color: var(--text-muted);
      direction: ltr;
      display: inline;
    }
    .combobox-empty {
      padding: 14px;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.88rem;
    }
    @media (prefers-color-scheme: dark) {
      .combobox-input {
        background: #333;
        border-color: #555;
        color: #e0e0e0;
      }
      .combobox-list {
        background: #333;
        border-color: #555;
      }
      .combobox-item { border-bottom-color: #444; }
      .combobox-item:hover,
      .combobox-item.active {
        background: rgba(197,160,89,0.2);
        color: #d4b06a;
      }
    }

    /* Pending question cards */
    .pq-card {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px 20px;
      margin-bottom: 10px;
      background: var(--card-bg);
      transition: all 0.15s;
      cursor: pointer;
      position: relative;
    }
    .pq-card:hover {
      border-color: var(--gold);
      box-shadow: 0 2px 12px rgba(197,160,89,0.15);
    }
    .pq-card-title {
      font-size: 1rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 6px;
    }
    .pq-card-msg {
      font-size: 0.88rem;
      color: var(--text-muted);
      line-height: 1.7;
      max-height: 80px;
      overflow: hidden;
      margin-bottom: 8px;
    }
    .pq-card-meta {
      font-size: 0.78rem;
      color: var(--text-muted);
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .pq-card-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
    .pq-card-actions .btn {
      padding: 8px 18px;
      font-size: 0.85rem;
    }
    .pq-empty {
      padding: 20px;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.9rem;
    }

    @media (prefers-color-scheme: dark) {
      .pq-card { border-color: #444; background: #1e1e1e; }
      .pq-card:hover { border-color: var(--gold); }
    }

    @media (max-width: 600px) {
      .container { margin: 10px auto; }
      .admin-header { padding: 20px 18px; }
      .admin-body { padding: 18px; }
      .section { padding: 18px; }
      .form-row { flex-direction: column; }
      .btn-row { flex-direction: row; }
      .btn-row .btn-gold { flex: 1; justify-content: center; }
      .btn-row .btn-clear { flex: 0; }
    }

    /* Custom alert dialog */
    .alert-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 2000;
      background: rgba(0,0,0,0.45);
      justify-content: center;
      align-items: center;
    }
    .alert-overlay.open { display: flex; }

    /* Custom confirm dialog */
    .confirm-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 2000;
      background: rgba(0,0,0,0.45);
      justify-content: center;
      align-items: center;
    }
    .confirm-overlay.open { display: flex; }
    .confirm-box {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 28px 32px 20px;
      max-width: 420px;
      width: 90%;
      box-shadow: 0 16px 48px rgba(0,0,0,0.25);
      text-align: center;
      animation: modalIn 0.2s ease;
    }
    .confirm-msg {
      font-size: 1rem;
      line-height: 1.8;
      margin-bottom: 20px;
      color: var(--text);
      direction: rtl;
    }
    .confirm-buttons {
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    .confirm-buttons .btn {
      min-width: 100px;
      justify-content: center;
    }

    @media (prefers-color-scheme: dark) {
      .confirm-box { background: #2a2a2a; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="admin-header">
      <h1>لوحة الإدارة</h1>
      <p>موقع الشيخ إبراهيم سيف الزعابي</p>
    </div>
    <div class="admin-body">

      <!-- 0. Pending Questions from KV -->
      <div class="section" id="pending-section">
        <div class="section-title">
          <span class="icon">&#128233;</span>
          <span>&#1571;&#1587;&#1574;&#1604;&#1577; &#1608;&#1575;&#1585;&#1583;&#1577;</span>
          <span id="pending-count" style="background:var(--gold);color:#fff;padding:2px 10px;border-radius:12px;font-size:0.8rem;margin-right:6px;display:none;">0</span>
        </div>
        <p class="section-desc">&#1575;&#1604;&#1571;&#1587;&#1574;&#1604;&#1577; &#1575;&#1604;&#1605;&#1585;&#1587;&#1604;&#1577; &#1605;&#1606; &#1575;&#1604;&#1605;&#1608;&#1602;&#1593; &#1608;&#1575;&#1604;&#1605;&#1582;&#1586;&#1606;&#1577; &#1601;&#1610; Cloudflare KV. &#1575;&#1590;&#1594;&#1591; &#1593;&#1604;&#1609; &#1587;&#1572;&#1575;&#1604; &#1604;&#1573;&#1606;&#1588;&#1575;&#1569; &#1601;&#1578;&#1608;&#1609; &#1605;&#1606;&#1607; &#1605;&#1576;&#1575;&#1588;&#1585;&#1577;.</p>
        <div id="pending-list" style="margin-bottom:10px;"></div>
        <div class="btn-row">
          <button class="btn btn-outline" onclick="loadPendingQuestions()">&#1578;&#1581;&#1583;&#1610;&#1579;</button>
        </div>
        <div id="pending-status"></div>
      </div>

      <!-- 1. Fatwa Search & Actions (main section) -->
      <div class="section">
        <div class="section-title">
          <span class="icon">&#128203;</span>
          <span>الفتاوى</span>
        </div>
        <p class="section-desc">ابحث واختر فتوى لتعديلها أو حذفها أو إرسال إشعار للسائل.</p>
        <div class="fatwa-list-wrap">
          <input type="text" class="fatwa-list-search" id="manage-search" placeholder="بحث بالعنوان أو الرقم...">
          <div class="fatwa-list" id="manage-list"></div>
        </div>

      </div>

      <!-- 2. Add New Fatwa button -->
      <button class="btn btn-gold" onclick="openAddModal()" style="margin-bottom:24px;">إضافة فتوى جديدة</button>

      <!-- 3. Build Search Index (last) -->
      <div class="section">
        <div class="section-title">
          <span class="icon">&#128269;</span>
          <span>نشر فهرس البحث</span>
        </div>
        <p class="section-desc">إعادة بناء فهرس البحث (Lunr.js) من جميع صفحات المحتوى. استخدم هذا بعد إضافة أو تعديل محتوى الموقع.</p>
        <button class="btn btn-gold" id="btn-build-index" onclick="buildIndex()">
          <span>إعادة بناء الفهرس</span>
        </button>
        <div id="build-status"></div>
        <div class="output-wrap" id="build-output-wrap">
          <button class="btn-clear" onclick="clearBuildResults()" title="مسح النتائج">&#10005;</button>
          <div class="output" id="build-output"></div>
        </div>
      </div>

    </div>
  </div>

  <!-- Edit Modal -->
  <div class="modal-overlay" id="edit-modal">
    <div class="modal">
      <div class="modal-header">
        <h2 id="edit-modal-title">تعديل الفتوى</h2>
        <button class="modal-close" onclick="closeEditModal()">✕</button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="edit-id">
        <div class="form-group" style="margin-bottom:14px;">
          <label>عنوان الفتوى *</label>
          <input type="text" id="edit-title">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>التاريخ (UTC)</label>
            <input type="date" id="edit-date" dir="ltr" style="text-align:left;">
          </div>
          <div class="form-group">
            <label>البريد الإلكتروني للسائل (اختياري)</label>
            <input type="email" id="edit-email" placeholder="example@email.com" dir="ltr" style="text-align:left;">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>رابط يوتيوب (اختياري)</label>
            <input type="text" id="edit-youtube" dir="ltr" style="text-align:left;">
          </div>
        </div>
        <div class="form-group" style="margin-bottom:14px;">
          <label>التصنيفات</label>
          <div class="cat-tags" id="edit-categories"></div>
          <div class="cat-custom-wrap">
            <input type="text" id="edit-cat-custom" placeholder="تصنيف جديد...">
            <button class="btn btn-outline" type="button" onclick="addEditCustomCategory()">إضافة</button>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:14px;">
          <label>السؤال *</label>
          <textarea id="edit-question" rows="4"></textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>الإجابة *</label>
          </div>
          <div class="form-group">
            <label>نوع الإجابة</label>
            <select id="edit-answer-type">
              <option value="">-- بدون --</option>
              <option value="\u0645\u064f\u0641\u0631\u0651\u063a">\u0645\u064f\u0641\u0631\u0651\u063a</option>
              <option value="\u0645\u0643\u062a\u0648\u0628">\u0645\u0643\u062a\u0648\u0628</option>
            </select>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span></span>
            <button type="button" class="btn btn-outline btn-sm" id="btn-edit-transcript" onclick="fetchTranscript('edit-answer', 'edit-youtube', 'edit-answer-type')" disabled>تفريغ من يوتيوب</button>
          </div>
          <textarea id="edit-answer" rows="8"></textarea>
        </div>
        <div id="edit-status"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-gold" id="btn-save-edit" onclick="saveEdit()">حفظ التعديلات</button>
        <button class="btn btn-danger" id="btn-delete-fatwa" onclick="confirmDelete()">حذف الفتوى</button>
      </div>
    </div>
  </div>

  <!-- Notify Modal -->
  <div class="modal-overlay" id="notify-modal">
    <div class="modal">
      <div class="modal-header">
        <h2 id="notify-modal-title">&#128233; &#1573;&#1585;&#1587;&#1575;&#1604; &#1573;&#1588;&#1593;&#1575;&#1585;</h2>
        <button class="modal-close" onclick="closeNotifyModal()">&#10005;</button>
      </div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom:14px;">
          <label>&#1575;&#1604;&#1576;&#1585;&#1610;&#1583; &#1575;&#1604;&#1573;&#1604;&#1603;&#1578;&#1585;&#1608;&#1606;&#1610; &#1604;&#1604;&#1587;&#1575;&#1574;&#1604;</label>
          <input type="email" id="fatwa-email" placeholder="example@email.com" dir="ltr" style="text-align:left;">
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin:8px 0 12px;cursor:pointer;font-size:0.85rem;color:var(--text-muted);">
          <input type="checkbox" id="notify-dry-run" checked>
          <span>Dry Run</span>
          <span style="font-size:0.78rem;color:#999;">(BCC only to ${NOTIFY_EMAIL_DEV}, exclude ${NOTIFY_EMAIL_PRIMARY})</span>
        </label>
        <div id="notify-status"></div>
        <div class="output-wrap" id="notify-output-wrap">
          <button class="btn-clear" onclick="clearNotifyResults()" title="&#1605;&#1587;&#1581; &#1575;&#1604;&#1606;&#1578;&#1575;&#1574;&#1580;">&#10005;</button>
          <div class="output" id="notify-output"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-notify-action" id="btn-notify" onclick="notifyFatwa()">&#1573;&#1585;&#1587;&#1575;&#1604;</button>
      </div>
    </div>
  </div>

  <!-- Add Fatwa Modal -->
  <div class="modal-overlay" id="add-modal">
    <div class="modal">
      <div class="modal-header">
        <h2>إضافة فتوى جديدة <span class="id-badge" id="new-fatwa-id">...</span></h2>
        <button class="modal-close" onclick="closeAddModal()">&#10005;</button>
      </div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom:14px;">
          <label>عنوان الفتوى *</label>
          <input type="text" id="nf-title" placeholder="مثال: حكم صلاة النوافل للمسافر">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>التاريخ (UTC)</label>
            <input type="date" id="nf-date" dir="ltr" style="text-align:left;">
          </div>
          <div class="form-group">
            <label>البريد الإلكتروني للسائل (اختياري)</label>
            <input type="email" id="nf-email" placeholder="example@email.com" dir="ltr" style="text-align:left;">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>رابط يوتيوب (اختياري)</label>
            <input type="text" id="nf-youtube" placeholder="https://www.youtube.com/watch?v=..." dir="ltr" style="text-align:left;">
          </div>
        </div>
        <div class="form-group" style="margin-bottom:14px;">
          <label>التصنيفات</label>
          <div class="cat-tags" id="nf-categories"></div>
          <div class="cat-custom-wrap">
            <input type="text" id="nf-cat-custom" placeholder="تصنيف جديد...">
            <button class="btn btn-outline" type="button" onclick="addCustomCategory()">إضافة</button>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:14px;">
          <label>السؤال *</label>
          <textarea id="nf-question" placeholder="نص السؤال هنا... كل سطر سيصبح فقرة منفصلة" rows="4"></textarea>
          <div class="field-hint">كل سطر (أو سطر فارغ) يفصل فقرة جديدة تلقائيًا.</div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>الإجابة *</label>
          </div>
          <div class="form-group">
            <label>نوع الإجابة</label>
            <select id="nf-answer-type">
              <option value="">-- بدون --</option>
              <option value="\u0645\u064f\u0641\u0631\u0651\u063a">\u0645\u064f\u0641\u0631\u0651\u063a</option>
              <option value="\u0645\u0643\u062a\u0648\u0628">\u0645\u0643\u062a\u0648\u0628</option>
            </select>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span></span>
            <button type="button" class="btn btn-outline btn-sm" id="btn-nf-transcript" onclick="fetchTranscript('nf-answer', 'nf-youtube', 'nf-answer-type')" disabled>تفريغ من يوتيوب</button>
          </div>
          <textarea id="nf-answer" placeholder="نص الإجابة هنا... كل سطر سيصبح فقرة منفصلة" rows="8"></textarea>
          <div class="field-hint">كل سطر (أو سطر فارغ) يفصل فقرة جديدة تلقائيًا.</div>
        </div>
        <div id="create-status"></div>
        <div class="output-wrap" id="create-output-wrap">
          <button class="btn-clear" onclick="clearCreateResults()" title="مسح النتائج">&#10005;</button>
          <div class="output" id="create-output"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-gold" id="btn-create-fatwa" onclick="createFatwa()">إنشاء الفتوى</button>
      </div>
    </div>
  </div>

  <!-- Alert dialog -->
  <div class="alert-overlay" id="alert-overlay">
    <div class="confirm-box">
      <div class="confirm-msg" id="alert-msg"></div>
      <div class="confirm-buttons">
        <button class="btn btn-gold" id="alert-ok">&#1581;&#1587;&#1606;&#1611;&#1575;</button>
      </div>
    </div>
  </div>

  <!-- Confirm dialog -->
  <div class="confirm-overlay" id="confirm-overlay">
    <div class="confirm-box">
      <div class="confirm-msg" id="confirm-msg"></div>
      <div class="confirm-buttons">
        <button class="btn btn-danger" id="confirm-yes">&#1606;&#1593;&#1605;</button>
        <button class="btn btn-outline" id="confirm-no">&#1573;&#1604;&#1594;&#1575;&#1569;</button>
      </div>
    </div>
  </div>

  <script src="/admin-client.js"></script>
</body>
</html>`;
}

// ── Start Server ─────────────────────────────────────────────────────────────

const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log('\n  Admin panel running at http://localhost:' + PORT + '\n');
});
