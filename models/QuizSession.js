const mongoose = require('mongoose');

const quizSessionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    default: '',
    maxlength: 200
  },
  sourceUrl: {
    type: String,
    default: '',
    maxlength: 500
  },
  platform: {
    type: String,
    default: '',
    maxlength: 80
  },
  questionCount: {
    type: Number,
    default: 0
  },
  noteIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StudyNote'
  }]
}, {
  timestamps: true
});

quizSessionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('QuizSession', quizSessionSchema);
