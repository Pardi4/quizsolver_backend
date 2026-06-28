const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const ParserEvent = require('../models/ParserEvent');

const router = express.Router();
router.use(authMiddleware);

function cleanText(value, max = 500) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, max);
}

function cleanHtml(value, max = 12000) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s(?:src|href)\s*=\s*(['"])(?!#|\/|\.\/).*?\1/gi, '')
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
    selectorSummary
  };
}

function cleanOutcome(value) {
  return ['success', 'partial', 'empty', 'weak', 'error', 'reported'].includes(value) ? value : 'empty';
}

router.post('/event', async (req, res) => {
  try {
    const body = req.body || {};
    const { url, hostname } = cleanUrl(body.url || body.sourceUrl || '');
    const questionCount = Math.min(Math.max(parseInt(body.questionCount, 10) || 0, 0), 200);
    const supportedQuestionCount = Math.min(Math.max(parseInt(body.supportedQuestionCount, 10) || 0, 0), 200);
    const optionCount = Math.min(Math.max(parseInt(body.optionCount, 10) || 0, 0), 1000);
    const confidence = Math.min(Math.max(Number(body.confidence || 0), 0), 1);

    const event = await ParserEvent.create({
      userId: req.user._id,
      eventType: ['solve', 'manual-report', 'diagnostic'].includes(body.eventType) ? body.eventType : 'solve',
      outcome: cleanOutcome(body.outcome),
      platform: cleanToken(body.platform || 'universal', 80) || 'universal',
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
      snapshot: cleanSnapshot(body.snapshot || {})
    });

    res.json({ success: true, id: event._id });
  } catch (error) {
    console.warn('[ParserEvent] Could not record event:', error.message);
    res.status(500).json({ error: 'Could not record parser event.' });
  }
});

module.exports = router;
