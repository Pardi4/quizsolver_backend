const mongoose = require('mongoose');

const bugReportSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  url: {
    type: String,
    required: true,
    maxlength: 500
  },
  description: {
    type: String,
    default: '',
    maxlength: 1000
  },
  platform: {
    type: String,
    default: '',
    maxlength: 80,
    index: true
  },
  parserDiagnostics: {
    outcome: { type: String, default: '', maxlength: 40 },
    confidence: { type: Number, default: 0, min: 0, max: 1 },
    reason: { type: String, default: '', maxlength: 240 },
    questionCount: { type: Number, default: 0 },
    optionCount: { type: Number, default: 0 },
    attemptedTypes: { type: [String], default: [] }
  },
  parserSnapshot: {
    title: { type: String, default: '', maxlength: 180 },
    bodyText: { type: String, default: '', maxlength: 8000 },
    htmlSnippet: { type: String, default: '', maxlength: 12000 },
    questionTexts: { type: [String], default: [] },
    optionsSample: { type: [String], default: [] },
    selectorSummary: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  source: {
    type: String,
    enum: ['manual', 'parser-auto'],
    default: 'manual',
    index: true
  },
  parserEventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ParserEvent',
    default: null,
    index: true
  },
  userAgent: String,
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  readAt: {
    type: Date,
    default: null
  },
  readBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

bugReportSchema.index({ platform: 1, createdAt: -1 });
bugReportSchema.index({ source: 1, url: 1, platform: 1, createdAt: -1 });

module.exports = mongoose.model('BugReport', bugReportSchema);
