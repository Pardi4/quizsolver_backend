const rateLimit = require('express-rate-limit');

const QUIZ_REQUESTS_PER_MINUTE = 1000;
const quizSolveEndpointPattern = /^\/api\/quiz\/(?:solve(?:-batch|-snapshot)?|explain|follow-up)(?:[/?#]|$)/i;

const requestIp = (req) => req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';

const userKeyGenerator = (req) => {
  if (req.user && req.user._id) return `user_${req.user._id}`;
  
  // Extract userId from JWT if available (fast decode, no verify needed just for rate limit keying)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const payloadBase64 = token.split('.')[1];
      if (payloadBase64) {
        const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
        if (payload && payload.userId) return `user_${payload.userId}`;
      }
    } catch {}
  }

  return requestIp(req);
};

const isQuizSolveEndpoint = (req) => quizSolveEndpointPattern.test(req.originalUrl || req.url || '');

const { RedisStore } = require('rate-limit-redis');
const { getRedisClient, isConnected } = require('../utils/redis');

// TODO: Use rate-limit-redis store for production multi-instance deployments
const storeGenerator = () => {
  return {
    ...new RedisStore({
      sendCommand: (...args) => getRedisClient()?.sendCommand(args) || Promise.resolve()
    }),
    increment: async (key) => {
      if (isConnected()) {
        const store = new RedisStore({
          sendCommand: (...args) => getRedisClient()?.sendCommand(args)
        });
        return store.increment(key);
      }
      return { totalHits: 0, resetTime: new Date() }; // Fail-open fallback
    },
    decrement: async (key) => {
      if (isConnected()) {
        const store = new RedisStore({
          sendCommand: (...args) => getRedisClient()?.sendCommand(args)
        });
        return store.decrement(key);
      }
    },
    resetKey: async (key) => {
      if (isConnected()) {
        const store = new RedisStore({
          sendCommand: (...args) => getRedisClient()?.sendCommand(args)
        });
        return store.resetKey(key);
      }
    }
  };
};

const createStore = (prefix) => new RedisStore({
  prefix,
  sendCommand: (...args) => {
    if (!isConnected()) return Promise.resolve(null);
    return getRedisClient().sendCommand(args);
  }
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => isQuizSolveEndpoint(req) ? QUIZ_REQUESTS_PER_MINUTE : (req.headers.authorization ? 5000 : 200),
  message: { error: 'Too many requests. Please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  validate: false
});

const authLimiter = rateLimit({
  windowMs: 50 * 60 * 1000,
  max: 50, // 50 attempts per 50 minutes
  message: { error: 'Too many login attempts. Please try again in 50 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestIp,
  validate: false
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1, // Max 1 registration per device/IP per 15 minutes
  message: { error: 'Too many accounts created from this device recently. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Prefer deviceId for rate limiting registrations, fallback to IP
    return req.body.deviceId ? `device_${req.body.deviceId}` : requestIp(req);
  },
  validate: false
});

// Extension -> website session handoff (one-time codes). Looser than authLimiter on purpose:
// the extension requests a code every time a user runs out of credits.
const handoffLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestIp,
  validate: false
});
const quizLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: QUIZ_REQUESTS_PER_MINUTE,
  message: { error: 'Too many quiz requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  validate: false
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  message: { error: 'Too many webhook requests.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestIp,
  validate: false
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000000,
  message: { error: 'Too many admin requests.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  validate: false
});

const parserSnapshotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1000000,
  message: { error: 'Too many parser snapshots uploaded from this IP.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestIp,
  validate: false
});

module.exports = { generalLimiter, authLimiter, registerLimiter, handoffLimiter, quizLimiter, webhookLimiter, adminLimiter, parserSnapshotLimiter };


