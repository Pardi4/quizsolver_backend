const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { authMiddleware } = require('../middleware/auth');
const { quizLimiter } = require('../middleware/rateLimiter');
const User = require('../models/User');
const CachedAnswer = require('../models/CachedAnswer');
const StudyNote = require('../models/StudyNote');
const CreditUsage = require('../models/CreditUsage');
const QuizSession = require('../models/QuizSession');
const SharedQuiz = require('../models/SharedQuiz');
const { cleanQuizText } = require('../utils/textSanitizer');
const { stripQuestionChrome, isQuestionChromeOnly, assessQuestionQuality } = require('../utils/questionTextGuard');

const router = express.Router();

router.use(authMiddleware);

const {
  AIError,
  MAX_IMAGE_DATA_URL_LENGTH,
  parseDataImage,
  shortenTextAnswer,
  callAI,
  solveSnapshotImage,
  callExplanationAI,
  callFollowUpAI
} = require('../services/aiService');

function questionRetryNeeded(message, reason = 'low-question-quality') {
  return {
    error: message,
    status: 422,
    code: 'QUESTION_RETRY_NEEDED',
    type: 'QUESTION_RETRY_NEEDED',
    retryable: true,
    answer: null,
    reason
  };
}

function sendQuestionPayloadError(res, error) {
  if (error && typeof error === 'object') {
    const { status = 400, ...body } = error;
    return res.status(status).json({ success: false, ...body });
  }
  return res.status(400).json({ success: false, error });
}

function serializeQuestionPayloadError(error) {
  if (error && typeof error === 'object') {
    const { status, ...body } = error;
    return body;
  }
  return { error };
}

function validateQuestionData(q) {
  if (!q || typeof q !== 'object') return questionRetryNeeded('Missing question data.', 'missing-question-data');
  if (!q.text || typeof q.text !== 'string') return questionRetryNeeded('Missing question text.', 'missing-question-text');
  if (q.text.trim().length < 3) return questionRetryNeeded('Question text too short.', 'question-text-too-short');
  if (q.text.length > 2000) return 'Question text too long (max 2000 chars).';
  if (q.type && !['radio', 'checkbox', 'text', 'matching', 'matrix'].includes(q.type)) return 'Invalid question type.';
  if (q.imageUrl !== undefined && q.imageUrl !== null && q.imageUrl !== '') {
    if (typeof q.imageUrl !== 'string') return 'Image URL must be a string.';
    if (q.imageUrl.length > MAX_IMAGE_DATA_URL_LENGTH) return 'Image too large.';
  }
  for (const key of ['imageAlt', 'imageCaption']) {
    if (q[key] !== undefined && q[key] !== null && q[key] !== '') {
      if (typeof q[key] !== 'string') return `${key} must be a string.`;
      if (q[key].length > 500) return `${key} too long (max 500 chars).`;
    }
  }
  if (q.options) {
    if (!Array.isArray(q.options)) return 'Options must be an array.';
    if (q.options.length > 30) return 'Too many options (max 30).';
    for (const opt of q.options) {
      if (typeof opt !== 'string') return 'Each option must be a string.';
      if (opt.length > 500) return 'Option too long (max 500 chars).';
    }
  }
  for (const key of ['prompts', 'rows']) {
    if (q[key] !== undefined) {
      if (!Array.isArray(q[key])) return `${key} must be an array.`;
      if (q[key].length > 30) return `Too many ${key} (max 30).`;
      for (const item of q[key]) {
        if (typeof item !== 'string') return `Each ${key} item must be a string.`;
        if (item.length > 500) return `${key} item too long (max 500 chars).`;
      }
    }
  }
  if (q.type === 'matching' && (!Array.isArray(q.prompts) || q.prompts.length === 0)) return 'Matching question needs prompts.';
  if (q.type === 'matrix' && (!Array.isArray(q.rows) || q.rows.length === 0)) return 'Matrix question needs rows.';
  if (['matching', 'matrix'].includes(q.type) && (!Array.isArray(q.options) || q.options.length < 2)) return 'Question needs at least two options.';
  return null;
}

