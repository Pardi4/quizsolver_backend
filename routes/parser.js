const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const ParserEvent = require('../models/ParserEvent');
const BugReport = require('../models/BugReport');
const { storeParserSnapshotHtml } = require('../utils/parserSnapshotFiles');

const router = express.Router();
router.use(authMiddleware);

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[A-Za-z0-9_-]{32,})\b/g, '[token]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[number]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]');
}

function cleanText(value, max = 500) {
  return redactSensitiveText(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, max);
}

function cleanHtml(value, max = 12000) {
  return redactSensitiveText(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s(value|data-token|data-auth|data-key|data-secret|data-email|data-user|data-password|aria-valuetext)\s*=\s*(['"]).*?\2/gi, ' $1="[redacted]"')
    .replace(/\s(?:src|href)\s*=\s*(['"])(?!#|\/|\.\/).*?\1/gi, '')
  )
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, max);
}

function cleanToken(value, max = 80) {
  return String(value || '')
    .replace(/[^a-z0-9_.:-]/gi, '')
    .substring(0, max) || '';
}

function cleanUrl(value) {
  const raw = String(value || '');
  if (!raw) return { url: '', hostname: '' };
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return { url: '', hostname: '' };
    return {
      url: `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`.substring(0, 500),
      hostname: parsed.hostname.substring(0, 180)
    };
  } catch {
    return { url: raw.split('?')[0].split('#')[0].substring(0, 500), hostname: '' };
  }
}

function cleanStringArray(value, maxItems = 12, maxLength = 220) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => cleanText(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function cleanSnapshot(snapshot = {}) {
  const selectorSummary = snapshot && typeof snapshot.selectorSummary === 'object' && !Array.isArray(snapshot.selectorSummary)
    ? Object.fromEntries(Object.entries(snapshot.selectorSummary).slice(0, 30).map(([key, value]) => [
        cleanToken(key, 60),
        Number.isFinite(Number(value)) ? Number(value) : cleanText(value, 80)
      ]))
    : {};

  return {
    title: cleanText(snapshot.title, 180),
    bodyText: cleanText(snapshot.bodyText, 8000),
    htmlSnippet: cleanHtml(snapshot.htmlSnippet, 12000),
    questionTexts: cleanStringArray(snapshot.questionTexts, 8, 300),
    optionsSample: cleanStringArray(snapshot.optionsSample, 20, 180),
    selectorSummary,
    fullHtmlFile: snapshot.fullHtmlFile && typeof snapshot.fullHtmlFile === 'object' ? {
      id: cleanToken(snapshot.fullHtmlFile.id || '', 100),
      filename: cleanText(snapshot.fullHtmlFile.filename || '', 140),
      bytes: Math.max(0, Number(snapshot.fullHtmlFile.bytes || 0)),
      truncated: Boolean(snapshot.fullHtmlFile.truncated),
      capturedAt: snapshot.fullHtmlFile.capturedAt || null
    } : undefined
  };
}

function cleanOutcome(value) {
  return ['success', 'partial', 'empty', 'weak', 'error', 'reported'].includes(value) ? value : 'empty';
}

function hasUsefulSnapshot(snapshot = {}) {
  return Boolean(
    snapshot.htmlSnippet ||
    snapshot.bodyText ||
    snapshot.fullHtmlFile?.id ||
    (Array.isArray(snapshot.questionTexts) && snapshot.questionTexts.length) ||
    (Array.isArray(snapshot.optionsSample) && snapshot.optionsSample.length)
  );
}

function shouldAutoReportParserEvent(event) {
  return Boolean(
    event?.url &&
    ['empty', 'weak', 'error'].includes(event.outcome) &&
    hasUsefulSnapshot(event.snapshot || {})
  );
}

async function createParserBugReportIfNeeded(req, event) {
  if (!shouldAutoReportParserEvent(event)) return false;

  const duplicateSince = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const existing = await BugReport.findOne({
    userId: event.userId,
    source: 'parser-auto',
    url: event.url,
    platform: event.platform || 'universal',
    'parserDiagnostics.outcome': event.outcome,
    createdAt: { $gte: duplicateSince }
  }).select('_id');

  if (existing) return false;

  await BugReport.create({
    userId: event.userId,
    url: event.url,
    description: cleanText(`Automatic parser failure: ${event.reason || event.outcome}`, 1000),
    platform: event.platform || 'universal',
    source: 'parser-auto',
    parserEventId: event._id,
    parserDiagnostics: {
      outcome: event.outcome,
      confidence: event.confidence || 0,
      reason: event.reason || '',
      questionCount: event.questionCount || 0,
      optionCount: event.optionCount || 0,
      attemptedTypes: event.attemptedTypes || []
    },
    parserSnapshot: event.snapshot || {},
    userAgent: (req.headers['user-agent'] || '').substring(0, 300),
    isRead: false
  });

  return true;
}

router.post('/event', async (req, res) => {
  try {
    const body = req.body || {};
    const { url, hostname } = cleanUrl(body.url || body.sourceUrl || '');
    const questionCount = Math.min(Math.max(parseInt(body.questionCount, 10) || 0, 0), 200);
    const supportedQuestionCount = Math.min(Math.max(parseInt(body.supportedQuestionCount, 10) || 0, 0), 200);
    const optionCount = Math.min(Math.max(parseInt(body.optionCount, 10) || 0, 0), 1000);
    const confidence = Math.min(Math.max(Number(body.confidence || 0), 0), 1);
    const platform = cleanToken(body.platform || 'universal', 80) || 'universal';
    const outcome = cleanOutcome(body.outcome);
    const rawSnapshot = body.snapshot || {};
    const snapshot = cleanSnapshot(rawSnapshot);
    const fullHtmlFile = await storeParserSnapshotHtml({
      html: rawSnapshot.fullPageHtml || rawSnapshot.fullBodyHtml || '',
      url,
      platform,
      source: body.eventType || 'solve',
      outcome,
      userId: req.user._id
    });
    if (fullHtmlFile) snapshot.fullHtmlFile = fullHtmlFile;

    const event = await ParserEvent.create({
      userId: req.user._id,
      eventType: ['solve', 'manual-report', 'diagnostic'].includes(body.eventType) ? body.eventType : 'solve',
      outcome,
      platform,
      detectorPlatform: cleanToken(body.detectorPlatform || '', 80),
      url,
      hostname,
      confidence,
      reason: cleanText(body.reason || '', 240),
      questionCount,
      supportedQuestionCount,
      optionCount,
      attemptedTypes: cleanStringArray(body.attemptedTypes, 8, 80),
      questionTypes: cleanStringArray(body.questionTypes, 10, 40),
      parserVersion: cleanToken(body.parserVersion || 'v2', 40) || 'v2',
      extensionVersion: cleanToken(body.extensionVersion || '', 40),
      snapshot
    });

    let bugReportCreated = false;
    try {
      bugReportCreated = await createParserBugReportIfNeeded(req, event);
    } catch (autoReportError) {
      console.warn('[ParserEvent] Could not create automatic bug report:', autoReportError.message);
    }

    res.json({ success: true, id: event._id, bugReportCreated });
  } catch (error) {
    console.warn('[ParserEvent] Could not record event:', error.message);
    res.status(500).json({ error: 'Could not record parser event.' });
  }
});

module.exports = router;
