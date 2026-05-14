const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { quizLimiter } = require('../middleware/rateLimiter');
const CachedAnswer = require('../models/CachedAnswer');
const StudyNote = require('../models/StudyNote');

const router = express.Router();

router.use(authMiddleware);

const MODEL = 'gpt-5.4-nano';
const AI_TIMEOUT = 30000;

class AIError extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
  }
}

function validateQuestionData(q) {
  if (!q || typeof q !== 'object') return 'Missing question data.';
  if (!q.text || typeof q.text !== 'string') return 'Missing question text.';
  if (q.text.trim().length < 3) return 'Question text too short.';
  if (q.text.length > 2000) return 'Question text too long (max 2000 chars).';
  if (q.type && !['radio', 'checkbox', 'text'].includes(q.type)) return 'Invalid question type.';
  if (q.options) {
    if (!Array.isArray(q.options)) return 'Options must be an array.';
    if (q.options.length > 20) return 'Too many options (max 20).';
    for (const opt of q.options) {
      if (typeof opt !== 'string') return 'Each option must be a string.';
      if (opt.length > 500) return 'Option too long (max 500 chars).';
    }
  }
  return null;
}

function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<(embed|link)[^>]*>/gi, '')
    .replace(/on\w+=(["'])[^"']*\1/gi, '')
    .trim();
}

function sanitizeSourceUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`.substring(0, 500);
  } catch {
    return url.split('?')[0].split('#')[0].substring(0, 500);
  }
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function answerToText(type, options, answer) {
  if (type === 'radio' && Array.isArray(options)) return options[answer] || String(answer);
  if (type === 'checkbox' && Array.isArray(options) && Array.isArray(answer)) {
    return answer.map(i => options[i] || String(i)).join(', ');
  }
  return String(answer ?? '');
}

function serializeStudyNote(note) {
  const options = note.options || [];
  return {
    id: note._id,
    cachedAnswerId: note.cachedAnswer?._id || note.cachedAnswer,
    questionHash: note.questionHash,
    questionText: note.questionText,
    questionType: note.questionType,
    options,
    answer: note.answer,
    answerText: answerToText(note.questionType, options, note.answer),
    explanation: note.explanation || '',
    personalNote: note.personalNote || '',
    tags: note.tags || [],
    favorite: !!note.favorite,
    status: note.status || 'new',
    sourceUrl: note.sourceUrl || '',
    platform: note.platform || '',
    seenCount: note.seenCount || 0,
    explainCount: note.explainCount || 0,
    lastSeenAt: note.lastSeenAt,
    lastExplainedAt: note.lastExplainedAt,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt
  };
}

async function saveStudyNote(userId, cachedAnswer, body, updates = {}) {
  if (!cachedAnswer || body.saveToStudyNotes === false) return null;
  return StudyNote.upsertFromCache(userId, cachedAnswer, {
    ...updates,
    sourceUrl: sanitizeSourceUrl(body.url),
    platform: body.platform
  });
}

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

async function fetchImageAsBase64(imageUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  let res;
  try {
    res = await fetch(imageUrl, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    throw new AIError('IMAGE_FETCH', err.name === 'AbortError'
      ? 'Image fetch timed out.'
      : `Image fetch failed: ${err.message}`);
  }
  clearTimeout(timer);

  if (!res.ok) throw new AIError('IMAGE_FETCH', `Image server returned ${res.status}.`);

  const mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  if (!ALLOWED_IMAGE_TYPES.has(mimeType))
    throw new AIError('IMAGE_FETCH', `Unsupported image type: ${mimeType}`);

  const buffer = await res.arrayBuffer();
  return { base64: Buffer.from(buffer).toString('base64'), mimeType };
}

function getSystemMessage(type) {
  if (type === 'checkbox') {
    return 'You answer quiz questions. Return ONLY correct option numbers separated by commas. Example: 0,2,3. No words.';
  }
  if (type === 'text') {
    return 'You answer quiz questions. Return ONLY the final answer, as short as possible. No explanation, no markdown, no lead-in sentence. If the question asks what an acronym stands for, return only the expanded phrase. Example: Hypertext Transfer Protocol.';
  }
  return 'You answer quiz questions. Return ONLY the correct option number. Example: 2. No words.';
}

function buildUserPrompt(text, options) {
  if (!options || options.length === 0) return text;
  return text + '\n' + options.map((o, i) => `${i}. ${o}`).join('\n');
}

function getMaxTokens(type) {
  if (type === 'checkbox') return 20;
  if (type === 'text') return 40;
  return 5;
}

const LETTER_MAP = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };

function parseAnswer(raw, type, options) {
  if (!raw || typeof raw !== 'string')
    throw new AIError('INVALID_RESPONSE', 'Empty AI response.');

  let text = raw.replace(/^```[\s\S]*?```$/gm, '').trim();

  text = text.replace(/^(answer|response|correct|odpowied[zź])\s*[:=]\s*/i, '').trim();
  text = text.replace(/^["'`]+|["'`]+$/g, '').trim();
  text = text.replace(/\.$/g, '').trim();

  text = text.replace(/\bOption\s+([A-F])\b/gi, (_, l) => LETTER_MAP[l.toUpperCase()] ?? l);
  text = text.replace(/\b([A-F])[.)]\s/gi, (_, l) => LETTER_MAP[l.toUpperCase()] ?? l);
  text = text.replace(/^([A-F])$/gi, (_, l) => LETTER_MAP[l.toUpperCase()] ?? l);

  if (type === 'checkbox') {
    if (text === '') return [];
    const indices = text
      .split(/[,\s]+/)
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n >= 0 && (!options || n < options.length));
    if (indices.length === 0)
      throw new AIError('INVALID_RESPONSE', `Cannot parse checkbox answer: "${raw}"`);
    return indices;
  }

  if (type === 'text') {
    if (text.length === 0)
      throw new AIError('INVALID_RESPONSE', 'AI returned empty text answer.');
    return shortenTextAnswer(text);
  }

  const match = text.match(/(\d+)/);
  if (!match)
    throw new AIError('INVALID_RESPONSE', `Cannot parse radio answer: "${raw}"`);
  const idx = parseInt(match[1], 10);
  if (options && (idx < 0 || idx >= options.length))
    throw new AIError('INVALID_RESPONSE', `Index ${idx} out of range (${options.length} options).`);
  return idx;
}

