/**
 * Shared fatwa logic — used by both admin-server.js and fatwa-cli.js
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const matter = require('gray-matter');

const PROJECT_ROOT = path.join(__dirname, '..');
const FATAWA_DIR = path.join(PROJECT_ROOT, 'content', 'fatawa', 'posts');
const SCRIPTS_DIR = __dirname;

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function formatParagraphs(text) {
  return text.trim().split(/\n\s*\n|\n/).filter(Boolean)
    .map(p => '    <p dir="rtl">' + p.trim() + '</p>').join('\n\n');
}

function stripPTags(val) {
  if (!val) return '';
  return val.replace(/<p dir="rtl">/g, '').replace(/<\/p>/g, '').replace(/\n{2,}/g, '\n').trim();
}

function getTodayUTC() {
  const today = new Date();
  return today.getUTCFullYear() + '-' +
    String(today.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(today.getUTCDate()).padStart(2, '0');
}

function scanFatawa() {
  if (!fs.existsSync(FATAWA_DIR)) return [];
  return fs.readdirSync(FATAWA_DIR).filter(f => f.endsWith('.md'));
}

function getMaxId(files) {
  let maxId = 0;
  files.forEach(f => {
    const match = f.match(/-(\d+)\.md$/);
    if (match) maxId = Math.max(maxId, parseInt(match[1], 10));
  });
  return maxId;
}

// ── Public API ───────────────────────────────────────────────────────────────

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

function getFatwaMeta() {
  const files = scanFatawa();
  const maxId = getMaxId(files);
  const catSet = new Set();
  files.forEach(f => {
    const raw = fs.readFileSync(path.join(FATAWA_DIR, f), 'utf8');
    const parsed = matter(raw);
    if (parsed.data.categories) {
      parsed.data.categories.forEach(c => { if (c !== '\u0641\u062a\u0627\u0648\u0649') catSet.add(c); });
    }
  });
  return {
    nextId: maxId + 1,
    date: getTodayUTC(),
    categories: Array.from(catSet).sort(),
  };
}

function getFatwa(fatwaId) {
  const file = scanFatawa().find(f => f === fatwaId + '.md');
  if (!file) return null;
  const raw = fs.readFileSync(path.join(FATAWA_DIR, file), 'utf8');
  const parsed = matter(raw);
  const d = parsed.data;
  return {
    id: fatwaId,
    title: d.title || '',
    date: d.date instanceof Date ? d.date.toISOString().slice(0, 10) : (d.date || ''),
    youtube: d.youtube || '',
    email: d.email || '',
    answer_type: d.answer_type || '',
    categories: (d.categories || []).filter(c => c !== '\u0641\u062a\u0627\u0648\u0649'),
    question: stripPTags(d.question),
    answer: stripPTags(d.answer),
  };
}

function createFatwa({ title, date, categories, youtube, question, answer, email, answer_type }) {
  if (!title || !date || !question || !answer) {
    return { success: false, output: 'Missing required fields (title, date, question, answer)' };
  }
  const files = scanFatawa();
  const maxId = getMaxId(files);
  const newId = maxId + 1;
  const filename = date + '-' + newId + '.md';
  const filepath = path.join(FATAWA_DIR, filename);

  const cats = ['\u0641\u062a\u0627\u0648\u0649', ...(categories || [])];
  const catsYaml = '[' + cats.map(c => '"' + c + '"').join(', ') + ']';

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
    return { success: true, output: 'Created: ' + filename, filename, id: newId };
  } catch (e) {
    return { success: false, output: 'Error writing file: ' + e.message };
  }
}

function updateFatwa(fatwaId, { title, date, categories, youtube, question, answer, email, answer_type }) {
  const file = scanFatawa().find(f => f === fatwaId + '.md');
  if (!file) return { success: false, output: 'Fatwa not found' };
  if (!title || !question || !answer) {
    return { success: false, output: 'Missing required fields' };
  }
  const filepath = path.join(FATAWA_DIR, file);
  const cats = ['\u0641\u062a\u0627\u0648\u0649', ...(categories || [])];
  const catsYaml = '[' + cats.map(c => '"' + c + '"').join(', ') + ']';

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
    return { success: true, output: 'Updated: ' + file };
  } catch (e) {
    return { success: false, output: 'Error: ' + e.message };
  }
}

function deleteFatwa(fatwaId) {
  const file = scanFatawa().find(f => f === fatwaId + '.md');
  if (!file) return { success: false, output: 'Fatwa not found' };
  try {
    fs.unlinkSync(path.join(FATAWA_DIR, file));
    return { success: true, output: 'Deleted: ' + file };
  } catch (e) {
    return { success: false, output: 'Error: ' + e.message };
  }
}

async function fetchTranscript(youtubeUrl) {
  const pythonBin = path.join(SCRIPTS_DIR, '.venv', 'bin', 'python3');
  const scriptPath = path.join(SCRIPTS_DIR, 'fetch-transcript.py');
  const result = await runScript(pythonBin, [scriptPath, youtubeUrl]);
  try {
    return JSON.parse(result.stdout);
  } catch (e) {
    return { success: false, error: result.stderr || result.stdout || 'Transcript fetch failed' };
  }
}

async function fetchVideoTitle(youtubeUrl) {
  const oembedUrl = 'https://www.youtube.com/oembed?url=' + encodeURIComponent(youtubeUrl) + '&format=json';
  try {
    const res = await fetch(oembedUrl);
    if (!res.ok) return { success: false, error: 'oembed HTTP ' + res.status };
    const data = await res.json();
    const rawTitle = data.title || '';
    // Strip numeric prefix like "008 " from title
    const cleanTitle = rawTitle.replace(/^\d+\s+/, '');
    return { success: true, rawTitle, cleanTitle };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function buildSearchIndex() {
  return runScript('node', [path.join(SCRIPTS_DIR, 'build-search-index.js')]);
}

module.exports = {
  PROJECT_ROOT,
  FATAWA_DIR,
  SCRIPTS_DIR,
  runScript,
  formatParagraphs,
  stripPTags,
  getFatwaList,
  getFatwaMeta,
  getFatwa,
  createFatwa,
  updateFatwa,
  deleteFatwa,
  fetchTranscript,
  fetchVideoTitle,
  buildSearchIndex,
};