function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';
  const cleaned = text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<(embed|link)[^>]*>/gi, '')
    .replace(/on\w+=(["'])[^"']*\1/gi, '')
    .trim();
  return cleanQuizText(cleaned);
}

function normalizePayloadTextList(values) {
  if (!Array.isArray(values)) return values;
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = sanitizeText(value).substring(0, 500);
    if (!text) continue;
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function normalizeQuestionPayload(questionData) {
  const rawText = sanitizeText(questionData.text);
  questionData.options = normalizePayloadTextList(questionData.options);
  questionData.prompts = normalizePayloadTextList(questionData.prompts);
  questionData.rows = normalizePayloadTextList(questionData.rows);
  questionData.imageAlt = sanitizeText(questionData.imageAlt || '').substring(0, 500);
  questionData.imageCaption = sanitizeText(questionData.imageCaption || '').substring(0, 500);

  if (rawText && isQuestionChromeOnly(rawText)) {
    if (questionData.imageUrl || questionData.imageAlt || questionData.imageCaption) {
      questionData.text = questionData.imageAlt || questionData.imageCaption || 'Question shown in image';
    } else {
      return questionRetryNeeded(
        'Could not detect the actual question text. Only quiz metadata was captured.',
        'quiz-metadata-only'
      );
    }
  } else {
    questionData.text = stripQuestionChrome(rawText) || rawText;
  }

  if (!questionData.text && questionData.imageUrl) {
    questionData.text = 'Question shown in image';
  }

  if (!questionData.text) {
    return questionRetryNeeded('Question text empty after cleanup.', 'question-text-empty-after-cleanup');
  }
  if (['radio', 'checkbox'].includes(questionData.type) &&
    (!Array.isArray(questionData.options) || questionData.options.length < 2)) {
    return questionRetryNeeded(
      'Could not detect enough answer options for this question.',
      'missing-answer-options'
    );
  }
  if (questionData.type === 'matching' && (!questionData.prompts || questionData.prompts.length === 0)) {
    return questionRetryNeeded('Matching question prompts empty after cleanup.', 'missing-matching-prompts');
  }
  if (questionData.type === 'matrix' && (!questionData.rows || questionData.rows.length === 0)) {
    return questionRetryNeeded('Matrix question rows empty after cleanup.', 'missing-matrix-rows');
  }

  const quality = assessQuestionQuality(questionData.text, questionData);
  if (!quality.ok) {
    return questionRetryNeeded(
      'Could not detect a reliable question. Retrying page extraction may fix this.',
      quality.reason
    );
  }

  return null;
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

function sanitizeImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('data:image/')) return '';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href.substring(0, 1200);
  } catch {
    return '';
  }
}

function imageUpdatesFromBody(body = {}) {
  const q = body.questionData || {};
  const explicitImage = String(body.questionImageBase64 || '').trim();
  const questionImage = String(q.imageUrl || '').trim();
  const updates = {};
  const dataImage = explicitImage || (questionImage.startsWith('data:image/') ? questionImage : '');

  if (dataImage && dataImage.length <= 2 * 1024 * 1024) {
    updates.questionImageBase64 = dataImage;
  }

  const imageUrl = sanitizeImageUrl(body.questionImageUrl || questionImage);
  if (imageUrl) updates.questionImageUrl = imageUrl;

  return updates;
}

function statusForAIError(error) {
  if (error.type === 'QUESTION_RETRY_NEEDED') return 422;
  if (error.type === 'AI_TIMEOUT') return 504;
  if (error.type === 'MODEL_ERROR') return 502;
  if (error.type === 'IMAGE_FETCH' || error.type === 'INVALID_RESPONSE') return 422;
  return 500;
}

function aiErrorResponse(error) {
  if (error.type === 'QUESTION_RETRY_NEEDED') {
    return {
      success: false,
      error: error.message || 'Question needs to be parsed again.',
      type: 'QUESTION_RETRY_NEEDED',
      code: 'QUESTION_RETRY_NEEDED',
      retryable: true,
      answer: null
    };
  }
  return { error: error.message || 'AI processing error.', type: error.type };
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function answerToText(type, options, answer, meta = {}) {
  if (type === 'radio' && Array.isArray(options)) return options[answer] || String(answer);
  if (type === 'checkbox' && Array.isArray(options) && Array.isArray(answer)) {
    return answer.map(i => options[i] || String(i)).join(', ');
  }
  if ((type === 'matching' || type === 'matrix') && Array.isArray(options) && Array.isArray(answer)) {
    const labels = type === 'matching' ? (meta.prompts || []) : (meta.rows || []);
    return answer.map((idx, i) => {
      const label = labels[i] ? `${labels[i]} -> ` : '';
      return `${label}${options[idx] || String(idx)}`;
    }).join('; ');
  }
  return String(answer ?? '');
}

function orderedNotesByIds(notes, ids) {
  const byId = new Map((notes || []).map(note => [String(note._id), note]));
  return (ids || []).map(id => byId.get(String(id?._id || id))).filter(Boolean);
}

function isAnswerCorrect(note, given) {
  const correct = note.answer;
  if (note.questionType === 'radio') return given === correct;
  if (note.questionType === 'checkbox' && Array.isArray(given) && Array.isArray(correct)) {
    return JSON.stringify([...given].sort()) === JSON.stringify([...correct].sort());
  }
  if ((note.questionType === 'matching' || note.questionType === 'matrix') && Array.isArray(given) && Array.isArray(correct)) {
    return JSON.stringify(given) === JSON.stringify(correct);
  }
  if (note.questionType === 'text' && typeof given === 'string') {
    return given.trim().toLowerCase() === String(correct).trim().toLowerCase();
  }
  return false;
}

function serializeSharedQuestion(note) {
  const options = (note.options || []).map(cleanQuizText);
  return {
    id: note._id,
    questionText: cleanQuizText(note.questionText) || 'Question shown in image',
    questionType: note.questionType,
    options,
    prompts: (note.prompts || []).map(cleanQuizText),
    rows: (note.rows || []).map(cleanQuizText),
    answer: note.answer,
    answerText: answerToText(note.questionType, options, note.answer, { prompts: note.prompts || [], rows: note.rows || [] }),
    explanation: note.explanation || ''
  };
}

function serializeSharedAttempt(attempt, notes) {
  const answers = (notes || []).map((note, i) => {
    const options = (note.options || []).map(cleanQuizText);
    const given = attempt.answers?.[i];
    return {
      questionId: note._id,
      questionText: cleanQuizText(note.questionText) || 'Question shown in image',
      questionType: note.questionType,
      given,
      givenText: answerToText(note.questionType, options, given, { prompts: note.prompts || [], rows: note.rows || [] }),
      correct: isAnswerCorrect(note, given),
      correctAnswer: note.answer,
      correctAnswerText: answerToText(note.questionType, options, note.answer, { prompts: note.prompts || [], rows: note.rows || [] }),
      explanation: note.explanation || ''
    };
  });

  const totalQuestions = attempt.totalQuestions || notes.length || 0;
  return {
    id: attempt._id,
    userId: attempt.userId || null,
    displayName: attempt.displayName || 'Anonymous',
    score: attempt.score || 0,
    totalQuestions,
    percentage: totalQuestions ? Math.round(((attempt.score || 0) / totalQuestions) * 100) : 0,
    completedAt: attempt.completedAt,
    answers
  };
}

async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return next();

    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET, {
      issuer: process.env.JWT_ISSUER || 'quizsolver-api',
      audience: process.env.JWT_AUDIENCE || 'quizsolver-ext',
    });
    const user = await User.findById(decoded.userId).select('-__v');
    if (user && !user.isBanned) req.user = user;
  } catch {}
  next();
}

function serializeStudyNote(note) {
  const options = (note.options || []).map(cleanQuizText);
  const questionText = cleanQuizText(note.questionText) || 'Question shown in image';
  const questionImageBase64 = note.questionImageBase64 || '';
  const questionImageUrl = note.questionImageUrl || '';
  return {
    id: note._id,
    cachedAnswerId: note.cachedAnswer?._id || note.cachedAnswer,
    questionHash: note.questionHash,
    questionText,
    questionType: note.questionType,
    options,
    prompts: (note.prompts || []).map(cleanQuizText),
    rows: (note.rows || []).map(cleanQuizText),
    answer: note.answer,
    answerText: answerToText(note.questionType, options, note.answer, { prompts: note.prompts || [], rows: note.rows || [] }),
    explanation: note.explanation || '',
    personalNote: note.personalNote || '',
    userNote: note.userNote || '',
    hasImage: !!(questionImageBase64 || questionImageUrl),
    questionImageBase64,
    questionImageUrl,
    imageExpiresAt: note.imageExpiresAt || null,
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
    ...imageUpdatesFromBody(body),
    ...updates,
    sourceUrl: sanitizeSourceUrl(body.url),
    platform: body.platform
  });
}

