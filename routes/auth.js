const express = require('express');
const User = require('../models/User');
const { authMiddleware, generateToken, revokeToken } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

function sanitizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.toLowerCase().trim().substring(0, 254);
}

function sanitizeDisplayName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/<[^>]*>/g, '').trim().substring(0, 50);
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 128) return 'Password is too long.';
  if (!/[\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return 'Password must contain at least one digit or special character.';
  }
  return null;
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

router.post('/register', authLimiter, async (req, res) => {
  try {
    const email = sanitizeEmail(req.body.email);
    const password = req.body.password;
    const displayName = sanitizeDisplayName(req.body.displayName || email.split('@')[0]);
    const rememberMe = req.body.rememberMe !== false;
    const referralCode = req.body.referralCode;

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }

    const userData = {
      email,
      passwordHash: password,
      displayName
    };

    if (referralCode) {
      const referrer = await User.findOne({ referralCode: referralCode.trim() });
      if (referrer) {
        userData.referredBy = referrer._id;
      }
    }

    const user = new User(userData);
    await user.save();
    const token = generateToken(user._id, rememberMe);

    res.status(201).json({
      success: true,
      token,
      user: user.toPublicJSON()
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const email = sanitizeEmail(req.body.email);
    const password = req.body.password;
    const rememberMe = req.body.rememberMe === true;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: 'Account has been suspended.' });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minsLeft = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      return res.status(423).json({ error: `Account locked. Try again in ${minsLeft} minutes.` });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= 10) {
        user.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
        user.failedLoginAttempts = 0;
        await user.save();
        return res.status(423).json({ error: 'Account locked due to too many failed attempts. Try again in 30 minutes.' });
      }
      await user.save();
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.resetFreeCreditsIfNeeded();
    await user.save();

    const token = generateToken(user._id, rememberMe);

    res.json({
      success: true,
      token,
      rememberMe,
      user: user.toPublicJSON()
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error during login.' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    req.user.resetFreeCreditsIfNeeded();
    await req.user.save();

    res.json({
      success: true,
      user: req.user.toPublicJSON(),
      credits: req.user.role === 'admin' ? Infinity : req.user.credits
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error.' });
  }
});

router.post('/logout', authMiddleware, async (req, res) => {
  try {
    revokeToken(req.token);
    res.json({ success: true, message: 'Logged out.' });
  } catch (error) {
    res.status(500).json({ error: 'Logout error.' });
  }
});

module.exports = router;
