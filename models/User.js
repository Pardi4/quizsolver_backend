const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const PROFANITY_LIST = ['kurw','chuj','pizd','jeba','fuck','shit','dick','ass','bitch','cunt','damn','hell','puta','merd'];

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Invalid email format']
  },
  passwordHash: {
    type: String,
    default: ''
  },
  authProviders: {
    type: [String],
    default: ['password']
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationCodeHash: { type: String, default: '' },
  emailVerificationExpiresAt: { type: Date, default: null },
  passwordResetCodeHash: { type: String, default: '' },
  passwordResetExpiresAt: { type: Date, default: null },
  passwordChangedAt: { type: Date, default: null },
  displayName: {
    type: String,
    trim: true,
    default: '',
    maxlength: 50
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  credits: {
    type: Number,
    default: 10,
    min: 0
  },
  freeCreditsLastReset: {
    type: String,
    default: ''
  },
  failedLoginAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  isBanned: { type: Boolean, default: false },
  excludeFromLeaderboard: { type: Boolean, default: false },
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  streak: {
    current: { type: Number, default: 0 },
    lastSolveDate: { type: String, default: '' },
    longest: { type: Number, default: 0 }
  },
  stats: {
    totalQuizzesSolved: { type: Number, default: 0 },
    totalQuestionsSolved: { type: Number, default: 0 },
    totalCreditsSpent: { type: Number, default: 0 },
    totalCreditsPurchased: { type: Number, default: 0 }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('passwordHash') || !this.passwordHash) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.pre('save', function(next) {
  if (!this.referralCode) {
    this.referralCode = this._id ? this._id.toString().slice(-8) : Math.random().toString(36).slice(2, 10);
  }
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

userSchema.methods.resetFreeCreditsIfNeeded = function() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (this.freeCreditsLastReset !== currentMonth) {
    const freeCredits = parseInt(process.env.FREE_MONTHLY_CREDITS) || 10;
    this.credits += freeCredits;
    this.freeCreditsLastReset = currentMonth;
    return true;
  }
  return false;
};

userSchema.methods.updateStreak = function() {
  const today = new Date().toISOString().slice(0, 10);
  if (this.streak.lastSolveDate === today) return;

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (this.streak.lastSolveDate === yesterday) {
    this.streak.current += 1;
  } else {
    this.streak.current = 1;
  }

  if (this.streak.current > this.streak.longest) {
    this.streak.longest = this.streak.current;
  }

  this.streak.lastSolveDate = today;
};

userSchema.methods.canUse = function(count = 1) {
  if (this.role === 'admin') return true;
  this.resetFreeCreditsIfNeeded();
  return this.credits >= count;
};

userSchema.methods.getRemaining = function() {
  if (this.role === 'admin') return Infinity;
  this.resetFreeCreditsIfNeeded();
  return this.credits;
};

userSchema.methods.useCredits = function(count = 1) {
  if (this.role === 'admin') {
    this.stats.totalQuestionsSolved += count;
    return;
  }
  this.resetFreeCreditsIfNeeded();
  this.credits = Math.max(0, this.credits - count);
  this.stats.totalQuestionsSolved += count;
  this.stats.totalCreditsSpent += count;
};

userSchema.methods.addCredits = function(amount) {
  this.credits += amount;
  this.stats.totalCreditsPurchased += amount;
};

userSchema.methods.getLeaderboardName = function() {
  const prefix = this.email.split('@')[0];
  let clean = prefix.toLowerCase();
  for (const word of PROFANITY_LIST) {
    if (clean.includes(word)) {
      clean = clean.replace(new RegExp(word, 'gi'), '***');
    }
  }
  if (clean.length > 3) {
    return clean.slice(0, 3) + '***';
  }
  return clean + '***';
};

userSchema.methods.toPublicJSON = function() {
  this.resetFreeCreditsIfNeeded();
  return {
    id: this._id,
    email: this.email,
    displayName: this.displayName,
    role: this.role,
    authProviders: this.authProviders || [],
    emailVerified: !!this.emailVerified,
    credits: this.role === 'admin' ? Infinity : this.credits,
    streak: this.streak,
    referralCode: this.referralCode,
    stats: this.stats,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', userSchema);