async function saveStudyNoteBestEffort(userId, cachedAnswer, body, updates = {}) {
  try {
    return await saveStudyNote(userId, cachedAnswer, body, updates);
  } catch (error) {
    console.warn('[StudyNote] Could not save solved question history:', error.message);
    return null;
  }
}

const CREDIT_DEDUPE_WINDOW_MS = Math.max(parseInt(process.env.CREDIT_DEDUPE_WINDOW_MS, 10) || 2 * 60 * 1000, 30 * 1000);
const CREDIT_CLAIM_TTL_MS = Math.max(parseInt(process.env.CREDIT_CLAIM_TTL_MS, 10) || 10 * 60 * 1000, CREDIT_DEDUPE_WINDOW_MS);

function creditWindowId(now = new Date()) {
  return Math.floor(now.getTime() / CREDIT_DEDUPE_WINDOW_MS);
}

function creditDedupeKey(userId, action, questionHash, now = new Date()) {
  return `${userId}:${action}:${questionHash}:${creditWindowId(now)}`;
}

async function shouldChargeForQuestion(userId, action, questionHash) {
  return !!(userId && action && questionHash);
}

async function findActiveCreditClaim(userId, action, questionHash) {
  if (!userId || !questionHash) return null;
  return CreditUsage.findOne({
    user: userId,
    action,
    questionHash,
    status: 'claimed',
    createdAt: { $gte: new Date(Date.now() - CREDIT_CLAIM_TTL_MS) }
  }).sort({ createdAt: -1 });
}

async function userCanSpend(user, count = 1) {
  if (!count || count <= 0) return { allowed: true, user };
  if (user.role === 'admin') return { allowed: true, user };

  const freshUser = await User.findById(user._id);
  if (!freshUser) return { allowed: false, user: null };
  const reset = freshUser.resetFreeCreditsIfNeeded();
  if (reset) await freshUser.save();

  return {
    allowed: freshUser.credits >= count,
    user: freshUser
  };
}

async function claimCreditUsage(userId, action, questionHash, count = 1, attempt = 0) {
  const now = new Date();
  const dedupeWindow = String(creditWindowId(now));
  const dedupeKey = creditDedupeKey(userId, action, questionHash, now);

  try {
    const usage = await CreditUsage.create({
      user: userId,
      action,
      questionHash,
      dedupeKey,
      dedupeWindow,
      dedupeWindowMs: CREDIT_DEDUPE_WINDOW_MS,
      credits: count,
      status: 'claimed',
      charged: false,
      claimedAt: now,
      chargedAt: null
    });
    return { shouldCharge: true, usage };
  } catch (error) {
    if (error.code !== 11000) throw error;
  }

  const existing = await CreditUsage.findOne({ dedupeKey });
  if (existing?.status === 'charged' || existing?.status === 'waived') {
    return { shouldCharge: false, duplicate: true, usage: existing };
  }
  if (existing?.status === 'claimed') {
    const claimAge = Date.now() - new Date(existing.createdAt || existing.claimedAt || 0).getTime();
    if (claimAge < CREDIT_CLAIM_TTL_MS) {
      return {
        shouldCharge: false,
        blocked: true,
        status: 409,
        retryAfterMs: Math.max(1000, CREDIT_CLAIM_TTL_MS - claimAge),
        error: 'This question is already being processed. Please retry in a moment.'
      };
    }
    if (attempt < 1) {
      await releaseCreditUsage(existing, 'stale_claim_replaced', 'aborted');
      return claimCreditUsage(userId, action, questionHash, count, attempt + 1);
    }
  }

  if (existing && attempt < 3) {
    await releaseCreditUsage(existing, 'stale_or_unknown_claim', 'aborted');
    return claimCreditUsage(userId, action, questionHash, count, attempt + 1);
  }

  throw new Error('Could not prepare credit claim.');
}

async function markCreditUsage(usage, update = {}) {
  if (!usage?._id) return;
  try {
    await CreditUsage.updateOne({ _id: usage._id }, { $set: update });
  } catch (error) {
    console.warn('[Credits] Could not update credit usage status:', error.message);
  }
}

function releasedDedupeKey(usage, reason = 'completed') {
  return `${usage.dedupeKey || usage._id}:${reason}:${usage._id}`;
}

async function freeCompletedCreditUsageDedupeKey(usage, reason = 'completed') {
  if (!usage?._id) return;
  try {
    await CreditUsage.updateOne(
      { _id: usage._id, status: { $in: ['charged', 'waived'] } },
      { $set: { dedupeKey: releasedDedupeKey(usage, reason) } }
    );
  } catch (error) {
    console.warn('[Credits] Could not release completed credit usage key:', error.message);
  }
}

async function releaseCreditUsage(usage, reason = 'aborted', status = 'aborted') {
  if (!usage?._id) return;
  try {
    const releasedKey = releasedDedupeKey(usage, 'released');
    await CreditUsage.updateOne(
      { _id: usage._id },
      {
        $set: {
          status,
          charged: false,
          waivedReason: String(reason || status).substring(0, 120),
          dedupeKey: releasedKey
        }
      }
    );
  } catch (error) {
    console.warn('[Credits] Could not release credit usage claim:', error.message);
  }
}

