const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SNAPSHOT_DIR = process.env.PARSER_SNAPSHOT_DIR
  ? path.resolve(process.env.PARSER_SNAPSHOT_DIR)
  : path.join(__dirname, '..', 'storage', 'parser-page-snapshots');

const MAX_FULL_HTML_CHARS = Math.min(
  Math.max(parseInt(process.env.PARSER_SNAPSHOT_MAX_CHARS, 10) || 2000000, 50000),
  5000000
);

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[A-Za-z0-9_-]{32,})\b/g, '[token]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[number]')
    .replace(/\b(?:authorization|bearer|csrf|xsrf|token|jwt|secret|password|passwd|pass|apikey|api_key)\s*[:=]\s*["']?[^"'\s<]{8,}/gi, '$1=[redacted]');
}

function cleanFullPageHtml(value) {
  const raw = String(value || '');
  const truncated = raw.length > MAX_FULL_HTML_CHARS;
  const html = redactSensitiveText(raw)
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s(value|data-token|data-auth|data-key|data-secret|data-email|data-user|data-password|aria-valuetext)\s*=\s*(['"]).*?\2/gi, ' $1="[redacted]"')
    .substring(0, MAX_FULL_HTML_CHARS);

  return { html, originalChars: raw.length, storedChars: html.length, truncated };
}

function safeHeader(value, max = 500) {
  return String(value || '').replace(/[\r\n]+/g, ' ').substring(0, max);
}

async function storeParserSnapshotHtml({ html, url = '', platform = '', source = '', outcome = '', userId = '' } = {}) {
  const cleaned = cleanFullPageHtml(html);
  if (!cleaned.html.trim()) return null;

  await fs.promises.mkdir(SNAPSHOT_DIR, { recursive: true });
  const id = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  const filename = `${id}.txt`;
  const filePath = path.join(SNAPSHOT_DIR, filename);
  const content = [
    'QuizSolver parser diagnostic page snapshot',
    `Created: ${new Date().toISOString()}`,
    `URL: ${safeHeader(url)}`,
    `Platform: ${safeHeader(platform, 120)}`,
    `Source: ${safeHeader(source, 80)}`,
    `Outcome: ${safeHeader(outcome, 40)}`,
    `User ID: ${safeHeader(userId, 80)}`,
    `Original chars: ${cleaned.originalChars}`,
    `Stored chars: ${cleaned.storedChars}`,
    `Truncated: ${cleaned.truncated ? 'yes' : 'no'}`,
    '',
    cleaned.html
  ].join('\n');

  await fs.promises.writeFile(filePath, content, 'utf8');
  return {
    id,
    filename,
    bytes: Buffer.byteLength(content, 'utf8'),
    truncated: cleaned.truncated,
    capturedAt: new Date()
  };
}

function snapshotFilePath(fileId = '') {
  const id = String(fileId || '');
  if (!/^[a-z0-9-]{20,80}$/i.test(id)) return '';
  return path.join(SNAPSHOT_DIR, `${id}.txt`);
}

async function sendParserSnapshotFile(res, fileId = '') {
  const filePath = snapshotFilePath(fileId);
  if (!filePath) return res.status(400).json({ error: 'Invalid snapshot file id.' });

  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch {
    return res.status(404).json({ error: 'Snapshot file not found.' });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="parser-page-${fileId}.txt"`);
  return res.sendFile(filePath);
}

module.exports = {
  MAX_FULL_HTML_CHARS,
  storeParserSnapshotHtml,
  sendParserSnapshotFile
};