function shortenTextAnswer(text) {
  let value = text
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const acronymExpansion = value.match(/^\s*[A-Z0-9]{2,}\s+(?:stands\s+for|means|oznacza|to\s+skr[oó]t\s+od)\s+([^.!?]+)/i);
  if (acronymExpansion) {
    return acronymExpansion[1].replace(/^[:\-–—]\s*/, '').trim();
  }

  value = value
    .replace(/^(?:the\s+answer\s+is|answer\s*:|odpowied[zź]\s*:)\s*/i, '')
    .trim();

  const firstLine = value.split(/\r?\n/)[0].trim();
  const firstSentence = firstLine.match(/^(.{1,160}?[.!?])\s+/);
  return (firstSentence ? firstSentence[1] : firstLine).replace(/[.!?]$/g, '').trim();
}

async function normalizeCachedAnswer(cachedDoc, answer, type) {
  if (type !== 'text' || answer === null || answer === undefined) return answer;
  const shortAnswer = shortenTextAnswer(String(answer));
  if (cachedDoc && cachedDoc.answer !== shortAnswer) {
    cachedDoc.answer = shortAnswer;
    await cachedDoc.save();
  }
  return shortAnswer;
}

async function callAI(questionData) {
  const { text, options, type, imageUrl } = questionData;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AIError('MODEL_ERROR', 'OPENAI_API_KEY not configured.');

  const hasImage = Boolean(imageUrl);
  const userContent = [];

  userContent.push({ type: 'text', text: buildUserPrompt(text, options) });

  if (hasImage) {
    const { base64, mimeType } = await fetchImageAsBase64(imageUrl);
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'low' }
    });
  }

  const body = {
    model: MODEL,
    temperature: 0,
    max_completion_tokens: getMaxTokens(type),
    messages: [
      { role: 'system', content: getSystemMessage(type) },
      { role: 'user', content: userContent }
    ]
  };

  console.log('[AI] ->', JSON.stringify({ model: MODEL, type, hasImage, textLen: text.length }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT);

  let response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new AIError('AI_TIMEOUT', 'AI request timed out (30s).');
    throw new AIError('MODEL_ERROR', err.message);
  }
  clearTimeout(timer);

  const responseText = await response.text();

  if (!response.ok) {
    let detail = 'AI service error.';
    try { detail = JSON.parse(responseText)?.error?.message || detail; } catch { }
    throw new AIError('MODEL_ERROR', detail);
  }

  const data = JSON.parse(responseText);
  const raw = data?.choices?.[0]?.message?.content?.trim() || '';

  console.log('[AI] <-', raw.substring(0, 100));

  return parseAnswer(raw, type, options);
}

