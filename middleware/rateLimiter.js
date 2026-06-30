const rateLimit = require('express-rate-limit');

const QUIZ_REQUESTS_PER_MINUTE = 100;
const quizSolveEndpointPattern = /^\/api\/quiz\/(?:solve(?:-batch|-snapshot)?|explain|follow-up)(?:[/?#]|$)/i;

const requestIp = (req) => req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';

const userKeyGenerator = (req) => {
  if (req.user && req.user._id) return `user_${req.user._id}`;
  return requestIp(req);
};

const isQuizSolveEndpoint = (req) => quizSolveEndpointPattern.test(req.originalUrl || req.url || '');

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => isQuizSolveEndpoint(req) ? QUIZ_REQUESTS_PER_MINUTE : 40,
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
  max: QUIZ_REQUESTS_PER_MINUTE,
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

const parserSnapshotLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  message: { error: 'Parser diagnostics rate limit exceeded.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestIp,
});

module.exports = { generalLimiter, authLimiter, quizLimiter, webhookLimiter, adminLimiter, parserSnapshotLimiter };
