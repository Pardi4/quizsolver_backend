const rateLimit = require('express-rate-limit');

const requestIp = (req) => req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';

const userKeyGenerator = (req) => {
  if (req.user && req.user._id) return `user_${req.user._id}`;
  return requestIp(req);
};

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  message: { error: 'Too many requests. Please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestIp,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestIp,
});

const quizLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => {
    if (req.user && req.user.role === 'admin') return 120;
    return 20;
  },
  message: { error: 'Too many quiz requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Webhook rate limit exceeded.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Admin rate limit exceeded.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestIp,
});

module.exports = { generalLimiter, authLimiter, quizLimiter, webhookLimiter, adminLimiter };