async function callExplanationAI(text, options, answer, type, explanationLanguage = 'auto') {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AIError('MODEL_ERROR', 'OPENAI_API_KEY not configured.');

  let answerText = '';
  if (type === 'radio' && options) answerText = options[answer] || String(answer);
  else if (type === 'checkbox' && options) answerText = answer.map(i => options[i] || i).join(', ');
  else answerText = String(answer);

  const languageHint = explanationLanguage === 'pl'
    ? 'Answer in Polish.'
    : explanationLanguage === 'en'
      ? 'Answer in English.'
      : 'Answer in the same language as the question when clear.';

  const body = {
    model: MODEL,
    temperature: 0,
    max_completion_tokens: 80,
    messages: [
      { role: 'system', content: `Explain briefly why this answer is correct. Max 2 sentences. Be concise. ${languageHint}` },
      { role: 'user', content: `Question: ${text}\nCorrect answer: ${answerText}` }
    ]
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT);

  let response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new AIError('MODEL_ERROR', err.message);
  }
  clearTimeout(timer);

  if (!response.ok) throw new AIError('MODEL_ERROR', 'Explanation AI error.');

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || 'No explanation available.';
}

router.get('/study-notes', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 80, 150);
    const search = String(req.query.search || '').trim();
    const filter = { user: req.user._id };

    if (req.query.favorite === 'true') filter.favorite = true;
    if (['new', 'learning', 'mastered'].includes(req.query.status)) filter.status = req.query.status;

    if (search) {
      const regex = new RegExp(escapeRegex(search).substring(0, 80), 'i');
      filter.$or = [
        { questionText: regex },
        { explanation: regex },
        { personalNote: regex },
        { tags: regex },
        { platform: regex }
      ];
    }

    const notes = await StudyNote.find(filter)
      .sort({ lastSeenAt: -1 })
      .limit(limit)
      .populate('cachedAnswer')
      .lean();

    res.json({ success: true, notes: notes.map(serializeStudyNote) });
  } catch (error) {
    res.status(500).json({ error: 'Could not load study notes.' });
  }
});

router.patch('/study-notes/:id', async (req, res) => {
  try {
    const update = {};

    if (typeof req.body.favorite === 'boolean') update.favorite = req.body.favorite;
    if (['new', 'learning', 'mastered'].includes(req.body.status)) update.status = req.body.status;
    if (typeof req.body.personalNote === 'string') {
      update.personalNote = sanitizeText(req.body.personalNote).substring(0, 1000);
    }
    if (Array.isArray(req.body.tags)) {
      update.tags = req.body.tags
        .map(tag => sanitizeText(String(tag)).substring(0, 24))
        .filter(Boolean)
        .slice(0, 12);
    }

    const note = await StudyNote.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: update },
      { new: true }
    ).populate('cachedAnswer');

    if (!note) return res.status(404).json({ error: 'Study note not found.' });
    res.json({ success: true, note: serializeStudyNote(note) });
  } catch (error) {
    res.status(500).json({ error: 'Could not update study note.' });
  }
});

router.delete('/study-notes/:id', async (req, res) => {
  try {
    const result = await StudyNote.deleteOne({ _id: req.params.id, user: req.user._id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Study note not found.' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not delete study note.' });
  }
});

router.post('/practice', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.noteIds) ? req.body.noteIds.slice(0, 50) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Select at least one question.' });

    const notes = await StudyNote.find({ _id: { $in: ids }, user: req.user._id })
      .populate('cachedAnswer')
      .lean();

    const byId = new Map(notes.map(note => [String(note._id), note]));
    const ordered = ids.map(id => byId.get(String(id))).filter(Boolean);

    res.json({
      success: true,
      questions: ordered.map(serializeStudyNote)
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not create practice quiz.' });
  }
});

router.use(quizLimiter);

