const jwt = require('jsonwebtoken');
const User = require('../models/User');

const { getRedisClient, isConnected } = require('../utils/redis');

// TODO: Replace in-memory Map with Redis (TTL = token expiry) for multi-instance deployments
const inMemoryBlacklist = new Map();

setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  for (const [token, exp] of inMemoryBlacklist.entries()) {
    if (now >= exp) {
      inMemoryBlacklist.delete(token);
    }
  }
  if (inMemoryBlacklist.size > 20000) {
    const entries = [...inMemoryBlacklist.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(10000);
    inMemoryBlacklist.clear();
    entries.forEach(([t, exp]) => inMemoryBlacklist.set(t, exp));
  }
}, 3600000);

async function checkBlacklist(token) {
  if (isConnected()) {
    try {
      const exists = await getRedisClient().exists(`bl_${token}`);
      return exists === 1;
    } catch {}
  }
  return inMemoryBlacklist.has(token);
}

async function addToBlacklist(token, exp) {
  if (isConnected()) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const ttl = Math.max(1, exp - now);
      await getRedisClient().setEx(`bl_${token}`, ttl, '1');
      return;
    } catch {}
  }
  inMemoryBlacklist.set(token, exp);
}

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token.' });
    }

    const token = authHeader.split(' ')[1];

    if (await checkBlacklist(token)) {
      return res.status(401).json({ error: 'Token has been revoked.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: process.env.JWT_ISSUER || 'quizsolver-api',
      audience: process.env.JWT_AUDIENCE || 'quizsolver-ext',
    });

    if (decoded.iat) {
      const tokenAgeDays = (Date.now() / 1000 - decoded.iat) / 86400;
      if (tokenAgeDays > 30) {
        return res.status(401).json({ error: 'Token too old. Please log in again.' });
      }
    }

    const mongoose = require('mongoose');
    if (!decoded.userId || !mongoose.Types.ObjectId.isValid(decoded.userId)) {
      return res.status(401).json({ error: 'Invalid token payload.' });
    }

    const user = await User.findById(decoded.userId).select('-__v');
    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: 'Account has been suspended.' });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(423).json({ error: 'Account temporarily locked.' });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token.' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please log in again.' });
    }
    return res.status(500).json({ error: 'Authorization error.' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

function generateToken(userId, rememberMe = true) {
  const expiresIn = rememberMe ? '30d' : '12h';
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    {
      expiresIn,
      issuer: process.env.JWT_ISSUER || 'quizsolver-api',
      audience: process.env.JWT_AUDIENCE || 'quizsolver-ext',
    }
  );
}

async function revokeToken(token) {
  try {
    const decoded = jwt.decode(token);
    const exp = decoded?.exp || Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
    await addToBlacklist(token, exp);
  } catch (error) {
    await addToBlacklist(token, Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60));
  }
}

async function isTokenBlacklisted(token) {
  return await checkBlacklist(token);
}

async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return next();

    const token = authHeader.split(' ')[1];
    if (await isTokenBlacklisted(token)) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: process.env.JWT_ISSUER || 'quizsolver-api',
      audience: process.env.JWT_AUDIENCE || 'quizsolver-ext',
    });
    const user = await User.findById(decoded.userId).select('-__v');
    if (user && !user.isBanned) req.user = user;
  } catch {}
  next();
}

module.exports = { authMiddleware, optionalAuth, adminOnly, generateToken, revokeToken, isTokenBlacklisted };
