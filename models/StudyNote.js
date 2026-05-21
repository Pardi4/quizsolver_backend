const mongoose = require('mongoose');

const MAX_IMAGE_BASE64 = 2 * 1024 * 1024; // 2MB base64 string (~1.5MB actual image)

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
  quizSessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuizSession',
    default: null,
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
    enum: ['radio', 'checkbox', 'text', 'matching', 'matrix'],
    required: true
  },
  options: [String],
  prompts: [String],
  rows: [String],
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
  userNote: {
    type: String,
    default: '',
    maxlength: 500
  },
  questionImageBase64: {
    type: String,
    default: '',
    validate: {
      validator: function(v) { return !v || v.length <= MAX_IMAGE_BASE64; },
      message: 'Question image too large (max ~1.5MB).'
    }
  },
  questionImageUrl: {
    type: String,
    default: '',
    maxlength: 1200
  },
  imageExpiresAt: {
    type: Date,
    default: null
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
  },
  noteExpiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000)
  }
}, { timestamps: true });

studyNoteSchema.index({ user: 1, cachedAnswer: 1 }, { unique: true });
studyNoteSchema.index({ user: 1, lastSeenAt: -1 });
studyNoteSchema.index({ user: 1, favorite: 1, lastSeenAt: -1 });
studyNoteSchema.index({ user: 1, status: 1, lastSeenAt: -1 });
studyNoteSchema.index({ user: 1, quizSessionId: 1, lastSeenAt: -1 });
studyNoteSchema.index({ noteExpiresAt: 1 }, { expireAfterSeconds: 0 });


studyNoteSchema.statics.upsertFromCache = async function(userId, cachedAnswer, updates = {}) {
  if (!userId || !cachedAnswer?._id) return null;

  const set = {
    questionHash: cachedAnswer.questionHash,
    questionText: cachedAnswer.questionText,
    questionType: cachedAnswer.questionType,
    options: cachedAnswer.options || [],
    prompts: cachedAnswer.prompts || [],
    rows: cachedAnswer.rows || [],
    answer: cachedAnswer.answer,
    lastSeenAt: new Date()
  };

  if (updates.explanation !== undefined) {
    set.explanation = String(updates.explanation || '').substring(0, 2000);
    set.lastExplainedAt = new Date();
  }

  if (updates.sourceUrl !== undefined) set.sourceUrl = String(updates.sourceUrl || '').substring(0, 500);
  if (updates.platform !== undefined) set.platform = String(updates.platform || '').substring(0, 80);
  if (updates.quizSessionId !== undefined) set.quizSessionId = updates.quizSessionId;

  if (updates.questionImageBase64 !== undefined && updates.questionImageBase64) {
    const MAX = 2 * 1024 * 1024;
    if (updates.questionImageBase64.length <= MAX) {
      set.questionImageBase64 = updates.questionImageBase64;
      set.imageExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
  }

  if (updates.questionImageUrl !== undefined && updates.questionImageUrl) {
    set.questionImageUrl = String(updates.questionImageUrl || '').substring(0, 1200);
  }


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
        userNote: '',
        tags: []
      },
      $inc: inc
    },
    { new: true, upsert: true }
  );
};

module.exports = mongoose.model('StudyNote', studyNoteSchema);
