const mongoose = require('mongoose');
const crypto = require('crypto');
const { cleanQuizText } = require('../utils/textSanitizer');
const { cacheSafeQuestionText, isQuestionChromeOnly } = require('../utils/questionTextGuard');

const cachedAnswerSchema = new mongoose.Schema({
  questionHash: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  questionText: {
    type: String,
    required: true
  },
  questionType: {
    type: String,
    enum: ['radio', 'checkbox', 'text', 'matching', 'matrix'],
    required: true
  },
  options: [String],
  prompts: [String],
  rows: [String],
  imageFingerprint: {
    type: String,
    default: ''
  },
  answer: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  hitCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: Date.now }
});

function normalizeOption(text) {
  return cleanQuizText(text).toLowerCase().replace(/\s+/g, ' ');
}

function imageFingerprint(questionData) {
  const raw = String(questionData?.imageFingerprint || questionData?.imageUrl || '').trim();
  if (!raw) return '';

  if (raw.startsWith('data:image/')) {
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return crypto
        .createHash('sha256')
        .update(`${parsed.protocol}//${parsed.hostname}${parsed.pathname}`)
        .digest('hex')
        .slice(0, 32);
    }
  } catch {}

  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

cachedAnswerSchema.statics.generateImageFingerprint = imageFingerprint;

cachedAnswerSchema.statics.generateHash = function(questionData) {
  const sortedOptions = [...(questionData.options || [])].map(normalizeOption).sort();
  const normalizedText = cacheSafeQuestionText(questionData.text).toLowerCase().replace(/\s+/g, ' ');

  const normalized = JSON.stringify({
    text: normalizedText,
    options: sortedOptions,
    prompts: [...(questionData.prompts || [])].map(normalizeOption),
    rows: [...(questionData.rows || [])].map(normalizeOption),
    type: questionData.type,
    image: imageFingerprint(questionData)
  });
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

cachedAnswerSchema.statics.findCached = async function(questionData) {
  if (isQuestionChromeOnly(questionData?.text) && !imageFingerprint(questionData)) {
    return null;
  }

  const hash = this.generateHash(questionData);
  const cached = await this.findOne({ questionHash: hash });
  if (cached) {
    cached.hitCount += 1;
    cached.lastUsedAt = new Date();
    await cached.save();

    if (questionData.type === 'radio' && typeof cached.answer === 'number') {
      const oldText = cached.options[cached.answer];
      if (oldText && questionData.options) {
        const newIdx = questionData.options.findIndex(o => normalizeOption(o) === normalizeOption(oldText));
        if (newIdx !== -1) return newIdx;
      }
    } else if (['checkbox', 'matching', 'matrix'].includes(questionData.type) && Array.isArray(cached.answer)) {
      if (questionData.options) {
        const newIndices = [];
        for (const oldIdx of cached.answer) {
          const oldText = cached.options[oldIdx];
          if (oldText) {
            const newIdx = questionData.options.findIndex(o => normalizeOption(o) === normalizeOption(oldText));
            if (newIdx !== -1) newIndices.push(newIdx);
          }
        }
        if (newIndices.length === cached.answer.length) return newIndices;
        if (['matching', 'matrix'].includes(questionData.type)) return cached.answer;
      }
    }

    return cached.answer;
  }
  return null;
};

cachedAnswerSchema.statics.cacheAnswer = async function(questionData, answer) {
  if (isQuestionChromeOnly(questionData?.text) && !imageFingerprint(questionData)) {
    return null;
  }

  const hash = this.generateHash(questionData);
  const displayQuestionText = (
    cacheSafeQuestionText(questionData.cacheQuestionText || questionData.text || '') ||
    cleanQuizText(questionData.imageCaption || questionData.imageAlt || questionData.text || '') ||
    (imageFingerprint(questionData) ? 'Image question' : 'Question')
  );
  try {
    return await this.findOneAndUpdate(
      { questionHash: hash },
      {
        $set: {
          questionText: displayQuestionText.substring(0, 500),
          questionType: questionData.type,
          options: (questionData.options || []).map(o => cleanQuizText(o).substring(0, 200)),
          prompts: (questionData.prompts || []).map(o => cleanQuizText(o).substring(0, 200)),
          rows: (questionData.rows || []).map(o => cleanQuizText(o).substring(0, 200)),
          imageFingerprint: imageFingerprint(questionData),
          answer: answer,
          lastUsedAt: new Date()
        },
        $setOnInsert: {
          questionHash: hash,
          createdAt: new Date()
        },
        $inc: { hitCount: 1 }
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    if (error.code === 11000) {
      return this.findOne({ questionHash: hash });
    }
    console.error('[Cache] Save error:', error.message);
    return null;
  }
};

cachedAnswerSchema.index({ lastUsedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('CachedAnswer', cachedAnswerSchema);
