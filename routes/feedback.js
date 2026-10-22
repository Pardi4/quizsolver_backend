const express = require('express');
const UninstallFeedback = require('../models/UninstallFeedback');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Zbyt wiele prób. Spróbuj ponownie później.' },
  standardHeaders: true,
  legacyHeaders: false
});

function clean(value, limit = 500) {
  return String(value || '').replace(/\0/g, '').trim().substring(0, limit);
}

// POST /api/feedback/uninstall
router.post('/uninstall', feedbackLimiter, async (req, res) => {
  try {
    const body = req.body || {};

    const rawReasons = Array.isArray(body.reasons) ? body.reasons : [];
    const validReasonKeys = [
      'not_working',
      'too_expensive',
      'hard_to_use',
      'exams_finished',
      'inaccurate_ai',
      'alternative_found',
      'privacy_concern',
      'other'
    ];
    const reasons = rawReasons
      .map(r => clean(r, 60))
      .filter(r => validReasonKeys.includes(r) || r.length > 0)
      .slice(0, 10);

    const customReason = clean(body.customReason, 1000);
    const feedback = clean(body.feedback, 3000);
    const platformUsed = clean(body.platformUsed, 120);
    const email = clean(body.email, 254).toLowerCase();
    const extensionVersion = clean(body.extensionVersion || body.v, 50);
    const lang = clean(body.lang, 10) || 'pl';

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
    const userAgent = clean(req.headers['user-agent'] || '', 400);

    const item = await UninstallFeedback.create({
      reasons,
      customReason,
      feedback,
      platformUsed,
      email: /^\S+@\S+\.\S+$/.test(email) ? email : '',
      extensionVersion,
      lang,
      userAgent,
      ip
    });


    res.status(201).json({ success: true, id: item._id });
  } catch (err) {
    console.error('[Feedback] Uninstall feedback error:', err.message);
    res.status(500).json({ error: 'Nie udało się zapisać opinii.' });
  }
});

module.exports = router;