async function beginCreditUsage(user, action, questionHash, shouldCharge, options = {}) {
  if (!shouldCharge) {
    const freshUser = await User.findById(user._id);
    return { ok: true, shouldCharge: false, user: freshUser || user };
  }

  const count = Math.max(parseInt(options.count, 10) || 1, 1);
  const activeClaim = await findActiveCreditClaim(user._id, action, questionHash);
  if (activeClaim) {
    const claimAge = Date.now() - new Date(activeClaim.createdAt || activeClaim.claimedAt || 0).getTime();
    return {
      ok: false,
      status: 409,
      body: {
        error: 'This question is already being processed. Please retry in a moment.',
        limitReached: false,
        retryable: true,
        retryAfterMs: Math.max(1000, CREDIT_CLAIM_TTL_MS - claimAge),
        remaining: remainingFor(await User.findById(user._id) || user)
      }
    };
  }

  const claim = await claimCreditUsage(user._id, action, questionHash, count);

  if (claim.blocked) {
    return {
      ok: false,
      status: claim.status || 409,
      body: {
        error: claim.error || 'This question is already being processed. Please retry in a moment.',
        limitReached: false,
        retryable: true,
        retryAfterMs: claim.retryAfterMs || 1000,
        remaining: remainingFor(await User.findById(user._id) || user)
      }
    };
  }

  if (!claim.shouldCharge) {
    const freshUser = await User.findById(user._id);
    return { ok: true, shouldCharge: false, duplicate: true, user: freshUser || user };
  }

  if (user.role === 'admin') {
    const adminUser = await User.findById(user._id);
    if (adminUser) return { ok: true, shouldCharge: true, usage: claim.usage, user: adminUser, count, adminWaive: true };
    await releaseCreditUsage(claim.usage, 'user_not_found', 'declined');
    return { ok: false, status: 404, body: { error: 'User not found.', limitReached: false, remaining: 0 } };
  }

  const spendCheck = await userCanSpend(user, count);
  if (!spendCheck.allowed) {
    await releaseCreditUsage(claim.usage, 'no_credits', 'declined');
    return {
      ok: false,
      status: 429,
      body: { error: 'No credits remaining.', limitReached: true, remaining: spendCheck.user?.getRemaining?.() || 0 }
    };
  }

  return { ok: true, shouldCharge: true, usage: claim.usage, user: spendCheck.user || user, count };
}

async function completeCreditUsage(user, creditUsage, options = {}) {
  if (!creditUsage?.shouldCharge || !creditUsage.usage) {
    return { ok: true, user: creditUsage?.user || user, charged: false, duplicate: !!creditUsage?.duplicate };
  }

  const count = Math.max(parseInt(creditUsage.count, 10) || parseInt(options.count, 10) || 1, 1);

  if (creditUsage.adminWaive || user.role === 'admin') {
    const adminUser = creditUsage.user || await User.findById(user._id);
    if (!adminUser) {
      await releaseCreditUsage(creditUsage.usage, 'user_not_found', 'declined');
      return { ok: false, status: 404, body: { error: 'User not found.', limitReached: false, remaining: 0 } };
    }
    adminUser.stats.totalQuestionsSolved += count;
    if (options.updateStreak) adminUser.updateStreak();
    await adminUser.save();
    await markCreditUsage(creditUsage.usage, {
      status: 'waived',
      charged: false,
      waivedReason: 'admin',
      chargedAt: new Date()
    });
    return { ok: true, charged: false, user: adminUser };
  }

  const chargedUser = await User.findOneAndUpdate(
    { _id: user._id, role: { $ne: 'admin' }, credits: { $gte: count } },
    {
      $inc: {
        credits: -count,
        'stats.totalQuestionsSolved': count,
        'stats.totalCreditsSpent': count
      }
    },
    { new: true }
  );

  if (!chargedUser) {
    await releaseCreditUsage(creditUsage.usage, 'no_credits_at_charge', 'declined');
    return { ok: false, status: 429, body: { error: 'No credits remaining.', limitReached: true, remaining: 0 } };
  }

  await markCreditUsage(creditUsage.usage, {
    status: 'charged',
    charged: true,
    chargedAt: new Date()
  });

  if (options.updateStreak) {
    try {
      chargedUser.updateStreak();
      await chargedUser.save();
    } catch (error) {
      console.warn('[Credits] Streak update failed after charge:', error.message);
    }
  }

  return { ok: true, charged: true, user: chargedUser };
}

async function abortCreditUsage(creditUsage) {
  if (creditUsage?.shouldCharge && creditUsage.usage) {
    await releaseCreditUsage(creditUsage.usage, 'processing_failed', 'aborted');
  }
}

