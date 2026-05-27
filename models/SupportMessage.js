const mongoose = require('mongoose');

const supportReplySchema = new mongoose.Schema({
  adminUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  fromEmail: { type: String, default: '' },
  toEmail: { type: String, default: '' },
  subject: { type: String, default: '' },
  text: { type: String, default: '' },
  html: { type: String, default: '' },
  providerMessageId: { type: String, default: '', index: true },
  sentAt: { type: Date, default: Date.now },
  delivery: { type: String, enum: ['sent', 'disabled', 'failed', 'received'], default: 'sent' },
  error: { type: String, default: '' }
}, { _id: true });

const supportMessageSchema = new mongoose.Schema({
  fromEmail: { type: String, required: true, trim: true, lowercase: true },
  fromName: { type: String, default: '', trim: true, maxlength: 120 },
  toEmail: { type: String, default: 'support@getquizsolver.com', trim: true, lowercase: true },
  subject: { type: String, default: '(No subject)', trim: true, maxlength: 250 },
  text: { type: String, default: '', maxlength: 20000 },
  html: { type: String, default: '', maxlength: 50000 },
  providerMessageId: { type: String, default: '', index: true },
  source: { type: String, enum: ['cloudflare-email-worker', 'cloudflare-worker-preview', 'contact-form', 'manual'], default: 'cloudflare-email-worker' },
  status: { type: String, enum: ['open', 'pending', 'closed'], default: 'open', index: true },
  isRead: { type: Boolean, default: false, index: true },
  replies: [supportReplySchema],
  receivedAt: { type: Date, default: Date.now },
  repliedAt: { type: Date, default: null }
}, { timestamps: true });

supportMessageSchema.index({ receivedAt: -1 });
supportMessageSchema.index({ fromEmail: 1, receivedAt: -1 });

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
