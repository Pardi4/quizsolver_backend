const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const { authMiddleware, generateToken, revokeToken } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const {
  SITE_URL,
  sendEmail,
  verificationTemplate,
  resetPasswordTemplate
} = require('../services/emailService');

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

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashCode(code) {
  return crypto
    .createHash('sha256')
    .update(`${String(code || '').trim()}:${process.env.JWT_SECRET || 'quizsolver-dev-secret'}`)
    .digest('hex');
}

function codeMatches(hash, code) {
  if (!hash || !code) return false;
  return hash === hashCode(code);
}

function shouldExposeDevCode() {
  return process.env.NODE_ENV !== 'production' || process.env.EMAIL_DEBUG_CODES === 'true';
}

function safeRedirectPath(value) {
  if (!value || typeof value !== 'string') return '/dashboard';
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value.substring(0, 300);
}

async function issueVerificationCode(user) {
  const code = generateCode();
  user.emailVerificationCodeHash = hashCode(code);
  user.emailVerificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await user.save();
  const template = verificationTemplate({ code, email: user.email });
  let delivery = { success: false, disabled: true };
  try {
    delivery = await sendEmail({ to: user.email, ...template });
  } catch (error) {
    delivery = { success: false, error: error.message || 'Email delivery failed.' };
  }
  return { code, delivery };
}

async function issuePasswordResetCode(user) {
  const code = generateCode();
  user.passwordResetCodeHash = hashCode(code);
  user.passwordResetExpiresAt = new Date(Date.now() + 20 * 60 * 1000);
  await user.save();
  const template = resetPasswordTemplate({ code });
  let delivery = { success: false, disabled: true };
  try {
    delivery = await sendEmail({ to: user.email, ...template });
  } catch (error) {
    delivery = { success: false, error: error.message || 'Email delivery failed.' };
  }
  return { code, delivery };
}

