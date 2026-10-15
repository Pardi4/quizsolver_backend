const mongoose = require('mongoose');

const uninstallFeedbackSchema = new mongoose.Schema({
  reasons: [{
    type: String,
    trim: true
  }],
  customReason: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
  },
  feedback: {
    type: String,
    trim: true,
    maxlength: 3000,
    default: ''
  },
  platformUsed: {
    type: String,
    trim: true,
    maxlength: 120,
    default: ''
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 254,
    default: ''
  },
  extensionVersion: {
    type: String,
    trim: true,
    maxlength: 50,
    default: ''
  },
  lang: {
    type: String,
    trim: true,
    maxlength: 10,
    default: 'pl'
  },
  userAgent: {
    type: String,
    trim: true,
    maxlength: 400,
    default: ''
  },
  ip: {
    type: String,
    trim: true,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

uninstallFeedbackSchema.index({ createdAt: -1 });

module.exports = mongoose.model('UninstallFeedback', uninstallFeedbackSchema);
