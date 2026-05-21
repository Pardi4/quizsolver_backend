const mongoose = require('mongoose');
const crypto = require('crypto');

const sharedQuizAttemptSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  displayName: { type: String, default: 'Anonymous', maxlength: 60 },
  answers: [mongoose.Schema.Types.Mixed],
  score: { type: Number, default: 0 },
  totalQuestions: { type: Number, default: 0 },
  completedAt: { type: Date, default: Date.now }
});

const sharedQuizSchema = new mongoose.Schema({
  token: {
    type: String,
    unique: true,
    index: true,
    default: () => crypto.randomBytes(12).toString('base64url')
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    default: 'Shared Quiz',
    maxlength: 200
  },
  questionCount: { type: Number, default: 0 },
  noteIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudyNote'
  }],
  attempts: [sharedQuizAttemptSchema],
  viewCount: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000)
  }
}, { timestamps: true });

sharedQuizSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sharedQuizSchema.index({ createdBy: 1, createdAt: -1 });
sharedQuizSchema.index({ 'attempts.userId': 1, updatedAt: -1 });

module.exports = mongoose.model('SharedQuiz', sharedQuizSchema);