function remainingFor(user) {
  return user?.getRemaining ? user.getRemaining() : 0;
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



router.get('/study-notes', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
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

    const [notes, total] = await Promise.all([
      StudyNote.find(filter)
        .sort({ lastSeenAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('cachedAnswer')
        .lean(),
      StudyNote.countDocuments(filter)
    ]);

    res.json({
      success: true,
      notes: notes.map(serializeStudyNote),
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit))
      }
    });
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

const userLocks = new Set();
const preventConcurrentQuiz = (req, res, next) => {
  const userId = req.user._id.toString();
  if (userLocks.has(userId)) {
    return res.status(429).json({ error: 'Please wait for your previous request to finish.', limitReached: false });
  }
  userLocks.add(userId);
  const release = () => userLocks.delete(userId);
  res.on('finish', release);
  res.on('close', release);
  next();
};

router.post('/solve-snapshot', preventConcurrentQuiz, async (req, res) => {
  let creditUsage = null;
  try {
    const imageData = String(req.body.imageData || '');
    const user = req.user;

    if (!parseDataImage(imageData)) {
      return res.status(400).json({ error: 'Missing or invalid FocusScan image.' });
    }
    if (imageData.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return res.status(400).json({ error: 'FocusScan image too large.' });
    }

    const imageFingerprint = CachedAnswer.generateImageFingerprint({ imageUrl: imageData });
    const snapshotQuestionData = {
      text: `FocusScan:${imageFingerprint}`,
      options: [],
      type: 'text',
      imageFingerprint
    };
    const questionHash = CachedAnswer.generateHash(snapshotQuestionData);

    const chargeCredits = await shouldChargeForQuestion(user._id, 'solve-snapshot', questionHash);
    creditUsage = await beginCreditUsage(user, 'solve-snapshot', questionHash, chargeCredits, { updateStreak: true });
    if (!creditUsage.ok) {
      return res.status(creditUsage.status).json(creditUsage.body);
    }
    let responseUser = creditUsage.user || user;

    const cached = await CachedAnswer.findCached(snapshotQuestionData);
    if (cached !== null) {
      const cachedDoc = await CachedAnswer.findOne({ questionHash });
      const answer = await normalizeCachedAnswer(cachedDoc, cached, 'text');
      const chargeResult = await completeCreditUsage(user, creditUsage, { updateStreak: true });
      if (!chargeResult.ok) {
        return res.status(chargeResult.status).json(chargeResult.body);
      }
      creditUsage = null;
      responseUser = chargeResult.user || responseUser;
      const studyNote = await saveStudyNoteBestEffort(user._id, cachedDoc, {
        ...req.body,
        url: req.body.sourceUrl,
        platform: req.body.platform || 'focusscan',
        questionImageBase64: imageData
      });
      return res.json({
        success: true,
        answer,
        extractedQuestion: cachedDoc?.questionText || 'FocusScan image question',
        cached: true,
        remaining: remainingFor(responseUser),
        studyNoteSaved: !!studyNote,
        noteId: studyNote?._id || null
      });
    }

    const solved = await solveSnapshotImage(imageData);
    const cachedDoc = await CachedAnswer.cacheAnswer({
      ...snapshotQuestionData,
      cacheQuestionText: solved.extractedQuestion
    }, solved.answer);
    const chargeResult = await completeCreditUsage(user, creditUsage, { updateStreak: true });
    if (!chargeResult.ok) {
      return res.status(chargeResult.status).json(chargeResult.body);
    }
    creditUsage = null;
    responseUser = chargeResult.user || responseUser;
    const studyNote = await saveStudyNoteBestEffort(user._id, cachedDoc, {
      ...req.body,
      url: req.body.sourceUrl,
      platform: req.body.platform || 'focusscan',
      questionImageBase64: imageData
    });

    res.json({
      success: true,
      answer: solved.answer,
      extractedQuestion: solved.extractedQuestion,
      cached: false,
      remaining: remainingFor(responseUser),
      studyNoteSaved: !!studyNote,
      noteId: studyNote?._id || null
    });
  } catch (error) {
    await abortCreditUsage(creditUsage);
    console.error('[Quiz] FocusScan error:', error.type || 'UNKNOWN', error.message);
    const status = statusForAIError(error);
    res.status(status).json({ error: error.message || 'FocusScan processing error.', type: error.type });
  }
});

router.post('/solve', preventConcurrentQuiz, async (req, res) => {
  let creditUsage = null;
  try {
    const { questionData } = req.body;
    const user = req.user;

    const err = validateQuestionData(questionData);
    if (err) return sendQuestionPayloadError(res, err);

    const cleanupErr = normalizeQuestionPayload(questionData);
    if (cleanupErr) return sendQuestionPayloadError(res, cleanupErr);

    const questionHash = CachedAnswer.generateHash(questionData);

    const chargeCredits = await shouldChargeForQuestion(user._id, 'solve', questionHash);
    creditUsage = await beginCreditUsage(user, 'solve', questionHash, chargeCredits, { updateStreak: true });
    if (!creditUsage.ok) {
      return res.status(creditUsage.status).json(creditUsage.body);
    }
    let responseUser = creditUsage.user || user;

    const cached = await CachedAnswer.findCached(questionData);
    if (cached !== null) {
      const cachedDoc = await CachedAnswer.findOne({ questionHash });
      const answer = await normalizeCachedAnswer(cachedDoc, cached, questionData.type);
      const chargeResult = await completeCreditUsage(user, creditUsage, { updateStreak: true });
      if (!chargeResult.ok) {
        return res.status(chargeResult.status).json(chargeResult.body);
      }
      creditUsage = null;
      responseUser = chargeResult.user || responseUser;
      const studyNote = await saveStudyNoteBestEffort(user._id, cachedDoc, req.body);
      return res.json({
        success: true,
        answer,
        cached: true,
        remaining: remainingFor(responseUser),
        studyNoteSaved: !!studyNote,
        noteId: studyNote?._id || null
      });
    }

    const answer = await callAI(questionData);
    const cachedDoc = await CachedAnswer.cacheAnswer(questionData, answer);
    const chargeResult = await completeCreditUsage(user, creditUsage, { updateStreak: true });
    if (!chargeResult.ok) {
      return res.status(chargeResult.status).json(chargeResult.body);
    }
    creditUsage = null;
    responseUser = chargeResult.user || responseUser;
    const studyNote = await saveStudyNoteBestEffort(user._id, cachedDoc, req.body);

    res.json({
      success: true,
      answer,
      cached: false,
      remaining: remainingFor(responseUser),
      studyNoteSaved: !!studyNote,
      noteId: studyNote?._id || null
    });

  } catch (error) {
    await abortCreditUsage(creditUsage);
    console.error('[Quiz] Solve error:', error.type || 'UNKNOWN', error.message);
    const status = statusForAIError(error);
    res.status(status).json(aiErrorResponse(error));
  }
});

router.post('/solve-batch', preventConcurrentQuiz, async (req, res) => {
  try {
    const { questions } = req.body;
    const user = req.user;

    if (!Array.isArray(questions) || questions.length === 0)
      return res.status(400).json({ error: 'No questions provided.' });
    if (questions.length > 50)
      return res.status(400).json({ error: 'Max 50 questions per batch.' });

    const chargeHashesInRequest = new Set();
    const preparedQuestions = [];

    for (const rawQuestionData of questions) {
      const questionData = { ...(rawQuestionData || {}) };
      const validErr = validateQuestionData(questionData);
      if (validErr) {
        preparedQuestions.push({ invalidError: validErr });
        continue;
      }

      const cleanupErr = normalizeQuestionPayload(questionData);
      if (cleanupErr) {
        preparedQuestions.push({ invalidError: cleanupErr });
        continue;
      }

      const questionHash = CachedAnswer.generateHash(questionData);
      const duplicateInRequest = chargeHashesInRequest.has(questionHash);
      const chargeCredits = !duplicateInRequest
        && await shouldChargeForQuestion(user._id, 'solve', questionHash);

      if (chargeCredits) chargeHashesInRequest.add(questionHash);
      preparedQuestions.push({ questionData, questionHash, chargeCredits, duplicateInRequest });
    }

    const creditsNeeded = preparedQuestions.filter(q => q.chargeCredits).length;
    let responseUser = user;
    const spendCheck = await userCanSpend(user, creditsNeeded);
    if (!spendCheck.allowed) {
      const remaining = spendCheck.user?.getRemaining?.() || 0;
      return res.status(429).json({
        error: `${remaining} credits left, need ${creditsNeeded}.`,
        limitReached: true,
        remaining,
      });
    }
    responseUser = spendCheck.user || user;

    for (const item of preparedQuestions) {
      if (item.invalidError || !item.chargeCredits) continue;
      const creditUsage = await beginCreditUsage(user, 'solve', item.questionHash, true);
      if (!creditUsage.ok) {
        item.invalidError = {
          status: creditUsage.status,
          error: creditUsage.body?.error || 'No credits remaining.',
          limitReached: !!creditUsage.body?.limitReached,
          remaining: creditUsage.body?.remaining || 0
        };
        continue;
      }
      item.creditUsage = creditUsage;
      responseUser = creditUsage.user || responseUser;
    }

    const results = [];
    const billedHashesInRequest = new Set();

    for (const { questionData, questionHash, creditUsage, duplicateInRequest, invalidError } of preparedQuestions) {
      if (invalidError) {
        results.push({ success: false, ...serializeQuestionPayloadError(invalidError) });
        continue;
      }

      let itemCreditUsage = creditUsage;
      if (duplicateInRequest && !billedHashesInRequest.has(questionHash)) {
        const shouldChargeDuplicate = await shouldChargeForQuestion(user._id, 'solve', questionHash);
        itemCreditUsage = await beginCreditUsage(user, 'solve', questionHash, shouldChargeDuplicate);
        if (!itemCreditUsage.ok) {
          results.push({
            success: false,
            error: itemCreditUsage.body?.error || 'No credits remaining.',
            limitReached: !!itemCreditUsage.body?.limitReached
          });
          continue;
        }
      }

      try {
        const cached = await CachedAnswer.findCached(questionData);
        if (cached !== null) {
          const cachedDoc = await CachedAnswer.findOne({ questionHash });
          const answer = await normalizeCachedAnswer(cachedDoc, cached, questionData.type);
          const chargeResult = await completeCreditUsage(user, itemCreditUsage);
          if (!chargeResult.ok) {
            results.push({ success: false, error: chargeResult.body.error, limitReached: chargeResult.body.limitReached });
            continue;
          }
          if (itemCreditUsage?.shouldCharge) billedHashesInRequest.add(questionHash);
          responseUser = chargeResult.user || responseUser;
          const studyNote = await saveStudyNoteBestEffort(user._id, cachedDoc, { ...req.body, questionData });
          results.push({ success: true, answer, cached: true, noteId: studyNote?._id || null });
          continue;
        }

        const answer = await callAI(questionData);
        const cachedDoc = await CachedAnswer.cacheAnswer(questionData, answer);
        const chargeResult = await completeCreditUsage(user, itemCreditUsage);
        if (!chargeResult.ok) {
          results.push({ success: false, error: chargeResult.body.error, limitReached: chargeResult.body.limitReached });
          continue;
        }
        if (itemCreditUsage?.shouldCharge) billedHashesInRequest.add(questionHash);
        responseUser = chargeResult.user || responseUser;
        const studyNote = await saveStudyNoteBestEffort(user._id, cachedDoc, { ...req.body, questionData });
        results.push({ success: true, answer, cached: false, noteId: studyNote?._id || null });

      } catch (qErr) {
        await abortCreditUsage(itemCreditUsage);
        results.push({ success: false, ...aiErrorResponse(qErr) });
      }
    }

    const finalUser = await User.findById(user._id);
    if (finalUser) {
      finalUser.stats.totalQuizzesSolved += 1;
      finalUser.updateStreak();
      await finalUser.save();
      responseUser = finalUser;
    }

    res.json({ success: true, results, remaining: remainingFor(responseUser) });

  } catch (error) {
    console.error('[Quiz] Batch error:', error.message);
    res.status(500).json({ error: 'Batch processing error.' });
  }
});

router.post('/explain', preventConcurrentQuiz, async (req, res) => {
  let creditUsage = null;
  try {
    const { answer } = req.body;
    const text = sanitizeText(req.body.text);
    const options = Array.isArray(req.body.options) ? req.body.options.map(sanitizeText) : [];
    const type = ['radio', 'checkbox', 'text', 'matching', 'matrix'].includes(req.body.type) ? req.body.type : 'radio';
    const prompts = Array.isArray(req.body.prompts) ? req.body.prompts.map(sanitizeText).slice(0, 30) : [];
    const rows = Array.isArray(req.body.rows) ? req.body.rows.map(sanitizeText).slice(0, 30) : [];
    const user = req.user;
    const manualSelection = req.body.manualSelection === true || req.body.platform === 'selected-text';
    const questionData = { text, options, type, prompts, rows, manualSelection };
    const cleanupErr = normalizeQuestionPayload(questionData);
    if (cleanupErr) return sendQuestionPayloadError(res, cleanupErr);

    if (!questionData.text || answer === undefined) {
      return res.status(400).json({ error: 'Missing question text or answer.' });
    }

    const questionHash = CachedAnswer.generateHash(questionData);

    const chargeCredits = await shouldChargeForQuestion(user._id, 'explain', questionHash);
    creditUsage = await beginCreditUsage(user, 'explain', questionHash, chargeCredits);
    if (!creditUsage.ok) {
      return res.status(creditUsage.status).json(creditUsage.body);
    }
    let responseUser = creditUsage.user || user;

    const explanation = await callExplanationAI(
      questionData.text,
      questionData.options || [],
      answer,
      questionData.type,
      req.body.explanationLanguage || 'auto',
      { prompts: questionData.prompts || [], rows: questionData.rows || [] }
    );
    let cachedDoc = await CachedAnswer.findOne({ questionHash });
    if (!cachedDoc) cachedDoc = await CachedAnswer.cacheAnswer(questionData, answer);
    const chargeResult = await completeCreditUsage(user, creditUsage);
    if (!chargeResult.ok) {
      return res.status(chargeResult.status).json(chargeResult.body);
    }
    creditUsage = null;
    responseUser = chargeResult.user || responseUser;
    const studyNote = await saveStudyNoteBestEffort(user._id, cachedDoc, req.body, { explanation });

    res.json({
      success: true,
      explanation,
      remaining: remainingFor(responseUser),
      studyNoteSaved: !!studyNote,
      noteId: studyNote?._id || null
    });
  } catch (error) {
    await abortCreditUsage(creditUsage);
    const status = statusForAIError(error);
    res.status(status).json(aiErrorResponse(error));
  }
});


/* ── QUIZ SESSIONS ── */

router.post('/follow-up', preventConcurrentQuiz, async (req, res) => {
  let creditUsage = null;
  try {
    const { answer } = req.body;
    const text = sanitizeText(req.body.text);
    const options = Array.isArray(req.body.options) ? req.body.options.map(sanitizeText) : [];
    const type = ['radio', 'checkbox', 'text', 'matching', 'matrix'].includes(req.body.type) ? req.body.type : 'radio';
    const prompts = Array.isArray(req.body.prompts) ? req.body.prompts.map(sanitizeText).slice(0, 30) : [];
    const rows = Array.isArray(req.body.rows) ? req.body.rows.map(sanitizeText).slice(0, 30) : [];
    const prompt = sanitizeText(String(req.body.prompt || 'Explain more.')).substring(0, 500);
    const previousExplanation = sanitizeText(String(req.body.previousExplanation || '')).substring(0, 1200);
    const user = req.user;
    const manualSelection = req.body.manualSelection === true || req.body.platform === 'selected-text';
    const questionData = { text, options, type, prompts, rows, manualSelection };
    const cleanupErr = normalizeQuestionPayload(questionData);
    if (cleanupErr) return sendQuestionPayloadError(res, cleanupErr);

    if (!questionData.text || answer === undefined) {
      return res.status(400).json({ error: 'Missing question text or answer.' });
    }

    const questionHash = CachedAnswer.generateHash(questionData);
    const chargeCredits = await shouldChargeForQuestion(user._id, 'follow-up', questionHash);
    creditUsage = await beginCreditUsage(user, 'follow-up', questionHash, chargeCredits);
    if (!creditUsage.ok) {
      return res.status(creditUsage.status).json(creditUsage.body);
    }
    let responseUser = creditUsage.user || user;

    const followUp = await callFollowUpAI({
      text: questionData.text,
      options: questionData.options || [],
      answer,
      type: questionData.type,
      prompt,
      previousExplanation,
      explanationLanguage: req.body.explanationLanguage || 'auto',
      prompts: questionData.prompts || [],
      rows: questionData.rows || []
    });

    let cachedDoc = await CachedAnswer.findOne({ questionHash });
    if (!cachedDoc) cachedDoc = await CachedAnswer.cacheAnswer(questionData, answer);
    const chargeResult = await completeCreditUsage(user, creditUsage);
    if (!chargeResult.ok) {
      return res.status(chargeResult.status).json(chargeResult.body);
    }
    creditUsage = null;
    responseUser = chargeResult.user || responseUser;
    const studyNote = await saveStudyNoteBestEffort(user._id, cachedDoc, req.body, { explanation: followUp });

    res.json({
      success: true,
      followUp,
      remaining: remainingFor(responseUser),
      studyNoteSaved: !!studyNote,
      noteId: studyNote?._id || null
    });
  } catch (error) {
    await abortCreditUsage(creditUsage);
    const status = statusForAIError(error);
    res.status(status).json(aiErrorResponse(error));
  }
});

router.post('/sessions', async (req, res) => {
  try {
    const { noteIds, title, sourceUrl, platform } = req.body;
    if (!Array.isArray(noteIds) || noteIds.length === 0)
      return res.status(400).json({ error: 'noteIds required.' });

    const session = await QuizSession.create({
      user: req.user._id,
      title: String(title || '').substring(0, 200) || `Quiz – ${new Date().toLocaleDateString()}`,
      sourceUrl: sanitizeSourceUrl(sourceUrl),
      platform: String(platform || '').substring(0, 80),
      noteIds: noteIds.slice(0, 200),
      questionCount: noteIds.length
    });

    await StudyNote.updateMany(
      { _id: { $in: noteIds }, user: req.user._id },
      { $set: { quizSessionId: session._id } }
    );

    res.json({ success: true, session });
  } catch (error) {
    res.status(500).json({ error: 'Could not create quiz session.' });
  }
});

router.get('/sessions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const sessions = await QuizSession.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ success: true, sessions });
  } catch (error) {
    res.status(500).json({ error: 'Could not load sessions.' });
  }
});

