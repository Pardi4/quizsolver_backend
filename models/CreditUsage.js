const mongoose = require('mongoose');

const creditUsageSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  action: {
    type: String,
    enum: ['solve', 'solve-snapshot', 'solve-batch', 'explain', 'follow-up'],
    required: true,
    index: true
  },
  questionHash: {
    type: String,
    required: true,
    index: true
  },
  dedupeKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  dedupeWindow: {
    type: String,
    default: '',
    index: true
  },
  dedupeWindowMs: {
    type: Number,
    default: 0
  },
  credits: {
    type: Number,
    default: 1,
    min: 1
  },
  status: {
    type: String,
    enum: ['claimed', 'charged', 'waived', 'aborted', 'declined'],
    default: 'claimed',
    index: true
  },
  charged: {
    type: Boolean,
    default: false,
    index: true
  },
  waivedReason: {
    type: String,
    default: '',
    maxlength: 120
  },
  claimedAt: {
    type: Date,
    default: Date.now
  },
  chargedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true, autoIndex: false });

creditUsageSchema.index({ user: 1, action: 1, questionHash: 1 });

module.exports = mongoose.model('CreditUsage', creditUsageSchema);
