#!/usr/bin/env node

/**
 * Fatwa CLI — AI-agent-friendly command-line interface for fatwa management.
 *
 * Usage:
 *   node scripts/fatwa-cli.js meta
 *   node scripts/fatwa-cli.js list [--limit N]
 *   node scripts/fatwa-cli.js get <id>
 *   node scripts/fatwa-cli.js delete <id>
 *   node scripts/fatwa-cli.js transcript <youtube-url> [--save /tmp/file.txt]
 *   node scripts/fatwa-cli.js prepare <youtube-url>
 *   node scripts/fatwa-cli.js create --title "..." --question "..." --answer "..." [options]
 *   node scripts/fatwa-cli.js create --title "..." --question "..." --answer-file /tmp/transcript.txt [options]
 *   node scripts/fatwa-cli.js update <id> --title "..." --question "..." --answer "..." [options]
 *   node scripts/fatwa-cli.js build-index
 *
 * All output is JSON for easy machine consumption.
 */

const fs = require('fs');
const path = require('path');
const lib = require('./fatwa-lib');

// ── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] || '';
  const positional = [];
  const flags = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      // Check if next arg is a value (not another flag)
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(args[i]);
    }
  }

  return { command, positional, flags };
}

function out(data) {
  console.log(JSON.stringify(data, null, 2));
}

function fail(message) {
  out({ success: false, error: message });
  process.exit(1);
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdMeta() {
  out(lib.getFatwaMeta());
}

async function cmdList(flags) {
  const list = lib.getFatwaList();
  const limit = flags.limit ? parseInt(flags.limit, 10) : 0;
  out(limit ? list.slice(0, limit) : list);
}

async function cmdGet(positional) {
  const id = positional[0];
  if (!id) fail('Usage: fatwa-cli get <id>');
  const fatwa = lib.getFatwa(id);
  if (!fatwa) fail('Fatwa not found: ' + id);
  out(fatwa);
}

async function cmdDelete(positional) {
  const id = positional[0];
  if (!id) fail('Usage: fatwa-cli delete <id>');
  const result = lib.deleteFatwa(id);
  out(result);
  if (!result.success) process.exit(1);
}

async function cmdTranscript(positional, flags) {
  const url = positional[0];
  if (!url) fail('Usage: fatwa-cli transcript <youtube-url> [--save /path/to/file.txt]');

  const result = await lib.fetchTranscript(url);
  if (!result.success) {
    out(result);
    process.exit(1);
  }

  if (flags.save) {
    fs.writeFileSync(flags.save, result.text, 'utf8');
    out({ success: true, saved: flags.save, chars: result.text.length });
  } else {
    out(result);
  }
}

async function cmdPrepare(positional, flags) {
  const url = positional[0];
  if (!url) fail('Usage: fatwa-cli prepare <youtube-url>');

  // Fetch title and transcript in parallel
  const [titleResult, transcriptResult, meta] = await Promise.all([
    lib.fetchVideoTitle(url),
    lib.fetchTranscript(url),
    Promise.resolve(lib.getFatwaMeta()),
  ]);

  if (!transcriptResult.success) {
    fail('Transcript fetch failed: ' + (transcriptResult.error || 'unknown'));
  }

  // Save full transcript to temp file
  const videoIdMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  const videoId = videoIdMatch ? videoIdMatch[1] : 'unknown';
  const tmpFile = path.join('/tmp', 'fatwa_transcript_' + videoId + '.txt');
  fs.writeFileSync(tmpFile, transcriptResult.text, 'utf8');

  out({
    success: true,
    youtube: url,
    title: titleResult.success ? titleResult.cleanTitle : null,
    date: meta.date,
    categories: meta.categories,
    transcript: { savedTo: tmpFile },
  });
}

async function cmdCreate(flags) {
  const title = flags.title;
  const question = flags.question;
  let answer = flags.answer || '';

  // Support reading answer from file (for full transcript without loading into agent context)
  if (flags['answer-file']) {
    const filePath = flags['answer-file'];
    if (!fs.existsSync(filePath)) fail('Answer file not found: ' + filePath);
    answer = fs.readFileSync(filePath, 'utf8');
  }

  if (!title) fail('--title is required');
  if (!question) fail('--question is required');
  if (!answer) fail('--answer or --answer-file is required');

  const date = flags.date || lib.getFatwaMeta().date;
  const categories = flags.categories ? flags.categories.split(',').map(c => c.trim()) : [];

  const result = lib.createFatwa({
    title,
    date,
    categories,
    youtube: flags.youtube || '',
    question,
    answer,
    email: flags.email || '',
    answer_type: flags['answer-type'] || '',
  });

  out(result);
  if (!result.success) process.exit(1);
}

async function cmdUpdate(positional, flags) {
  const id = positional[0];
  if (!id) fail('Usage: fatwa-cli update <id> --title "..." --question "..." --answer "..."');

  // Load existing fatwa to merge with provided flags
  const existing = lib.getFatwa(id);
  if (!existing) fail('Fatwa not found: ' + id);

  let answer = flags.answer || '';
  if (flags['answer-file']) {
    const filePath = flags['answer-file'];
    if (!fs.existsSync(filePath)) fail('Answer file not found: ' + filePath);
    answer = fs.readFileSync(filePath, 'utf8');
  }

  const result = lib.updateFatwa(id, {
    title: flags.title || existing.title,
    date: flags.date || existing.date,
    categories: flags.categories ? flags.categories.split(',').map(c => c.trim()) : existing.categories,
    youtube: flags.youtube !== undefined ? flags.youtube : existing.youtube,
    question: flags.question || existing.question,
    answer: answer || existing.answer,
    email: flags.email !== undefined ? flags.email : existing.email,
    answer_type: flags['answer-type'] !== undefined ? flags['answer-type'] : existing.answer_type,
  });

  out(result);
  if (!result.success) process.exit(1);
}

async function cmdBuildIndex() {
  const result = await lib.buildSearchIndex();
  out({ success: result.code === 0, output: result.stdout + result.stderr });
  if (result.code !== 0) process.exit(1);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { command, positional, flags } = parseArgs(process.argv);

  switch (command) {
    case 'meta':        return cmdMeta();
    case 'list':        return cmdList(flags);
    case 'get':         return cmdGet(positional);
    case 'delete':      return cmdDelete(positional);
    case 'transcript':  return cmdTranscript(positional, flags);
    case 'prepare':     return cmdPrepare(positional, flags);
    case 'create':      return cmdCreate(flags);
    case 'update':      return cmdUpdate(positional, flags);
    case 'build-index': return cmdBuildIndex();
    default:
      out({
        error: 'Unknown command: ' + (command || '(none)'),
        usage: [
          'meta                              — next ID, date, categories',
          'list [--limit N]                   — list all fatawa',
          'get <id>                           — get single fatwa',
          'delete <id>                        — delete fatwa',
          'transcript <url> [--save FILE]     — fetch YouTube transcript',
          'prepare <url>                      — fetch title + transcript summary (token-efficient)',
          'create --title T --question Q --answer A | --answer-file F [--date D] [--categories C1,C2] [--youtube URL] [--email E] [--answer-type T]',
          'update <id> [same flags as create] — update existing fatwa',
          'build-index                        — rebuild Lunr.js search index',
        ],
      });
      process.exit(1);
  }
}

main().catch(e => {
  fail(e.message);
});
