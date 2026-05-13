const mongoose = require('mongoose');
const crypto = require('crypto');

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
    enum: ['radio', 'checkbox', 'text'],
    required: true
  },
  options: [String],
  answer: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  hitCount: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: Date.now }
});

cachedAnswerSchema.statics.generateHash = function(questionData) {
  const sortedOptions = [...(questionData.options || [])].map(o => o.trim().toLowerCase()).sort();

  const normalized = JSON.stringify({
    text: (questionData.text || '').trim().toLowerCase().replace(/\s+/g, ' '),
    options: sortedOptions,
    type: questionData.type
  });
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

cachedAnswerSchema.statics.findCached = async function(questionData) {
  const hash = this.generateHash(questionData);
  const cached = await this.findOne({ questionHash: hash });
  if (cached) {
    cached.hitCount += 1;
    cached.lastUsedAt = new Date();
    await cached.save();

    if (questionData.type === 'radio' && typeof cached.answer === 'number') {
      const oldText = cached.options[cached.answer];
      if (oldText && questionData.options) {
        const newIdx = questionData.options.findIndex(o => o.trim() === oldText.trim());
        if (newIdx !== -1) return newIdx;
      }
    } else if (questionData.type === 'checkbox' && Array.isArray(cached.answer)) {
      if (questionData.options) {
        const newIndices = [];
        for (const oldIdx of cached.answer) {
          const oldText = cached.options[oldIdx];
          if (oldText) {
            const newIdx = questionData.options.findIndex(o => o.trim() === oldText.trim());
            if (newIdx !== -1) newIndices.push(newIdx);
          }
        }
        if (newIndices.length > 0) return newIndices;
      }
    }

    return cached.answer;
  }
  return null;
};

cachedAnswerSchema.statics.cacheAnswer = async function(questionData, answer) {
  const hash = this.generateHash(questionData);
  try {
    return await this.findOneAndUpdate(
      { questionHash: hash },
      {
        $set: {
          questionText: (questionData.text || '').substring(0, 500),
          questionType: questionData.type,
          options: (questionData.options || []).map(o => o.substring(0, 200)),
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
    if (error.code !== 11000) {
      console.error('[Cache] Save error:', error.message);
    }
    return null;
  }
};

cachedAnswerSchema.index({ lastUsedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('CachedAnswer', cachedAnswerSchema);
