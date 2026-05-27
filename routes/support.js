const express = require('express');
const SupportMessage = require('../models/SupportMessage');
const { escapeHtml, SUPPORT_EMAIL } = require('../services/emailService');

const router = express.Router();

function clean(value, limit = 1000) {
  return String(value || '').replace(/\0/g, '').trim().substring(0, limit);
}

function cleanMessageId(value) {
  return clean(value, 300).replace(/^<|>$/g, '').replace(/[<>,;]+$/g, '').toLowerCase();
}

function extractMessageIds(value) {
  const raw = String(value || '');
  const bracketed = raw.match(/<[^>]+>/g) || [];
  const ids = bracketed.length ? bracketed : raw.split(/\s+/);
  return [...new Set(ids.map(cleanMessageId).filter(id => id && id.includes('@')))];
}

function normalizeSubject(subject) {
  return clean(subject, 250)
    .replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseRawHeaders(raw) {
  const headerBlock = String(raw || '').split(/\r?\n\r?\n/)[0] || '';
  const headers = {};
  let current = '';
  for (const line of headerBlock.split(/\r?\n/)) {
    if (/^\s/.test(line) && current) {
      headers[current] += ` ${line.trim()}`;
      continue;
    }
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    current = match[1].toLowerCase();
    headers[current] = match[2].trim();
  }
  return headers;
}

function normalizeSource(value) {
  const source = clean(value || 'cloudflare-email-worker', 80);
  return ['cloudflare-email-worker', 'cloudflare-worker-preview', 'contact-form', 'manual'].includes(source)
    ? source
    : 'cloudflare-email-worker';
}

async function findThread({ fromEmail, subject, messageIds, looksLikeReply }) {
  if (messageIds.length) {
    const byMessageId = await SupportMessage.findOne({
      $or: [
        { providerMessageId: { $in: messageIds } },
        { 'replies.providerMessageId': { $in: messageIds } }
      ]
    });
    if (byMessageId) return byMessageId;
  }

  if (!looksLikeReply) return null;
  const incomingSubject = normalizeSubject(subject);
  if (!incomingSubject) return null;
  const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
  const candidates = await SupportMessage.find({ fromEmail, receivedAt: { $gte: since } })
    .sort({ updatedAt: -1 })
    .limit(40);
  return candidates.find(message => normalizeSubject(message.subject) === incomingSubject) || null;
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
    const rawHeaders = parseRawHeaders(req.body.raw || text);
    const providerMessageId = cleanMessageId(req.body.messageId || req.body.id || rawHeaders['message-id'] || '');
    const replyIds = [
      ...extractMessageIds(req.body.inReplyTo || req.body.inReplyToMessageId || rawHeaders['in-reply-to']),
      ...extractMessageIds(req.body.references || rawHeaders.references)
    ];
    if (providerMessageId) {
      const duplicateRoot = await SupportMessage.findOne({
        $or: [
          { providerMessageId },
          { 'replies.providerMessageId': providerMessageId }
        ]
      });
      if (duplicateRoot) {
        return res.status(200).json({ success: true, id: duplicateRoot._id, duplicate: true });
      }
    }
    const looksLikeReply = /^(\s*(re|fw|fwd)\s*:)/i.test(subject) || replyIds.length > 0;
    const existingThread = await findThread({ fromEmail, subject, messageIds: replyIds, looksLikeReply });
    const safeText = text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const safeHtml = html || `<p>${escapeHtml(safeText).replace(/\n/g, '<br>')}</p>`;

    if (existingThread) {
      const duplicate = providerMessageId && (
        cleanMessageId(existingThread.providerMessageId) === providerMessageId ||
        existingThread.replies.some(reply => cleanMessageId(reply.providerMessageId) === providerMessageId)
      );
      if (!duplicate) {
        existingThread.replies.push({
          adminUser: null,
          fromEmail,
          toEmail: clean(req.body.toEmail || req.body.to || SUPPORT_EMAIL, 254).toLowerCase(),
          subject,
          text: safeText,
          html: safeHtml,
          providerMessageId,
          delivery: 'received',
          sentAt: new Date()
        });
        existingThread.status = 'open';
        existingThread.isRead = false;
        await existingThread.save();
      }
      return res.status(200).json({ success: true, id: existingThread._id, threaded: true, duplicate });
    }

    const message = await SupportMessage.create({
      fromEmail,
      fromName: clean(req.body.fromName || req.body.name || '', 120),
      toEmail: clean(req.body.toEmail || req.body.to || SUPPORT_EMAIL, 254).toLowerCase(),
      subject,
      text: safeText,
      html: safeHtml,
      providerMessageId,
      source: normalizeSource(req.body.source)
    });
    res.status(201).json({ success: true, id: message._id, threaded: false });
  } catch (error) {
    console.error('[Support] inbound error:', error.message);
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
