const mongoose = require('mongoose');

const studyNoteSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  cachedAnswer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CachedAnswer',
    required: true,
    index: true
  },
  questionHash: {
    type: String,
    required: true,
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
  explanation: {
    type: String,
    default: ''
  },
  personalNote: {
    type: String,
    default: '',
    maxlength: 1000
  },
  tags: [String],
  favorite: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['new', 'learning', 'mastered'],
    default: 'new'
  },
  sourceUrl: {
    type: String,
    default: ''
  },
  platform: {
    type: String,
    default: ''
  },
  seenCount: {
    type: Number,
    default: 1
  },
  explainCount: {
    type: Number,
    default: 0
  },
  lastSeenAt: {
    type: Date,
    default: Date.now
  },
  lastExplainedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

studyNoteSchema.index({ user: 1, cachedAnswer: 1 }, { unique: true });
studyNoteSchema.index({ user: 1, lastSeenAt: -1 });
studyNoteSchema.index({ user: 1, favorite: 1, lastSeenAt: -1 });
studyNoteSchema.index({ user: 1, status: 1, lastSeenAt: -1 });

studyNoteSchema.statics.upsertFromCache = async function(userId, cachedAnswer, updates = {}) {
  if (!userId || !cachedAnswer?._id) return null;

  const set = {
    questionHash: cachedAnswer.questionHash,
    questionText: cachedAnswer.questionText,
    questionType: cachedAnswer.questionType,
    options: cachedAnswer.options || [],
    answer: cachedAnswer.answer,
    lastSeenAt: new Date()
  };

  if (updates.explanation !== undefined) {
    set.explanation = String(updates.explanation || '').substring(0, 2000);
    set.lastExplainedAt = new Date();
  }

  if (updates.sourceUrl !== undefined) set.sourceUrl = String(updates.sourceUrl || '').substring(0, 500);
  if (updates.platform !== undefined) set.platform = String(updates.platform || '').substring(0, 80);

  const inc = { seenCount: 1 };
  if (updates.explanation !== undefined) inc.explainCount = 1;

  return this.findOneAndUpdate(
    { user: userId, cachedAnswer: cachedAnswer._id },
    {
      $set: set,
      $setOnInsert: {
        user: userId,
        cachedAnswer: cachedAnswer._id,
        favorite: false,
        status: 'new',
        personalNote: '',
        tags: []
      },
      $inc: inc
    },
    { new: true, upsert: true }
  );
};

module.exports = mongoose.model('StudyNote', studyNoteSchema);