router.get('/sessions/:sessionId/notes', async (req, res) => {
  try {
    const session = await QuizSession.findOne({ _id: req.params.sessionId, user: req.user._id });
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    const notes = await StudyNote.find({ quizSessionId: session._id, user: req.user._id })
      .sort({ lastSeenAt: 1 })
      .populate('cachedAnswer')
      .lean();

    res.json({ success: true, session, notes: notes.map(serializeStudyNote) });
  } catch (error) {
    res.status(500).json({ error: 'Could not load session notes.' });
  }
});

/* ── USER NOTE PATCH ── */

router.patch('/study-notes/:id/user-note', async (req, res) => {
  try {
    const userNote = sanitizeText(String(req.body.userNote || req.body.personalNote || '')).substring(0, 1000);
    const note = await StudyNote.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: { userNote, personalNote: userNote } },
      { new: true }
    ).populate('cachedAnswer');

    if (!note) return res.status(404).json({ error: 'Note not found.' });
    res.json({ success: true, note: serializeStudyNote(note) });
  } catch (error) {
    res.status(500).json({ error: 'Could not update note.' });
  }
});

/* ── SHARED QUIZ ── */

const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://getquizsolver.com').replace(/\/+$/, '');

router.post('/share', async (req, res) => {
  try {
    const { noteIds, title } = req.body;
    if (!Array.isArray(noteIds) || noteIds.length === 0)
      return res.status(400).json({ error: 'Select at least one question.' });
    if (noteIds.length > 50)
      return res.status(400).json({ error: 'Max 50 questions per shared quiz.' });
    const cleanNoteIds = noteIds.map(id => String(id || '').trim()).filter(Boolean);
    if (cleanNoteIds.length !== noteIds.length || cleanNoteIds.some(id => !mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ error: 'Invalid note id.' });
    }

    const foundNotes = await StudyNote.find({ _id: { $in: cleanNoteIds }, user: req.user._id }).lean();
    const notes = orderedNotesByIds(foundNotes, cleanNoteIds);
    if (notes.length === 0) return res.status(404).json({ error: 'No matching notes found.' });

    const shared = await SharedQuiz.create({
      createdBy: req.user._id,
      title: String(title || '').substring(0, 200) || `Quiz by ${req.user.displayName || req.user.email.split('@')[0]}`,
      noteIds: notes.map(n => n._id),
      questionCount: notes.length
    });

    const shareUrl = `${PUBLIC_SITE_URL}/quiz/shared/${shared.token}`;
    res.json({ success: true, token: shared.token, shareUrl, questionCount: notes.length });
  } catch (error) {
    res.status(500).json({ error: 'Could not create shared quiz.' });
  }
});

