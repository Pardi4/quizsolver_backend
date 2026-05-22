const express = require('express');
const SupportMessage = require('../models/SupportMessage');
const { escapeHtml, SUPPORT_EMAIL } = require('../services/emailService');

const router = express.Router();

function clean(value, limit = 1000) {
  return String(value || '').replace(/\0/g, '').trim().substring(0, limit);
}

function requireInboundSecret(req, res, next) {
  const expected = process.env.SUPPORT_INBOUND_SECRET;
  if (!expected) return res.status(503).json({ error: 'Support inbound webhook is not configured.' });
  const provided = req.headers['x-support-secret'] || req.query.secret || req.body.secret;
  if (provided !== expected) return res.status(403).json({ error: 'Invalid support webhook secret.' });
  next();
}

router.post('/inbound', requireInboundSecret, async (req, res) => {
  try {
    const fromEmail = clean(req.body.fromEmail || req.body.from || req.body.sender, 254).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(fromEmail)) {
      return res.status(400).json({ error: 'Valid fromEmail is required.' });
    }
    const subject = clean(req.body.subject || '(No subject)', 250) || '(No subject)';
    const text = clean(req.body.text || req.body.body || '', 20000);
    const html = clean(req.body.html || '', 50000);
    const message = await SupportMessage.create({
      fromEmail,
      fromName: clean(req.body.fromName || req.body.name || '', 120),
      toEmail: clean(req.body.toEmail || req.body.to || SUPPORT_EMAIL, 254).toLowerCase(),
      subject,
      text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      html: html || `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`,
      providerMessageId: clean(req.body.messageId || req.body.id || '', 250),
      source: clean(req.body.source || 'cloudflare-email-worker', 80)
    });
    res.status(201).json({ success: true, id: message._id });
  } catch (error) {
    res.status(500).json({ error: 'Could not save support message.' });
  }
});

router.post('/contact', async (req, res) => {
  try {
    const fromEmail = clean(req.body.email, 254).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(fromEmail)) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }
    const subject = clean(req.body.subject || 'QuizSolver support request', 250);
    const text = clean(req.body.message, 5000);
    if (!text) return res.status(400).json({ error: 'Message is required.' });
    const message = await SupportMessage.create({
      fromEmail,
      fromName: clean(req.body.name, 120),
      toEmail: SUPPORT_EMAIL,
      subject,
      text,
      html: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`,
      source: 'contact-form'
    });
    res.status(201).json({ success: true, id: message._id });
  } catch {
    res.status(500).json({ error: 'Could not send support request.' });
  }
});

module.exports = router;
