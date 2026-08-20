const rateLimit = require('express-rate-limit');

const QUIZ_REQUESTS_PER_MINUTE = 100;
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
  max: (req) => isQuizSolveEndpoint(req) ? QUIZ_REQUESTS_PER_MINUTE : 40,
  message: { error: 'Too many requests. Please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  validate: { ip: false, xForwardedForHeader: false, trustProxy: false }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestIp,
  validate: { ip: false, xForwardedForHeader: false, trustProxy: false }
});

const quizLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: QUIZ_REQUESTS_PER_MINUTE,
  message: { error: 'Too many quiz requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  validate: { ip: false, xForwardedForHeader: false, trustProxy: false }
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many webhook requests.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestIp,
  validate: { ip: false, xForwardedForHeader: false, trustProxy: false }
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Too many admin requests.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKeyGenerator,
  validate: { ip: false, xForwardedForHeader: false, trustProxy: false }
});

const parserSnapshotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many parser snapshots uploaded from this IP.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestIp,
  validate: { ip: false, xForwardedForHeader: false, trustProxy: false }
});

module.exports = { generalLimiter, authLimiter, quizLimiter, webhookLimiter, adminLimiter, parserSnapshotLimiter };
