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

const router = express.Router();

router.use(authMiddleware);

const CREDIT_DEDUPE_WINDOW_MS = 2 * 60 * 1000;

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

function validateQuestionData(q) {
  if (!q || typeof q !== 'object') return 'Missing question data.';
  if (!q.text || typeof q.text !== 'string') return 'Missing question text.';
  if (q.text.trim().length < 3) return 'Question text too short.';
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

function normalizeQuestionPayload(questionData) {
  questionData.text = sanitizeText(questionData.text);
  questionData.options = questionData.options?.map(sanitizeText);
  questionData.prompts = questionData.prompts?.map(sanitizeText).filter(Boolean);
  questionData.rows = questionData.rows?.map(sanitizeText).filter(Boolean);
  questionData.imageAlt = sanitizeText(questionData.imageAlt || '').substring(0, 500);
  questionData.imageCaption = sanitizeText(questionData.imageCaption || '').substring(0, 500);

  if (!questionData.text && questionData.imageUrl) {
    questionData.text = 'Question shown in image';
  }

  if (!questionData.text) {
    return 'Question text empty after cleanup.';
  }
  if (questionData.type === 'matching' && (!questionData.prompts || questionData.prompts.length === 0)) {
    return 'Matching question prompts empty after cleanup.';
  }
  if (questionData.type === 'matrix' && (!questionData.rows || questionData.rows.length === 0)) {
    return 'Matrix question rows empty after cleanup.';
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
  if (error.type === 'AI_TIMEOUT') return 504;
  if (error.type === 'MODEL_ERROR') return 502;
  if (error.type === 'IMAGE_FETCH' || error.type === 'INVALID_RESPONSE') return 422;
  return 500;
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

function creditDedupeKey(userId, action, questionHash) {
  return `${userId}:question:${questionHash}`;
}

async function hasCreditUsage(userId, action, questionHash) {
  if (!userId || !questionHash) return false;
  const usage = await CreditUsage.exists({
    dedupeKey: creditDedupeKey(userId, action, questionHash)
  });
  return !!usage;
}

async function shouldChargeForQuestion(userId, action, questionHash, activityField = 'lastSeenAt') {
  if (!userId || !questionHash) return true;
  const checks = [hasCreditUsage(userId, action, questionHash)];

  if (activityField !== false) {
    checks.push(StudyNote.exists({
      user: userId,
      questionHash
    }));
  }

  const [recentUsage, recentActivity] = await Promise.all(checks);
  return !(recentUsage || recentActivity);
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

async function claimCreditUsage(userId, action, questionHash, count = 1) {
  const now = new Date();
  const dedupeExpiresAt = new Date(now.getTime() + CREDIT_DEDUPE_WINDOW_MS);
  const dedupeKey = creditDedupeKey(userId, action, questionHash);

  try {
    const usage = await CreditUsage.create({
      user: userId,
      action,
      questionHash,
      dedupeKey,
      credits: count,
      dedupeExpiresAt,
      chargedAt: now
    });
    return { shouldCharge: true, usage };
  } catch (error) {
    if (error.code !== 11000) throw error;
  }

  return { shouldCharge: false, duplicate: true };
}

async function chargeCreditOnce(user, action, questionHash, options = {}) {
  const count = Math.max(parseInt(options.count, 10) || 1, 1);
  const claim = await claimCreditUsage(user._id, action, questionHash, count);

  if (!claim.shouldCharge) {
    const freshUser = await User.findById(user._id);
    return { charged: false, duplicate: true, user: freshUser || user };
  }

  if (user.role === 'admin') {
    const adminUser = await User.findById(user._id);
    if (adminUser) {
      adminUser.stats.totalQuestionsSolved += count;
      if (options.updateStreak) adminUser.updateStreak();
      await adminUser.save();
      return { charged: false, user: adminUser };
    }
    await CreditUsage.deleteOne({ _id: claim.usage._id });
    return { error: 'User not found.', status: 404 };
  }

  const spendCheck = await userCanSpend(user, count);
  if (!spendCheck.allowed) {
    await CreditUsage.deleteOne({ _id: claim.usage._id });
    return { error: 'No credits remaining.', status: 429, remaining: spendCheck.user?.getRemaining?.() || 0 };
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
    await CreditUsage.deleteOne({ _id: claim.usage._id });
    return { error: 'No credits remaining.', status: 429, remaining: 0 };
  }

  if (options.updateStreak) {
    chargedUser.updateStreak();
    await chargedUser.save();
  }

  return { charged: true, user: chargedUser };
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

    let responseUser = user;
    if (chargeCredits) {
      const spendCheck = await userCanSpend(user, 1);
      if (!spendCheck.allowed) {
        return res.status(429).json({ error: 'No credits remaining.', limitReached: true, remaining: spendCheck.user?.getRemaining?.() || 0 });
      }
      responseUser = spendCheck.user || user;
    }

    const cached = await CachedAnswer.findCached(snapshotQuestionData);
    if (cached !== null) {
      const cachedDoc = await CachedAnswer.findOne({ questionHash });
      const answer = await normalizeCachedAnswer(cachedDoc, cached, 'text');
      const studyNote = await saveStudyNote(user._id, cachedDoc, {
        ...req.body,
        url: req.body.sourceUrl,
        platform: req.body.platform || 'focusscan',
        questionImageBase64: imageData
      });
      if (chargeCredits) {
        const creditCharge = await chargeCreditOnce(user, 'solve-snapshot', questionHash, { updateStreak: true });
        if (creditCharge.error) {
          return res.status(creditCharge.status || 500).json({ error: creditCharge.error, limitReached: creditCharge.status === 429, remaining: creditCharge.remaining || 0 });
        }
        responseUser = creditCharge.user || responseUser;
      }
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
    const studyNote = await saveStudyNote(user._id, cachedDoc, {
      ...req.body,
      url: req.body.sourceUrl,
      platform: req.body.platform || 'focusscan',
      questionImageBase64: imageData
    });

    if (chargeCredits) {
      const creditCharge = await chargeCreditOnce(user, 'solve-snapshot', questionHash, { updateStreak: true });
      if (creditCharge.error) {
        return res.status(creditCharge.status || 500).json({ error: creditCharge.error, limitReached: creditCharge.status === 429, remaining: creditCharge.remaining || 0 });
      }
      responseUser = creditCharge.user || responseUser;
    }

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
    console.error('[Quiz] FocusScan error:', error.type || 'UNKNOWN', error.message);
    const status = statusForAIError(error);
    res.status(status).json({ error: error.message || 'FocusScan processing error.', type: error.type });
  }
});

router.post('/solve', preventConcurrentQuiz, async (req, res) => {
  try {
    const { questionData } = req.body;
    const user = req.user;

    const err = validateQuestionData(questionData);
    if (err) return res.status(400).json({ error: err });

    const cleanupErr = normalizeQuestionPayload(questionData);
    if (cleanupErr) return res.status(400).json({ error: cleanupErr });

    const questionHash = CachedAnswer.generateHash(questionData);

    const chargeCredits = await shouldChargeForQuestion(user._id, 'solve', questionHash);

    let responseUser = user;
    if (chargeCredits) {
      const spendCheck = await userCanSpend(user, 1);
      if (!spendCheck.allowed) {
        return res.status(429).json({ error: 'No credits remaining.', limitReached: true, remaining: spendCheck.user?.getRemaining?.() || 0 });
      }
      responseUser = spendCheck.user || user;
    }

    const cached = await CachedAnswer.findCached(questionData);
    if (cached !== null) {
      const cachedDoc = await CachedAnswer.findOne({ questionHash });
      const answer = await normalizeCachedAnswer(cachedDoc, cached, questionData.type);
      const studyNote = await saveStudyNote(user._id, cachedDoc, req.body);
      if (chargeCredits) {
        const creditCharge = await chargeCreditOnce(user, 'solve', questionHash, { updateStreak: true });
        if (creditCharge.error) {
          return res.status(creditCharge.status || 500).json({ error: creditCharge.error, limitReached: creditCharge.status === 429, remaining: creditCharge.remaining || 0 });
        }
        responseUser = creditCharge.user || responseUser;
      }
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
    const studyNote = await saveStudyNote(user._id, cachedDoc, req.body);
    if (chargeCredits) {
      const creditCharge = await chargeCreditOnce(user, 'solve', questionHash, { updateStreak: true });
      if (creditCharge.error) {
        return res.status(creditCharge.status || 500).json({ error: creditCharge.error, limitReached: creditCharge.status === 429, remaining: creditCharge.remaining || 0 });
      }
      responseUser = creditCharge.user || responseUser;
    }

    res.json({
      success: true,
      answer,
      cached: false,
      remaining: remainingFor(responseUser),
      studyNoteSaved: !!studyNote,
      noteId: studyNote?._id || null
    });

  } catch (error) {
    console.error('[Quiz] Solve error:', error.type || 'UNKNOWN', error.message);
    const status = statusForAIError(error);
    res.status(status).json({ error: error.message || 'AI processing error.', type: error.type });
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
      const chargeCredits = !chargeHashesInRequest.has(questionHash)
        && await shouldChargeForQuestion(user._id, 'solve', questionHash);

      if (chargeCredits) chargeHashesInRequest.add(questionHash);
      preparedQuestions.push({ questionData, questionHash, chargeCredits });
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

    const results = [];

    for (const { questionData, questionHash, chargeCredits, invalidError } of preparedQuestions) {
      if (invalidError) {
        results.push({ success: false, error: invalidError });
        continue;
      }

      try {
        const cached = await CachedAnswer.findCached(questionData);
        if (cached !== null) {
          const cachedDoc = await CachedAnswer.findOne({ questionHash });
          const answer = await normalizeCachedAnswer(cachedDoc, cached, questionData.type);
          const studyNote = await saveStudyNote(user._id, cachedDoc, { ...req.body, questionData });
          if (chargeCredits) {
            const creditCharge = await chargeCreditOnce(user, 'solve', questionHash);
            if (creditCharge.error) {
              results.push({ success: false, error: creditCharge.error, limitReached: creditCharge.status === 429 });
              continue;
            }
            responseUser = creditCharge.user || responseUser;
          }
          results.push({ success: true, answer, cached: true, noteId: studyNote?._id || null });
          continue;
        }

        const answer = await callAI(questionData);
        const cachedDoc = await CachedAnswer.cacheAnswer(questionData, answer);
        const studyNote = await saveStudyNote(user._id, cachedDoc, { ...req.body, questionData });
        if (chargeCredits) {
          const creditCharge = await chargeCreditOnce(user, 'solve', questionHash);
          if (creditCharge.error) {
            results.push({ success: false, error: creditCharge.error, limitReached: creditCharge.status === 429 });
            continue;
          }
          responseUser = creditCharge.user || responseUser;
        }
        results.push({ success: true, answer, cached: false, noteId: studyNote?._id || null });

      } catch (qErr) {
        results.push({ success: false, error: qErr.message, type: qErr.type });
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
  try {
    const { answer } = req.body;
    const text = sanitizeText(req.body.text);
    const options = Array.isArray(req.body.options) ? req.body.options.map(sanitizeText) : [];
    const type = ['radio', 'checkbox', 'text', 'matching', 'matrix'].includes(req.body.type) ? req.body.type : 'radio';
    const prompts = Array.isArray(req.body.prompts) ? req.body.prompts.map(sanitizeText).slice(0, 30) : [];
    const rows = Array.isArray(req.body.rows) ? req.body.rows.map(sanitizeText).slice(0, 30) : [];
    const user = req.user;

    if (!text || answer === undefined) {
      return res.status(400).json({ error: 'Missing question text or answer.' });
    }

    const questionData = { text, options, type, prompts, rows };
    const questionHash = CachedAnswer.generateHash(questionData);

    const chargeCredits = await shouldChargeForQuestion(user._id, 'explain', questionHash, 'lastExplainedAt');

    let responseUser = user;
    if (chargeCredits) {
      const spendCheck = await userCanSpend(user, 1);
      if (!spendCheck.allowed) {
        return res.status(429).json({ error: 'No credits remaining.', limitReached: true, remaining: spendCheck.user?.getRemaining?.() || 0 });
      }
      responseUser = spendCheck.user || user;
    }

    const explanation = await callExplanationAI(text, options, answer, type, req.body.explanationLanguage || 'auto', { prompts, rows });
    let cachedDoc = await CachedAnswer.findOne({ questionHash });
    if (!cachedDoc) cachedDoc = await CachedAnswer.cacheAnswer(questionData, answer);
    const studyNote = await saveStudyNote(user._id, cachedDoc, req.body, { explanation });

    if (chargeCredits) {
      const creditCharge = await chargeCreditOnce(user, 'explain', questionHash);
      if (creditCharge.error) {
        return res.status(creditCharge.status || 500).json({ error: creditCharge.error, limitReached: creditCharge.status === 429, remaining: creditCharge.remaining || 0 });
      }
      responseUser = creditCharge.user || responseUser;
    }

    res.json({
      success: true,
      explanation,
      remaining: remainingFor(responseUser),
      studyNoteSaved: !!studyNote,
      noteId: studyNote?._id || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Explanation error.' });
  }
});


/* ── QUIZ SESSIONS ── */

router.post('/follow-up', preventConcurrentQuiz, async (req, res) => {
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

    if (!text || answer === undefined) {
      return res.status(400).json({ error: 'Missing question text or answer.' });
    }

    const questionData = { text, options, type, prompts, rows };
    const questionHash = CachedAnswer.generateHash(questionData);
    const chargeCredits = await shouldChargeForQuestion(user._id, 'follow-up', questionHash, null);

    let responseUser = user;
    if (chargeCredits) {
      const spendCheck = await userCanSpend(user, 1);
      if (!spendCheck.allowed) {
        return res.status(429).json({ error: 'No credits remaining.', limitReached: true, remaining: spendCheck.user?.getRemaining?.() || 0 });
      }
      responseUser = spendCheck.user || user;
    }

    const followUp = await callFollowUpAI({
      text,
      options,
      answer,
      type,
      prompt,
      previousExplanation,
      explanationLanguage: req.body.explanationLanguage || 'auto',
      prompts,
      rows
    });

    let cachedDoc = await CachedAnswer.findOne({ questionHash });
    if (!cachedDoc) cachedDoc = await CachedAnswer.cacheAnswer(questionData, answer);
    const studyNote = await saveStudyNote(user._id, cachedDoc, req.body, { explanation: followUp });

    if (chargeCredits) {
      const creditCharge = await chargeCreditOnce(user, 'follow-up', questionHash);
      if (creditCharge.error) {
        return res.status(creditCharge.status || 500).json({ error: creditCharge.error, limitReached: creditCharge.status === 429, remaining: creditCharge.remaining || 0 });
      }
      responseUser = creditCharge.user || responseUser;
    }

    res.json({
      success: true,
      followUp,
      remaining: remainingFor(responseUser),
      studyNoteSaved: !!studyNote,
      noteId: studyNote?._id || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Follow-up error.' });
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
