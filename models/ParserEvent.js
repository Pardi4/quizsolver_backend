const mongoose = require('mongoose');

const parserEventSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  eventType: {
    type: String,
    enum: ['solve', 'manual-report', 'diagnostic'],
    default: 'solve',
    index: true
  },
  outcome: {
    type: String,
    enum: ['success', 'partial', 'empty', 'weak', 'error', 'reported'],
    default: 'empty',
    index: true
  },
  platform: {
    type: String,
    default: 'universal',
    maxlength: 80,
    index: true
  },
  detectorPlatform: {
    type: String,
    default: '',
    maxlength: 80
  },
  url: {
    type: String,
    default: '',
    maxlength: 500
  },
  hostname: {
    type: String,
    default: '',
    maxlength: 180,
    index: true
  },
  confidence: {
    type: Number,
    default: 0,
    min: 0,
    max: 1
  },
  reason: {
    type: String,
    default: '',
    maxlength: 240
  },
  questionCount: {
    type: Number,
    default: 0,
    min: 0
  },
  supportedQuestionCount: {
    type: Number,
    default: 0,
    min: 0
  },
  optionCount: {
    type: Number,
    default: 0,
    min: 0
  },
  attemptedTypes: {
    type: [String],
    default: []
  },
  questionTypes: {
    type: [String],
    default: []
  },
  parserVersion: {
    type: String,
    default: 'v2',
    maxlength: 40
  },
  extensionVersion: {
    type: String,
    default: '',
    maxlength: 40
  },
  snapshot: {
    title: { type: String, default: '', maxlength: 180 },
    bodyText: { type: String, default: '', maxlength: 8000 },
    htmlSnippet: { type: String, default: '', maxlength: 12000 },
    questionTexts: { type: [String], default: [] },
    optionsSample: { type: [String], default: [] },
    selectorSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
    fullHtmlFile: {
      id: { type: String, default: '', maxlength: 100 },
      filename: { type: String, default: '', maxlength: 140 },
      bytes: { type: Number, default: 0 },
      sha256: { type: String, default: '', maxlength: 80 },
      truncated: { type: Boolean, default: false },
      capturedAt: { type: Date, default: null }
    }
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

parserEventSchema.index({ platform: 1, outcome: 1, createdAt: -1 });
parserEventSchema.index({ hostname: 1, createdAt: -1 });
parserEventSchema.index({ createdAt: -1, confidence: 1 });

module.exports = mongoose.model('ParserEvent', parserEventSchema);