function tokenLandingHtml(token, redirectPath) {
  const safeRedirect = safeRedirectPath(redirectPath);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>QuizSolver login</title></head><body style="background:#030712;color:#f1f5f9;font-family:Inter,Arial,sans-serif;"><script>
try {
  localStorage.setItem('qs_token', ${JSON.stringify(token)});
  localStorage.setItem('qs_admin_token', ${JSON.stringify(token)});
} catch (e) {}
location.replace(${JSON.stringify(safeRedirect)});
</script><p>Signing you in...</p></body></html>`;
}

router.post('/register', authLimiter, async (req, res) => {
  try {
    const email = sanitizeEmail(req.body.email);
    const password = req.body.password;
    const displayName = sanitizeDisplayName(req.body.displayName || email.split('@')[0]);
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
      displayName,
      authProviders: ['password'],
      emailVerified: false
    };

    if (referralCode) {
      const referrer = await User.findOne({ referralCode: referralCode.trim() });
      if (referrer) {
        userData.referredBy = referrer._id;
      }
    }

    const user = new User(userData);
    await user.save();
    const verification = await issueVerificationCode(user);

    res.status(201).json({
      success: true,
      requiresVerification: true,
      email,
      mailSent: !!verification.delivery.success,
      mailDisabled: !!verification.delivery.disabled,
      devCode: shouldExposeDevCode() || verification.delivery.disabled ? verification.code : undefined,
      message: 'Verification code sent.'
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

    if (user.emailVerified === false) {
      const verification = await issueVerificationCode(user);
      return res.status(403).json({
        error: 'Please verify your email first.',
        requiresVerification: true,
        email: user.email,
        mailSent: !!verification.delivery.success,
        mailDisabled: !!verification.delivery.disabled,
        devCode: shouldExposeDevCode() || verification.delivery.disabled ? verification.code : undefined
      });
    }

    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    if (user.emailVerified !== true) user.emailVerified = true;
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

router.post('/verify-email', authLimiter, async (req, res) => {
  try {
    const email = sanitizeEmail(req.body.email);
    const code = String(req.body.code || '').trim();
    const rememberMe = req.body.rememberMe !== false;
    const user = await User.findOne({ email });
    if (!user || !code) return res.status(400).json({ error: 'Invalid verification code.' });
    if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
      return res.status(400).json({ error: 'Verification code expired.' });
    }
    if (!codeMatches(user.emailVerificationCodeHash, code)) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }
    user.emailVerified = true;
    user.emailVerificationCodeHash = '';
    user.emailVerificationExpiresAt = null;
    user.failedLoginAttempts = 0;
    await user.save();
    const token = generateToken(user._id, rememberMe);
    res.json({ success: true, token, user: user.toPublicJSON() });
  } catch {
    res.status(500).json({ error: 'Could not verify email.' });
  }
});

router.post('/resend-verification', authLimiter, async (req, res) => {
  try {
    const email = sanitizeEmail(req.body.email);
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: true, message: 'If the account exists, a code was sent.' });
    if (user.emailVerified) return res.json({ success: true, alreadyVerified: true });
    const verification = await issueVerificationCode(user);
    res.json({
      success: true,
      mailSent: !!verification.delivery.success,
      mailDisabled: !!verification.delivery.disabled,
      devCode: shouldExposeDevCode() || verification.delivery.disabled ? verification.code : undefined
    });
  } catch {
    res.status(500).json({ error: 'Could not resend verification code.' });
  }
});

router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const email = sanitizeEmail(req.body.email);
    const user = await User.findOne({ email });
    if (user) {
      const reset = await issuePasswordResetCode(user);
      return res.json({
        success: true,
        mailSent: !!reset.delivery.success,
        mailDisabled: !!reset.delivery.disabled,
        devCode: shouldExposeDevCode() || reset.delivery.disabled ? reset.code : undefined,
        message: 'If the account exists, a reset code was sent.'
      });
    }
    res.json({ success: true, message: 'If the account exists, a reset code was sent.' });
  } catch {
    res.status(500).json({ error: 'Could not start password reset.' });
  }
});

router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const email = sanitizeEmail(req.body.email);
    const code = String(req.body.code || '').trim();
    const password = req.body.password;
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });
    const user = await User.findOne({ email });
    if (!user || !code) return res.status(400).json({ error: 'Invalid reset code.' });
    if (!user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      return res.status(400).json({ error: 'Reset code expired.' });
    }
    if (!codeMatches(user.passwordResetCodeHash, code)) {
      return res.status(400).json({ error: 'Invalid reset code.' });
    }
    user.passwordHash = password;
    user.passwordChangedAt = new Date();
    user.passwordResetCodeHash = '';
    user.passwordResetExpiresAt = null;
    user.emailVerified = true;
    if (!user.authProviders?.includes('password')) {
      user.authProviders = [...(user.authProviders || []), 'password'];
    }
    await user.save();
    res.json({ success: true, message: 'Password updated.' });
  } catch {
    res.status(500).json({ error: 'Could not reset password.' });
  }
});

router.get('/google/start', authLimiter, (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(503).send('Google login is not configured.');
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${SITE_URL}/api/auth/google/callback`;
  const redirect = safeRedirectPath(req.query.redirect || '/dashboard');
  const state = generateToken(`google:${crypto.randomBytes(12).toString('hex')}`, true);
  const statePayload = Buffer.from(JSON.stringify({ state, redirect })).toString('base64url');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state: statePayload
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/google/callback', async (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${SITE_URL}/api/auth/google/callback`;
    if (!clientId || !clientSecret) throw new Error('Google login is not configured.');
    const code = String(req.query.code || '');
    if (!code) throw new Error('Missing Google code.');
    let redirect = '/dashboard';
    try {
      const state = JSON.parse(Buffer.from(String(req.query.state || ''), 'base64url').toString('utf8'));
      redirect = safeRedirectPath(state.redirect);
    } catch {}

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokenData.error_description || 'Google token exchange failed.');

    const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const googleProfile = await userResponse.json();
    if (!userResponse.ok || !googleProfile.email) throw new Error('Could not read Google profile.');

    const email = sanitizeEmail(googleProfile.email);
    let user = await User.findOne({ $or: [{ googleId: googleProfile.sub }, { email }] });
    if (!user) {
      user = new User({
        email,
        displayName: sanitizeDisplayName(googleProfile.name || email.split('@')[0]),
        googleId: googleProfile.sub,
        authProviders: ['google'],
        emailVerified: true,
        passwordHash: ''
      });
    } else {
      user.googleId = user.googleId || googleProfile.sub;
      user.emailVerified = true;
      user.displayName = user.displayName || sanitizeDisplayName(googleProfile.name || email.split('@')[0]);
      if (!user.authProviders?.includes('google')) user.authProviders = [...(user.authProviders || []), 'google'];
    }
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.resetFreeCreditsIfNeeded();
    await user.save();
    const token = generateToken(user._id, true);
    res.set('Cache-Control', 'no-store').type('html').send(tokenLandingHtml(token, redirect));
  } catch (error) {
    const message = encodeURIComponent(error.message || 'Google login failed.');
    res.redirect(`${SITE_URL}/?auth=login&error=${message}`);
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
