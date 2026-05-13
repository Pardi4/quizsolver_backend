const jwt = require('jsonwebtoken');
const User = require('../models/User');

const tokenBlacklist = new Set();

setInterval(() => {
  if (tokenBlacklist.size > 5000) {
    const entries = [...tokenBlacklist];
    tokenBlacklist.clear();
    entries.slice(-2500).forEach(t => tokenBlacklist.add(t));
  }
}, 3600000);

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token.' });
    }

    const token = authHeader.split(' ')[1];

    if (tokenBlacklist.has(token)) {
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

  if (process.env.ADMIN_IP_WHITELIST) {
    const allowedIPs = process.env.ADMIN_IP_WHITELIST.split(',').map(s => s.trim());
    const clientIP = req.ip || req.connection.remoteAddress;
    if (!allowedIPs.some(ip => clientIP.includes(ip))) {
      return res.status(403).json({ error: 'Access denied from this location.' });
    }
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

function revokeToken(token) {
  tokenBlacklist.add(token);
}

module.exports = { authMiddleware, adminOnly, generateToken, revokeToken };