router.post('/solve', async (req, res) => {
  try {
    const { questionData } = req.body;
    const user = req.user;

    const err = validateQuestionData(questionData);
    if (err) return res.status(400).json({ error: err });

    questionData.text = sanitizeText(questionData.text);
    questionData.options = questionData.options?.map(sanitizeText);

    if (!user.canUse(1)) {
      return res.status(429).json({ error: 'No credits remaining.', limitReached: true, remaining: 0 });
    }

    const questionHash = CachedAnswer.generateHash(questionData);
    const cached = await CachedAnswer.findCached(questionData);
    if (cached !== null) {
      const cachedDoc = await CachedAnswer.findOne({ questionHash });
      const answer = await normalizeCachedAnswer(cachedDoc, cached, questionData.type);
      await saveStudyNote(user._id, cachedDoc, req.body);
      user.useCredits(1);
      user.updateStreak();
      await user.save();
      return res.json({ success: true, answer, cached: true, remaining: user.getRemaining(), studyNoteSaved: !!cachedDoc });
    }

    const answer = await callAI(questionData);
    const cachedDoc = await CachedAnswer.cacheAnswer(questionData, answer);
    await saveStudyNote(user._id, cachedDoc, req.body);
    user.useCredits(1);
    user.updateStreak();
    await user.save();

    res.json({ success: true, answer, cached: false, remaining: user.getRemaining(), studyNoteSaved: !!cachedDoc });

  } catch (error) {
    console.error('[Quiz] Solve error:', error.type || 'UNKNOWN', error.message);
    const status = error.type === 'AI_TIMEOUT' ? 504 : 500;
    res.status(status).json({ error: error.message || 'AI processing error.', type: error.type });
  }
});

router.post('/solve-batch', async (req, res) => {
  try {
    const { questions } = req.body;
    const user = req.user;

    if (!Array.isArray(questions) || questions.length === 0)
      return res.status(400).json({ error: 'No questions provided.' });
    if (questions.length > 50)
      return res.status(400).json({ error: 'Max 50 questions per batch.' });

    const remaining = user.getRemaining();
    if (user.role !== 'admin' && remaining < questions.length) {
      return res.status(429).json({
        error: `${remaining} credits left, need ${questions.length}.`,
        limitReached: true,
        remaining,
      });
    }

    const results = [];

    for (const questionData of questions) {
      const validErr = validateQuestionData(questionData);
      if (validErr) { results.push({ success: false, error: validErr }); continue; }

      questionData.text = sanitizeText(questionData.text);
      questionData.options = questionData.options?.map(sanitizeText);

      try {
        const questionHash = CachedAnswer.generateHash(questionData);
        const cached = await CachedAnswer.findCached(questionData);
        if (cached !== null) {
          const cachedDoc = await CachedAnswer.findOne({ questionHash });
          const answer = await normalizeCachedAnswer(cachedDoc, cached, questionData.type);
          await saveStudyNote(user._id, cachedDoc, req.body);
          user.useCredits(1);
          results.push({ success: true, answer, cached: true });
          continue;
        }

        const answer = await callAI(questionData);
        const cachedDoc = await CachedAnswer.cacheAnswer(questionData, answer);
        await saveStudyNote(user._id, cachedDoc, req.body);
        user.useCredits(1);
        results.push({ success: true, answer, cached: false });

      } catch (qErr) {
        results.push({ success: false, error: qErr.message, type: qErr.type });
      }
    }

    user.stats.totalQuizzesSolved += 1;
    user.updateStreak();
    await user.save();

    res.json({ success: true, results, remaining: user.getRemaining() });

  } catch (error) {
    console.error('[Quiz] Batch error:', error.message);
    res.status(500).json({ error: 'Batch processing error.' });
  }
});

router.post('/explain', async (req, res) => {
  try {
    const { answer } = req.body;
    const text = sanitizeText(req.body.text);
    const options = Array.isArray(req.body.options) ? req.body.options.map(sanitizeText) : [];
    const type = ['radio', 'checkbox', 'text'].includes(req.body.type) ? req.body.type : 'radio';
    const user = req.user;

    if (!text || answer === undefined) {
      return res.status(400).json({ error: 'Missing question text or answer.' });
    }

    if (!user.canUse(1)) {
      return res.status(429).json({ error: 'No credits remaining.', limitReached: true });
    }

    const explanation = await callExplanationAI(text, options, answer, type, req.body.explanationLanguage || 'auto');
    const questionData = { text, options, type };
    let cachedDoc = await CachedAnswer.findOne({ questionHash: CachedAnswer.generateHash(questionData) });
    if (!cachedDoc) cachedDoc = await CachedAnswer.cacheAnswer(questionData, answer);
    await saveStudyNote(user._id, cachedDoc, req.body, { explanation });

    user.useCredits(1);
    await user.save();

    res.json({ success: true, explanation, remaining: user.getRemaining(), studyNoteSaved: !!cachedDoc });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Explanation error.' });
  }
});

module.exports = router;
