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

const SNAPSHOT_DIR_RESOLVED = path.resolve(SNAPSHOT_DIR);

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[A-Za-z0-9_-]{32,})\b/g, '[token]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[number]')
    .replace(/\b(?:authorization|bearer|csrf|xsrf|token|jwt|secret|password|passwd|pass|apikey|api_key)\s*[:=]\s*["']?[^"'\s<]{8,}/gi, '$1=[redacted]');
}

function normalizeTextPayload(value) {
  return String(value || '')
    .replace(/\0/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');
}

function isPlausibleHtml(value) {
  const sample = String(value || '').slice(0, 200000).toLowerCase();
  if (!/<[a-z!/][\s\S]*?>/.test(sample)) return false;
  const structuralTags = sample.match(/<\/?(?:html|body|main|form|div|section|article|fieldset|legend|label|input|button|select|textarea|span|p|h[1-6])\b/g) || [];
  return structuralTags.length >= 2 || /<(?:html|body)\b/.test(sample);
}

function defangExecutableHtml(value) {
  return String(value || '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '<script data-qs-removed="true">[removed script]</script>')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '<style data-qs-removed="true">[removed style]</style>')
    .replace(/<(iframe|object|embed|applet)\b[\s\S]*?<\/\1\s*>/gi, '<$1 data-qs-removed="true">[removed $1]</$1>')
    .replace(/<(iframe|object|embed|applet|base|link|meta)\b[^>]*\/?>/gi, '<$1 data-qs-removed="true">[removed $1]</$1>')
    .replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, '')
    .replace(/\s(src|srcset|href|xlink:href|poster|data|formaction|action|srcdoc)\s*=\s*(['"])[\s\S]*?\2/gi, ' $1="[removed]"')
    .replace(/\sstyle\s*=\s*(['"])[\s\S]*?\1/gi, ' style="[removed]"')
    .replace(/\s(value|data-token|data-auth|data-key|data-secret|data-email|data-user|data-password|aria-valuetext)\s*=\s*(['"])[\s\S]*?\2/gi, ' $1="[redacted]"');
}

function cleanFullPageHtml(value) {
  const raw = normalizeTextPayload(value);
  if (!isPlausibleHtml(raw)) {
    return { html: '', originalChars: raw.length, storedChars: 0, truncated: false, rejected: 'not-html' };
  }
  const truncated = raw.length > MAX_FULL_HTML_CHARS;
  const html = redactSensitiveText(defangExecutableHtml(raw))
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
    'Security: saved as text/plain attachment, executable tags and remote-loading attributes removed.',
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
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');

  await fs.promises.writeFile(filePath, content, 'utf8');
  return {
    id,
    filename,
    bytes: Buffer.byteLength(content, 'utf8'),
    sha256,
    truncated: cleaned.truncated,
    capturedAt: new Date()
  };
}

function snapshotFilePath(fileId = '') {
  const id = String(fileId || '');
  if (!/^[a-z0-9-]{20,80}$/i.test(id)) return '';
  const filePath = path.resolve(SNAPSHOT_DIR, `${id}.txt`);
  if (!filePath.startsWith(`${SNAPSHOT_DIR_RESOLVED}${path.sep}`)) return '';
  return filePath;
}

async function sendParserSnapshotFile(res, fileId = '') {
  const filePath = snapshotFilePath(fileId);
  if (!filePath) return res.status(400).json({ error: 'Invalid snapshot file id.' });

  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch {
    return res.status(404).json({ error: 'Snapshot file not found.' });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="parser-page-${fileId}.txt"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Download-Options', 'noopen');
  return res.sendFile(filePath);
}

module.exports = {
  MAX_FULL_HTML_CHARS,
  storeParserSnapshotHtml,
  sendParserSnapshotFile
};