/* Public endpoints — no auth required */
router.get('/shared-created', async (req, res) => {
  try {
    const quizzes = await SharedQuiz.find({ createdBy: req.user._id, isActive: true })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate({ path: 'noteIds', select: 'questionText questionType options prompts rows answer explanation' })
      .lean();

    res.json({
      success: true,
      quizzes: quizzes.map(shared => {
        const notes = orderedNotesByIds(shared.noteIds || [], shared.noteIds || []);
        return {
          token: shared.token,
          title: shared.title,
          shareUrl: `${PUBLIC_SITE_URL}/quiz/shared/${shared.token}`,
          questionCount: shared.questionCount,
          viewCount: shared.viewCount,
          createdAt: shared.createdAt,
          expiresAt: shared.expiresAt,
          attemptCount: shared.attempts?.length || 0,
          questions: notes.map(serializeSharedQuestion),
          attempts: (shared.attempts || [])
            .slice()
            .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
            .map(attempt => serializeSharedAttempt(attempt, notes))
        };
      })
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not load shared quizzes.' });
  }
});

router.get('/shared-attempts', async (req, res) => {
  try {
    const quizzes = await SharedQuiz.find({
      isActive: true,
      'attempts.userId': req.user._id
    })
      .sort({ updatedAt: -1 })
      .limit(100)
      .populate({ path: 'noteIds', select: 'questionText questionType options prompts rows answer explanation' })
      .lean();

    res.json({
      success: true,
      attempts: quizzes.flatMap(shared => {
        const notes = orderedNotesByIds(shared.noteIds || [], shared.noteIds || []);
        return (shared.attempts || [])
          .filter(attempt => String(attempt.userId || '') === String(req.user._id))
          .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
          .map(attempt => ({
            token: shared.token,
            title: shared.title,
            shareUrl: `${PUBLIC_SITE_URL}/quiz/shared/${shared.token}`,
            questionCount: shared.questionCount,
            createdAt: shared.createdAt,
            ...serializeSharedAttempt(attempt, notes)
          }));
      }).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not load participated quizzes.' });
  }
});

const publicRouter = express.Router();

publicRouter.get('/shared/:token', async (req, res) => {
  try {
    const shared = await SharedQuiz.findOne({ token: req.params.token, isActive: true })
      .populate({ path: 'noteIds', populate: { path: 'cachedAnswer' } })
      .lean();

    if (!shared) return res.status(404).json({ error: 'Shared quiz not found or expired.' });
    if (shared.expiresAt && new Date() > new Date(shared.expiresAt))
      return res.status(410).json({ error: 'This shared quiz has expired.' });

    await SharedQuiz.updateOne({ _id: shared._id }, { $inc: { viewCount: 1 } });

    const questions = (shared.noteIds || []).map(note => ({
      id: note._id,
      questionText: cleanQuizText(note.questionText) || 'Question shown in image',
      questionType: note.questionType,
      options: (note.options || []).map(cleanQuizText),
      prompts: (note.prompts || []).map(cleanQuizText),
      rows: (note.rows || []).map(cleanQuizText),
      hasImage: !!(note.questionImageBase64 || note.questionImageUrl),
      questionImageBase64: note.questionImageBase64 || null,
      questionImageUrl: note.questionImageUrl || null,
      imageExpiresAt: note.imageExpiresAt || null
    }));

    res.json({
      success: true,
      quiz: {
        token: shared.token,
        title: shared.title,
        questionCount: shared.questionCount,
        createdAt: shared.createdAt,
        expiresAt: shared.expiresAt,
        viewCount: shared.viewCount + 1
      },
      questions
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not load shared quiz.' });
  }
});

publicRouter.post('/shared/:token/attempt', optionalAuth, async (req, res) => {
  try {
    const shared = await SharedQuiz.findOne({ token: req.params.token, isActive: true });
    if (!shared) return res.status(404).json({ error: 'Shared quiz not found.' });

    const answers = Array.isArray(req.body.answers) ? req.body.answers.slice(0, 50) : [];
    const rawDisplayName = String(req.body.displayName || '').trim();
    const displayName = req.user
      ? (req.user.displayName || req.user.email.split('@')[0] || 'User').substring(0, 60)
      : rawDisplayName.substring(0, 60);
    if (!displayName) return res.status(400).json({ error: 'Display name is required.' });
    const userId = req.user?._id || null;

    const foundNotes = await StudyNote.find({ _id: { $in: shared.noteIds } }).lean();
    const notes = orderedNotesByIds(foundNotes, shared.noteIds);
    let score = 0;
    notes.forEach((note, i) => {
      if (isAnswerCorrect(note, answers[i])) score++;
    });

    await SharedQuiz.updateOne({ _id: shared._id }, {
      $push: { attempts: { userId, displayName, answers, score, totalQuestions: notes.length, completedAt: new Date() } }
    });

    const correctAnswers = notes.map(note => ({
      id: note._id,
      answer: note.answer,
      answerText: answerToText(note.questionType, (note.options || []).map(cleanQuizText), note.answer, { prompts: note.prompts || [], rows: note.rows || [] }),
      explanation: note.explanation || ''
    }));

    res.json({ success: true, score, totalQuestions: notes.length, correctAnswers });
  } catch (error) {
    res.status(500).json({ error: 'Could not submit attempt.' });
  }
});

publicRouter.get('/shared/:token/results', async (req, res) => {
  try {
    const shared = await SharedQuiz.findOne({ token: req.params.token, isActive: true })
      .select('title questionCount attempts createdAt expiresAt')
      .lean();
    if (!shared) return res.status(404).json({ error: 'Shared quiz not found.' });

    const results = (shared.attempts || [])
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map(a => ({
        displayName: a.displayName,
        score: a.score,
        totalQuestions: a.totalQuestions,
        percentage: Math.round((a.score / a.totalQuestions) * 100),
        completedAt: a.completedAt
      }));

    res.json({ success: true, title: shared.title, results, viewCount: shared.viewCount });
  } catch (error) {
    res.status(500).json({ error: 'Could not load results.' });
  }
});

module.exports = { router, publicRouter };
