const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { quizLimiter } = require('../middleware/rateLimiter');
const CachedAnswer = require('../models/CachedAnswer');
const StudyNote = require('../models/StudyNote');
const QuizSession = require('../models/QuizSession');
const SharedQuiz = require('../models/SharedQuiz');
const { cleanQuizText } = require('../utils/textSanitizer');

const router = express.Router();

router.use(authMiddleware);

const {
  AIError,
  MAX_IMAGE_DATA_URL_LENGTH,
  parseDataImage,
  shortenTextAnswer,
  callAI,
  solveSnapshotImage,
  callExplanationAI
} = require('../services/aiService');

function validateQuestionData(q) {
  if (!q || typeof q !== 'object') return 'Missing question data.';
  if (!q.text || typeof q.text !== 'string') return 'Missing question text.';
  if (q.text.trim().length < 3) return 'Question text too short.';
  if (q.text.length > 2000) return 'Question text too long (max 2000 chars).';
  if (q.type && !['radio', 'checkbox', 'text'].includes(q.type)) return 'Invalid question type.';
  if (q.imageUrl !== undefined && q.imageUrl !== null && q.imageUrl !== '') {
    if (typeof q.imageUrl !== 'string') return 'Image URL must be a string.';
    if (q.imageUrl.length > MAX_IMAGE_DATA_URL_LENGTH) return 'Image too large.';
  }
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

  if (!questionData.text && questionData.imageUrl) {
    questionData.text = 'Question shown in image';
  }

  if (!questionData.text) {
    return 'Question text empty after cleanup.';
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
    answer: note.answer,
    answerText: answerToText(note.questionType, options, note.answer),
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

router.post('/solve-snapshot', async (req, res) => {
  try {
    const imageData = String(req.body.imageData || '');
    const user = req.user;

    if (!parseDataImage(imageData)) {
      return res.status(400).json({ error: 'Missing or invalid FocusScan image.' });
    }
    if (imageData.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return res.status(400).json({ error: 'FocusScan image too large.' });
    }
    if (!user.canUse(1)) {
      return res.status(429).json({ error: 'No credits remaining.', limitReached: true, remaining: 0 });
    }

    const imageFingerprint = CachedAnswer.generateImageFingerprint({ imageUrl: imageData });
    const snapshotQuestionData = {
      text: `FocusScan:${imageFingerprint}`,
      options: [],
      type: 'text',
      imageFingerprint
    };

    const cached = await CachedAnswer.findCached(snapshotQuestionData);
    if (cached !== null) {
      const cachedDoc = await CachedAnswer.findOne({ questionHash: CachedAnswer.generateHash(snapshotQuestionData) });
      const answer = await normalizeCachedAnswer(cachedDoc, cached, 'text');
      const studyNote = await saveStudyNote(user._id, cachedDoc, {
        ...req.body,
        url: req.body.sourceUrl,
        platform: req.body.platform || 'focusscan',
        questionImageBase64: imageData
      });
      user.useCredits(1);
      user.updateStreak();
      await user.save();
      return res.json({
        success: true,
        answer,
        extractedQuestion: cachedDoc?.questionText || 'FocusScan image question',
        cached: true,
        remaining: user.getRemaining(),
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

    user.useCredits(1);
    user.updateStreak();
    await user.save();

    res.json({
      success: true,
      answer: solved.answer,
      extractedQuestion: solved.extractedQuestion,
      cached: false,
      remaining: user.getRemaining(),
      studyNoteSaved: !!studyNote,
      noteId: studyNote?._id || null
    });
  } catch (error) {
    console.error('[Quiz] FocusScan error:', error.type || 'UNKNOWN', error.message);
    const status = error.type === 'AI_TIMEOUT' ? 504 : 500;
    res.status(status).json({ error: error.message || 'FocusScan processing error.', type: error.type });
  }
});

router.post('/solve', async (req, res) => {
  try {
    const { questionData } = req.body;
    const user = req.user;

    const err = validateQuestionData(questionData);
    if (err) return res.status(400).json({ error: err });

    const cleanupErr = normalizeQuestionPayload(questionData);
    if (cleanupErr) return res.status(400).json({ error: cleanupErr });

    if (!user.canUse(1)) {
      return res.status(429).json({ error: 'No credits remaining.', limitReached: true, remaining: 0 });
    }

    const questionHash = CachedAnswer.generateHash(questionData);
    const cached = await CachedAnswer.findCached(questionData);
    if (cached !== null) {
      const cachedDoc = await CachedAnswer.findOne({ questionHash });
      const answer = await normalizeCachedAnswer(cachedDoc, cached, questionData.type);
      const studyNote = await saveStudyNote(user._id, cachedDoc, req.body);
      user.useCredits(1);
      user.updateStreak();
      await user.save();
      return res.json({
        success: true,
        answer,
        cached: true,
        remaining: user.getRemaining(),
        studyNoteSaved: !!studyNote,
        noteId: studyNote?._id || null
      });
    }

    const answer = await callAI(questionData);
    const cachedDoc = await CachedAnswer.cacheAnswer(questionData, answer);
    const studyNote = await saveStudyNote(user._id, cachedDoc, req.body);
    user.useCredits(1);
    user.updateStreak();
    await user.save();

    res.json({
      success: true,
      answer,
      cached: false,
      remaining: user.getRemaining(),
      studyNoteSaved: !!studyNote,
      noteId: studyNote?._id || null
    });

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

      const cleanupErr = normalizeQuestionPayload(questionData);
      if (cleanupErr) { results.push({ success: false, error: cleanupErr }); continue; }

      try {
        const questionHash = CachedAnswer.generateHash(questionData);
        const cached = await CachedAnswer.findCached(questionData);
        if (cached !== null) {
          const cachedDoc = await CachedAnswer.findOne({ questionHash });
          const answer = await normalizeCachedAnswer(cachedDoc, cached, questionData.type);
          const studyNote = await saveStudyNote(user._id, cachedDoc, { ...req.body, questionData });
          user.useCredits(1);
          results.push({ success: true, answer, cached: true, noteId: studyNote?._id || null });
          continue;
        }

        const answer = await callAI(questionData);
        const cachedDoc = await CachedAnswer.cacheAnswer(questionData, answer);
        const studyNote = await saveStudyNote(user._id, cachedDoc, { ...req.body, questionData });
        user.useCredits(1);
        results.push({ success: true, answer, cached: false, noteId: studyNote?._id || null });

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
    const studyNote = await saveStudyNote(user._id, cachedDoc, req.body, { explanation });

    user.useCredits(1);
    await user.save();

    res.json({
      success: true,
      explanation,
      remaining: user.getRemaining(),
      studyNoteSaved: !!studyNote,
      noteId: studyNote?._id || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Explanation error.' });
  }
});


/* ── QUIZ SESSIONS ── */

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

    const notes = await StudyNote.find({ _id: { $in: noteIds }, user: req.user._id }).lean();
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

publicRouter.post('/shared/:token/attempt', async (req, res) => {
  try {
    const shared = await SharedQuiz.findOne({ token: req.params.token, isActive: true });
    if (!shared) return res.status(404).json({ error: 'Shared quiz not found.' });

    const answers = Array.isArray(req.body.answers) ? req.body.answers.slice(0, 50) : [];
    const displayName = String(req.body.displayName || 'Anonymous').substring(0, 60);
    const userId = req.body.userId || null;

    const notes = await StudyNote.find({ _id: { $in: shared.noteIds } }).lean();
    let score = 0;
    notes.forEach((note, i) => {
      const given = answers[i];
      const correct = note.answer;
      if (note.questionType === 'radio' && given === correct) score++;
      else if (note.questionType === 'checkbox' && Array.isArray(given) && Array.isArray(correct)
        && JSON.stringify([...given].sort()) === JSON.stringify([...correct].sort())) score++;
      else if (note.questionType === 'text' && typeof given === 'string'
        && given.trim().toLowerCase() === String(correct).trim().toLowerCase()) score++;
    });

    await SharedQuiz.updateOne({ _id: shared._id }, {
      $push: { attempts: { userId, displayName, answers, score, totalQuestions: notes.length, completedAt: new Date() } }
    });

    const correctAnswers = notes.map(note => ({
      id: note._id,
      answer: note.answer,
      answerText: answerToText(note.questionType, (note.options || []).map(cleanQuizText), note.answer),
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
