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
    enum: ['radio', 'checkbox', 'text', 'matching', 'matrix', 'ordering'],
    required: true
  },
  options: [String],
  prompts: [String],
  rows: [String],
  answer: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  answerText: {
    type: String,
    default: '',
    maxlength: 2000
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
      validator: function(v) { return !v || v.length <= 4 * 1024 * 1024; },
      message: 'Question image too large (max ~3MB).'
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
  hostname: {
    type: String,
    default: '',
    maxlength: 180
  },
  platform: {
    type: String,
    default: ''
  },
  extensionVersion: {
    type: String,
    default: '',
    maxlength: 40,
    index: true
  },
  extensionVersions: {
    type: [String],
    default: []
  },
  containerHtml: {
    type: String,
    default: '',
    maxlength: 40000
  },
  pageHtmlSnippet: {
    type: String,
    default: '',
    maxlength: 15000
  },
  fullHtmlFile: {
    id: { type: String, default: '', maxlength: 100 },
    filename: { type: String, default: '', maxlength: 140 },
    bytes: { type: Number, default: 0 },
    sha256: { type: String, default: '', maxlength: 80 },
    truncated: { type: Boolean, default: false },
    capturedAt: { type: Date, default: null }
  },
  hiddenFromUser: {
    type: Boolean,
    default: false
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
studyNoteSchema.index({ extensionVersion: 1, lastSeenAt: -1 });
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

  if (updates.answerText !== undefined && updates.answerText !== '') {
    set.answerText = String(updates.answerText).substring(0, 2000);
  }

  if (updates.explanation !== undefined) {
    set.explanation = String(updates.explanation || '').substring(0, 2000);
    set.lastExplainedAt = new Date();
  }

  if (updates.sourceUrl !== undefined && updates.sourceUrl !== '') {
    set.sourceUrl = String(updates.sourceUrl || '').substring(0, 500);
  }
  if (updates.hostname !== undefined && updates.hostname !== '') {
    set.hostname = String(updates.hostname || '').substring(0, 180);
  }
  if (updates.platform !== undefined && updates.platform !== '') {
    set.platform = String(updates.platform || '').substring(0, 80);
  }
  const cleanExtVersion = updates.extensionVersion !== undefined
    ? String(updates.extensionVersion || '').trim().substring(0, 40)
    : '';
  if (cleanExtVersion) {
    set.extensionVersion = cleanExtVersion;
  }
  if (updates.quizSessionId !== undefined) set.quizSessionId = updates.quizSessionId;

  if (updates.containerHtml !== undefined && updates.containerHtml) {
    set.containerHtml = String(updates.containerHtml).substring(0, 40000);
  }
  if (updates.pageHtmlSnippet !== undefined && updates.pageHtmlSnippet) {
    set.pageHtmlSnippet = String(updates.pageHtmlSnippet).substring(0, 15000);
  }
  if (updates.fullHtmlFile && typeof updates.fullHtmlFile === 'object' && updates.fullHtmlFile.id) {
    set.fullHtmlFile = {
      id: String(updates.fullHtmlFile.id || '').substring(0, 100),
      filename: String(updates.fullHtmlFile.filename || '').substring(0, 140),
      bytes: Math.max(0, Number(updates.fullHtmlFile.bytes || 0)),
      sha256: String(updates.fullHtmlFile.sha256 || '').substring(0, 80),
      truncated: Boolean(updates.fullHtmlFile.truncated),
      capturedAt: updates.fullHtmlFile.capturedAt || new Date()
    };
  }

  if (updates.hiddenFromUser === false) {
    set.hiddenFromUser = false;
  }

  if (updates.questionImageBase64 !== undefined && updates.questionImageBase64) {
    const MAX = 4 * 1024 * 1024;
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

  const setOnInsert = {
    user: userId,
    cachedAnswer: cachedAnswer._id,
    favorite: false,
    status: 'new',
    personalNote: '',
    userNote: '',
    tags: []
  };
  if (updates.hiddenFromUser === true) {
    setOnInsert.hiddenFromUser = true;
  }

  const updateDoc = {
    $set: set,
    $setOnInsert: setOnInsert,
    $inc: inc
  };
  if (cleanExtVersion) {
    updateDoc.$addToSet = { extensionVersions: cleanExtVersion };
  }

  return this.findOneAndUpdate(
    { user: userId, cachedAnswer: cachedAnswer._id },
    updateDoc,
    { new: true, upsert: true }
  );
};

module.exports = mongoose.model('StudyNote', studyNoteSchema);
