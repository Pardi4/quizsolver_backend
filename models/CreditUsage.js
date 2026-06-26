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
  credits: {
    type: Number,
    default: 1,
    min: 1
  },
  dedupeExpiresAt: {
    type: Date,
    required: true,
    index: true
  },
  chargedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

creditUsageSchema.index({ user: 1, action: 1, questionHash: 1 });
creditUsageSchema.index({ dedupeExpiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = mongoose.model('CreditUsage', creditUsageSchema);
