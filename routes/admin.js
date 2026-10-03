const express = require('express');
const mongoose = require('mongoose');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const User = require('../models/User');
const CachedAnswer = require('../models/CachedAnswer');
const Purchase = require('../models/Purchase');
const BugReport = require('../models/BugReport');
const SupportMessage = require('../models/SupportMessage');
const StudyNote = require('../models/StudyNote');
const CreditUsage = require('../models/CreditUsage');
const ParserEvent = require('../models/ParserEvent');
const { sendEmail, supportReplyTemplate, SUPPORT_EMAIL, escapeHtml } = require('../services/emailService');
const { sendParserSnapshotFile } = require('../utils/parserSnapshotFiles');

const router = express.Router();

router.use(authMiddleware);
router.use(adminOnly);

const paidProviders = ['lemonsqueezy', 'whop'];
const EXTENSION_ACTIVE_WINDOW_MS = 90 * 1000;
const CREDIT_DUPLICATE_REVIEW_WINDOW_MS = 10 * 60 * 1000;
const USER_SORTS = {
  createdAt_desc: { createdAt: -1, _id: -1 },
  createdAt_asc: { createdAt: 1, _id: 1 },
  credits_desc: { role: 1, credits: -1, createdAt: -1, _id: -1 },
  credits_asc: { role: -1, credits: 1, createdAt: -1, _id: -1 },
  lastOnline_desc: { extensionLastSeenAt: -1, createdAt: -1, _id: -1 },
  lastOnline_asc: { extensionLastSeenAt: 1, createdAt: 1, _id: 1 },
  questions_desc: { 'stats.totalQuestionsSolved': -1, createdAt: -1, _id: -1 },
  questions_asc: { 'stats.totalQuestionsSolved': 1, createdAt: 1, _id: 1 },
  streak_desc: { 'streak.current': -1, createdAt: -1, _id: -1 },
  streak_asc: { 'streak.current': 1, createdAt: 1, _id: 1 },
  status_desc: { isBanned: 1, extensionLastSeenAt: -1, createdAt: -1, _id: -1 },
  status_asc: { isBanned: -1, extensionLastSeenAt: 1, createdAt: 1, _id: 1 }
};

function auditLog(adminUser, action, details = {}) {
  console.log(`[AUDIT] ${JSON.stringify({ ts: new Date().toISOString(), admin: adminUser.email, action, ...details })}`);
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serializeAdminUser(user) {
  if (!user) return null;
  const extensionLastSeenAt = user.extensionLastSeenAt || null;
  const extensionLastSeenMs = extensionLastSeenAt ? new Date(extensionLastSeenAt).getTime() : 0;
  const isExtensionActive = !!extensionLastSeenMs && (Date.now() - extensionLastSeenMs) <= EXTENSION_ACTIVE_WINDOW_MS;
  return {
    id: user._id,
    email: user.email,
    displayName: user.displayName || '',
    role: user.role,
    credits: user.role === 'admin' ? 'unlimited' : user.credits,
    stats: user.stats || {},
    streak: user.streak || {},
    isBanned: !!user.isBanned,
    marketingConsent: !!user.marketingConsent,
    accountDeletionScheduledAt: user.accountDeletionScheduledAt || null,
    emailVerified: !!user.emailVerified,
    authProviders: user.authProviders || [],
    pendingNewEmail: user.pendingNewEmail || '',
    isExtensionActive,
    extensionLastSeenAt,
    extensionLastSeenReason: user.extensionLastSeenReason || '',
    extensionLastSeenUrl: user.extensionLastSeenUrl || '',
    extensionLastSeenPlatform: user.extensionLastSeenPlatform || '',
    extensionVersion: user.extensionVersion || '',
    securityLogs: user.securityLogs || [],
    createdAt: user.createdAt
  };
}

function answerToText(type, options = [], answer, meta = {}) {
  if (type === 'radio' && Array.isArray(options)) return options[answer] || String(answer);
  if (type === 'checkbox' && Array.isArray(options) && Array.isArray(answer)) {
    return answer.map(i => options[i] || String(i)).join(', ');
  }
  if ((type === 'matching' || type === 'matrix') && Array.isArray(options) && Array.isArray(answer)) {
    const labels = type === 'matching' ? (meta.prompts || []) : (meta.rows || []);
    return answer.map((idx, i) => {
      const label = labels[i] ? `${labels[i]} -> ` : '';
      return `${label}${options[idx] || String(idx)}`;
    }).join('; ');
  }
  return String(answer ?? '');
}

function serializeAdminQuestion(note) {
  const options = note.options || [];
  return {
    id: note._id,
    cachedAnswerId: note.cachedAnswer?._id || note.cachedAnswer || null,
    questionHash: note.questionHash,
    questionText: note.questionText,
    questionType: note.questionType,
    options,
    prompts: note.prompts || [],
    rows: note.rows || [],
    answer: note.answer,
    answerText: answerToText(note.questionType, options, note.answer, { prompts: note.prompts || [], rows: note.rows || [] }),
    explanation: note.explanation || '',
    sourceUrl: note.sourceUrl || '',
    platform: note.platform || '',
    seenCount: note.seenCount || 0,
    explainCount: note.explainCount || 0,
    lastSeenAt: note.lastSeenAt,
    lastExplainedAt: note.lastExplainedAt,
    extensionVersion: note.extensionVersion || '',
    createdAt: note.createdAt
  };
}

function isChargedCreditUsage(usage = {}) {
  return usage.charged === true || usage.status === 'charged' || (!!usage.chargedAt && !usage.status);
}

function creditUsageTime(usage = {}) {
  return usage.chargedAt || usage.claimedAt || usage.updatedAt || usage.createdAt || null;
}

function serializeAdminCreditUsage(usage, note, cachedAnswer) {
  const source = note || cachedAnswer || {};
  const options = source.options || [];
  const questionType = source.questionType || '';
  const answer = source.answer ?? null;
  const charged = isChargedCreditUsage(usage);
  return {
    id: usage._id,
    userId: usage.user?._id || usage.user || null,
    email: usage.user?.email || 'Unknown user',
    displayName: usage.user?.displayName || '',
    action: usage.action,
    status: usage.status || (charged ? 'charged' : 'claimed'),
    charged,
    credits: usage.credits || 1,
    creditsCharged: charged ? (usage.credits || 1) : 0,
    questionHash: usage.questionHash,
    questionText: source.questionText || 'Question not saved',
    questionType,
    options,
    prompts: source.prompts || [],
    rows: source.rows || [],
    answer,
    answerText: answerToText(questionType, options, answer, { prompts: source.prompts || [], rows: source.rows || [] }),
    sourceUrl: note?.sourceUrl || '',
    platform: note?.platform || '',
    seenCount: note?.seenCount || 0,
    waivedReason: usage.waivedReason || '',
    dedupeWindow: usage.dedupeWindow || '',
    dedupeWindowMs: usage.dedupeWindowMs || 0,
    claimedAt: usage.claimedAt,
    chargedAt: usage.chargedAt,
    createdAt: usage.createdAt,
    updatedAt: usage.updatedAt,
    time: creditUsageTime(usage)
  };
}

function serializeParserEvent(event) {
  return {
    id: event._id,
    email: event.userId?.email || 'Unknown user',
    userId: event.userId?._id || event.userId || null,
    eventType: event.eventType,
    outcome: event.outcome,
    platform: event.platform || 'universal',
    detectorPlatform: event.detectorPlatform || '',
    url: event.url || '',
    hostname: event.hostname || '',
    confidence: Number(event.confidence || 0),
    reason: event.reason || '',
    questionCount: event.questionCount || 0,
    supportedQuestionCount: event.supportedQuestionCount || 0,
    optionCount: event.optionCount || 0,
    attemptedTypes: event.attemptedTypes || [],
    questionTypes: event.questionTypes || [],
    parserVersion: event.parserVersion || '',
    extensionVersion: event.extensionVersion || '',
    snapshot: event.snapshot || {},
    hasPageCode: Boolean(event.snapshot?.htmlSnippet || event.snapshot?.fullHtmlFile?.id),
    createdAt: event.createdAt
  };
}

router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      totalUsers, adminUsers, cachedAnswers, totalPurchases,
      totalBugReports, unreadBugReports, openSupportMessages, unreadSupportMessages,
      totalQuestionsAgg, totalCreditsAgg, revenueAgg,
      todayPurchases, monthRevenueAgg, bannedUsers, recentUsers
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'admin' }),
      CachedAnswer.countDocuments(),
      Purchase.countDocuments(),
      BugReport.countDocuments(),
      BugReport.countDocuments({ $and: [{ isRead: false }, { isRead: { $exists: true } }] }),
      SupportMessage.countDocuments({ status: { $ne: 'closed' } }),
      SupportMessage.countDocuments({ isRead: false }),
      User.aggregate([{ $group: { _id: null, total: { $sum: '$stats.totalQuestionsSolved' } } }]),
      User.aggregate([{ $group: { _id: null, total: { $sum: '$credits' } } }]),
      Purchase.aggregate([{ $match: { paymentProvider: { $in: paidProviders } } }, { $group: { _id: null, total: { $sum: '$priceUsd' } } }]),
      Purchase.countDocuments({ createdAt: { $gte: today } }),
      Purchase.aggregate([
        { $match: { paymentProvider: { $in: paidProviders }, createdAt: { $gte: thisMonth } } },
        { $group: { _id: null, total: { $sum: '$priceUsd' } } }
      ]),
      User.countDocuments({ isBanned: true }),
      User.find().sort({ createdAt: -1 }).limit(10).select('email displayName role credits stats createdAt isBanned')
    ]);

    const totalQuestions = totalQuestionsAgg[0]?.total || 0;
    const totalCreditsInSystem = totalCreditsAgg[0]?.total || 0;
    const totalRevenue = revenueAgg[0]?.total || 0;
    const monthRevenue = monthRevenueAgg[0]?.total || 0;

    res.json({
      success: true,
      stats: {
        totalUsers, adminUsers, cachedAnswers, totalPurchases,
        totalBugReports, unreadBugReports, totalQuestions, totalCreditsInSystem,
        totalRevenue, todayPurchases, monthRevenue, bannedUsers,
        openSupportMessages, unreadSupportMessages
      },
      recentUsers: recentUsers.map(u => u.toPublicJSON())
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching stats.' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const search = (req.query.search || '').substring(0, 100);
    const requestedSort = String(req.query.sort || 'createdAt_desc').substring(0, 50);
    const sort = USER_SORTS[requestedSort] ? requestedSort : 'createdAt_desc';
    const query = search ? { $or: [
      { email: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { displayName: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
    ]} : {};
    const users = await User.find(query).sort(USER_SORTS[sort]).skip((page - 1) * limit).limit(limit).select('email displayName role marketingConsent credits stats createdAt isBanned streak extensionLastSeenAt extensionLastSeenReason extensionLastSeenUrl extensionLastSeenPlatform extensionVersion authProviders emailVerified securityLogs pendingNewEmail accountDeletionScheduledAt');
    const total = await User.countDocuments(query);
    res.json({
      success: true,
      users: users.map(serializeAdminUser),
      pagination: { page, limit, total, pages: Math.ceil(total / limit), sort }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching users.' });
  }
});

router.get('/users/:userId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }
    const user = await User.findById(req.params.userId).select(
      'email displayName role marketingConsent credits stats createdAt isBanned streak ' +
      'extensionLastSeenAt extensionLastSeenReason extensionLastSeenUrl extensionLastSeenPlatform extensionVersion ' +
      'authProviders emailVerified securityLogs pendingNewEmail accountDeletionScheduledAt'
    );
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, user: serializeAdminUser(user) });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching user.' });
  }
});

router.get('/users/:userId/questions', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const userId = req.params.userId;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }

    const notes = await StudyNote.find({ user: userId })
      .sort({ lastSeenAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('cachedAnswer')
      .lean();

    const total = await StudyNote.countDocuments({ user: userId });

    res.json({
      success: true,
      questions: notes.map(serializeAdminQuestion),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching user questions.' });
  }
});

router.patch('/users/:userId/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (user._id.toString() === req.user._id.toString() && role !== 'admin') return res.status(400).json({ error: 'Cannot remove your own admin role.' });
    const oldRole = user.role;
    user.role = role;
    await user.save();
    auditLog(req.user, 'ROLE_CHANGE', { target: user.email, oldRole, newRole: role });
    res.json({ success: true, user: user.toPublicJSON() });
  } catch (error) {
    res.status(500).json({ error: 'Error changing role.' });
  }
});

router.post('/users/:userId/grant-credits', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) return res.status(400).json({ error: 'Invalid user ID.' });
    const { credits, reason } = req.body;
    const amount = Math.min(parseInt(credits) || 0, 10000);
    if (amount <= 0) return res.status(400).json({ error: 'Credits must be > 0.' });
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const grantReason = (reason || 'Admin grant').substring(0, 200);
    await Purchase.recordPurchase(user._id, 'admin_grant', amount, {
      priceUsd: 0, paymentProvider: 'manual', grantedBy: req.user._id, grantReason
    });
    auditLog(req.user, 'GRANT_CREDITS', { target: user.email, credits: amount, reason: grantReason });
    const updatedUser = await User.findById(user._id);
    res.json({ success: true, message: `+${amount} credits to ${user.email}.`, newBalance: updatedUser.credits });
  } catch (error) {
    res.status(500).json({ error: 'Error granting credits.' });
  }
});

router.post('/users/:userId/quick-grant', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) return res.status(400).json({ error: 'Invalid user ID.' });
    const { amount } = req.body;
    const allowed = [50, 100, 200, 500];
    if (!allowed.includes(parseInt(amount))) {
      return res.status(400).json({ error: 'Invalid amount. Allowed: 50, 100, 200, 500.' });
    }
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    await Purchase.recordPurchase(user._id, 'admin_grant', parseInt(amount), {
      priceUsd: 0, paymentProvider: 'manual', grantedBy: req.user._id, grantReason: `Quick grant +${amount}`
    });
    auditLog(req.user, 'QUICK_GRANT', { target: user.email, amount });
    const updatedUser = await User.findById(user._id);
    res.json({ success: true, newBalance: updatedUser.credits });
  } catch (error) {
    res.status(500).json({ error: 'Error granting credits.' });
  }
});

router.post('/users/:userId/ban', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) return res.status(400).json({ error: 'Invalid user ID.' });
    if (req.params.userId === req.user._id.toString()) return res.status(400).json({ error: 'Cannot ban yourself.' });
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    user.isBanned = true;
    await user.save();
    auditLog(req.user, 'BAN_USER', { target: user.email });
    res.json({ success: true, message: `${user.email} banned.` });
  } catch (error) {
    res.status(500).json({ error: 'Error banning user.' });
  }
});

router.post('/users/:userId/unban', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) return res.status(400).json({ error: 'Invalid user ID.' });
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    user.isBanned = false;
    user.lockedUntil = null;
    await user.save();
    auditLog(req.user, 'UNBAN_USER', { target: user.email });
    res.json({ success: true, message: `${user.email} unbanned.` });
  } catch (error) {
    res.status(500).json({ error: 'Error unbanning user.' });
  }
});

router.get('/purchases', async (req, res) => {
  try {
    const purchases = await Purchase.find().sort({ createdAt: -1 }).limit(200).populate('userId', 'email displayName');
    res.json({
      success: true,
      purchases: purchases.map(p => ({
        id: p._id, user: p.userId?.email, pack: p.pack, credits: p.credits,
        priceUsd: p.priceUsd, provider: p.paymentProvider, date: p.createdAt,
        reason: p.grantReason,
        creditsApplied: p.creditsApplied !== false,
        creditsAppliedAt: p.creditsAppliedAt || null
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching purchases.' });
  }
});

router.post('/purchases/:purchaseId/apply', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.purchaseId)) {
      return res.status(400).json({ error: 'Invalid purchase id.' });
    }

    const purchase = await Purchase.findById(req.params.purchaseId);
    if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });

    await Purchase.applyCredits(purchase);
    auditLog(req.user, 'APPLY_PURCHASE_CREDITS', {
      purchaseId: purchase._id.toString(),
      userId: String(purchase.userId),
      credits: purchase.credits
    });

    res.json({
      success: true,
      purchase: {
        id: purchase._id,
        creditsApplied: purchase.creditsApplied !== false,
        creditsAppliedAt: purchase.creditsAppliedAt || null
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error applying purchase credits.' });
  }
});

router.get('/bug-reports', async (req, res) => {
  try {
    const reports = await BugReport.find().sort({ createdAt: -1 }).limit(100).populate('userId', 'email').lean();
    res.json({
      success: true,
      reports: reports.map(r => ({
        id: r._id, user: r.userId?.email, url: r.url,
        description: r.description, userAgent: r.userAgent || '',
        platform: r.platform || '',
        source: r.source || 'manual',
        parserEventId: r.parserEventId || null,
        parserDiagnostics: r.parserDiagnostics || {},
        parserSnapshot: r.parserSnapshot || {},
        hasPageCode: Boolean(r.parserSnapshot?.htmlSnippet || r.parserSnapshot?.fullHtmlFile?.id),
        isRead: r.isRead !== false, readAt: r.readAt || null,
        date: r.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching bug reports.' });
  }
});

router.post('/bug-reports/mark-all-read', async (req, res) => {
  try {
    const now = new Date();
    const result = await BugReport.updateMany(
      { $and: [{ isRead: false }, { isRead: { $exists: true } }] },
      { $set: { isRead: true, readAt: now, readBy: req.user._id } }
    );
    auditLog(req.user, 'BUG_REPORTS_MARK_ALL_READ', { modified: result.modifiedCount || 0 });
    res.json({ success: true, modified: result.modifiedCount || 0 });
  } catch (error) {
    res.status(500).json({ error: 'Error updating bug reports.' });
  }
});

router.patch('/bug-reports/:reportId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.reportId)) {
      return res.status(400).json({ error: 'Invalid bug report id.' });
    }

    const patch = {};
    if (typeof req.body.isRead === 'boolean') {
      patch.isRead = req.body.isRead;
      patch.readAt = req.body.isRead ? new Date() : null;
      patch.readBy = req.body.isRead ? req.user._id : null;
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: 'No valid bug report fields to update.' });
    }

    const report = await BugReport.findByIdAndUpdate(
      req.params.reportId,
      { $set: patch },
      { new: true }
    );
    if (!report) return res.status(404).json({ error: 'Bug report not found.' });

    auditLog(req.user, 'BUG_REPORT_UPDATE', {
      reportId: report._id.toString(),
      isRead: !!report.isRead
    });
    res.json({ success: true, report: { id: report._id, isRead: !!report.isRead, readAt: report.readAt || null } });
  } catch (error) {
    res.status(500).json({ error: 'Error updating bug report.' });
  }
});

router.get('/parser/snapshot-file/:fileId', async (req, res) => {
  return sendParserSnapshotFile(res, req.params.fileId);
});

router.get('/parser/health', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const match = { createdAt: { $gte: since } };
    const failedOutcomes = ['empty', 'weak', 'error'];

    const [summaryAgg, platforms, problemGroups, domainIssues, recentEvents, recentBugReports] = await Promise.all([
      ParserEvent.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            success: { $sum: { $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0] } },
            partial: { $sum: { $cond: [{ $eq: ['$outcome', 'partial'] }, 1, 0] } },
            empty: { $sum: { $cond: [{ $eq: ['$outcome', 'empty'] }, 1, 0] } },
            weak: { $sum: { $cond: [{ $eq: ['$outcome', 'weak'] }, 1, 0] } },
            error: { $sum: { $cond: [{ $eq: ['$outcome', 'error'] }, 1, 0] } },
            reported: { $sum: { $cond: [{ $eq: ['$outcome', 'reported'] }, 1, 0] } },
            avgConfidence: { $avg: '$confidence' },
            avgQuestions: { $avg: '$questionCount' }
          }
        }
      ]),
      ParserEvent.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$platform',
            count: { $sum: 1 },
            success: { $sum: { $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0] } },
            partial: { $sum: { $cond: [{ $eq: ['$outcome', 'partial'] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $in: ['$outcome', failedOutcomes] }, 1, 0] } },
            reported: { $sum: { $cond: [{ $eq: ['$outcome', 'reported'] }, 1, 0] } },
            avgConfidence: { $avg: '$confidence' },
            avgQuestions: { $avg: '$questionCount' },
            lastSeenAt: { $max: '$createdAt' },
            topReasons: { $addToSet: '$reason' }
          }
        },
        { $sort: { failed: -1, reported: -1, count: -1, lastSeenAt: -1 } },
        { $limit: 30 }
      ]),
      ParserEvent.aggregate([
        { $match: { ...match, outcome: { $in: [...failedOutcomes, 'reported', 'partial'] } } },
        {
          $group: {
            _id: {
              hostname: { $ifNull: ['$hostname', ''] },
              platform: { $ifNull: ['$platform', 'universal'] },
              reason: { $ifNull: ['$reason', ''] },
              outcome: { $ifNull: ['$outcome', 'unknown'] }
            },
            count: { $sum: 1 },
            avgConfidence: { $avg: '$confidence' },
            avgQuestions: { $avg: '$questionCount' },
            lastSeenAt: { $max: '$createdAt' },
            sampleUrl: { $last: '$url' },
            sampleText: { $last: { $arrayElemAt: ['$snapshot.questionTexts', 0] } }
          }
        },
        { $sort: { count: -1, lastSeenAt: -1 } },
        { $limit: 20 }
      ]),
      ParserEvent.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $ifNull: ['$hostname', ''] },
            count: { $sum: 1 },
            success: { $sum: { $cond: [{ $eq: ['$outcome', 'success'] }, 1, 0] } },
            partial: { $sum: { $cond: [{ $eq: ['$outcome', 'partial'] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $in: ['$outcome', failedOutcomes] }, 1, 0] } },
            reported: { $sum: { $cond: [{ $eq: ['$outcome', 'reported'] }, 1, 0] } },
            avgConfidence: { $avg: '$confidence' },
            avgQuestions: { $avg: '$questionCount' },
            lastSeenAt: { $max: '$createdAt' },
            sampleUrl: { $last: '$url' },
            topReasons: { $addToSet: '$reason' },
            platforms: { $addToSet: '$platform' }
          }
        },
        {
          $addFields: {
            rankScore: {
              $add: [
                { $multiply: ['$failed', 3] },
                { $multiply: ['$reported', 2] },
                '$partial'
              ]
            }
          }
        },
        { $sort: { rankScore: -1, failed: -1, reported: -1, count: -1, lastSeenAt: -1 } },
        { $limit: 20 }
      ]),
      ParserEvent.find(match)
        .sort({ createdAt: -1 })
        .limit(30)
        .populate('userId', 'email')
        .lean(),
      BugReport.find(matchFilter)
        .sort({ createdAt: -1 })
        .limit(12)
        .populate('userId', 'email')
        .lean()
    ]);

    const summary = summaryAgg[0] || {
      total: 0, success: 0, partial: 0, empty: 0, weak: 0, error: 0, reported: 0,
      avgConfidence: 0, avgQuestions: 0
    };
    const failed = (summary.empty || 0) + (summary.weak || 0) + (summary.error || 0);

    res.json({
      success: true,
      windowDays: days,
      since,
      summary: {
        ...summary,
        failed,
        failureRate: summary.total ? failed / summary.total : 0,
        avgConfidence: Number(summary.avgConfidence || 0),
        avgQuestions: Number(summary.avgQuestions || 0)
      },
      platforms: platforms.map(item => ({
        platform: item._id || 'universal',
        count: item.count || 0,
        success: item.success || 0,
        partial: item.partial || 0,
        failed: item.failed || 0,
        reported: item.reported || 0,
        failureRate: item.count ? (item.failed || 0) / item.count : 0,
        avgConfidence: Number(item.avgConfidence || 0),
        avgQuestions: Number(item.avgQuestions || 0),
        lastSeenAt: item.lastSeenAt,
        topReasons: (item.topReasons || []).filter(Boolean).slice(0, 4)
      })),
      problemGroups: problemGroups.map(item => ({
        hostname: item._id?.hostname || '',
        platform: item._id?.platform || 'universal',
        reason: item._id?.reason || '',
        outcome: item._id?.outcome || 'unknown',
        count: item.count || 0,
        avgConfidence: Number(item.avgConfidence || 0),
        avgQuestions: Number(item.avgQuestions || 0),
        lastSeenAt: item.lastSeenAt,
        sampleUrl: item.sampleUrl || '',
        sampleText: item.sampleText || ''
      })),
      domainIssues: domainIssues.map(item => ({
        hostname: item._id || '',
        count: item.count || 0,
        success: item.success || 0,
        partial: item.partial || 0,
        failed: item.failed || 0,
        reported: item.reported || 0,
        failureRate: item.count ? (item.failed || 0) / item.count : 0,
        avgConfidence: Number(item.avgConfidence || 0),
        avgQuestions: Number(item.avgQuestions || 0),
        lastSeenAt: item.lastSeenAt,
        sampleUrl: item.sampleUrl || '',
        topReasons: (item.topReasons || []).filter(Boolean).slice(0, 4),
        platforms: (item.platforms || []).filter(Boolean).slice(0, 4)
      })),
      recentEvents: recentEvents.map(serializeParserEvent),
      recentBugReports: recentBugReports.map(report => ({
        id: report._id,
        user: report.userId?.email || 'Unknown user',
        url: report.url,
        platform: report.platform || '',
        source: report.source || 'manual',
        parserEventId: report.parserEventId || null,
        parserDiagnostics: report.parserDiagnostics || {},
        parserSnapshot: report.parserSnapshot || {},
        hasPageCode: Boolean(report.parserSnapshot?.htmlSnippet || report.parserSnapshot?.fullHtmlFile?.id),
        isRead: report.isRead !== false,
        date: report.createdAt
      }))
    });
  } catch (error) {
    console.error('Error fetching parser health:', error);
    res.status(500).json({ error: 'Error fetching parser health.', details: error.message });
  }
});

function parserEventsQuery(params = {}) {
  const platform = String(params.platform || '').trim().substring(0, 80);
  const outcome = String(params.outcome || '').trim().substring(0, 40);
  const search = String(params.q || '').trim().substring(0, 120);
  const query = {};
  if (platform && platform !== 'all') query.platform = platform;
  if (outcome && outcome !== 'all') query.outcome = outcome;
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i');
    query.$or = [
      { url: pattern },
      { hostname: pattern },
      { platform: pattern },
      { reason: pattern },
      { 'snapshot.bodyText': pattern },
      { 'snapshot.questionTexts': pattern }
    ];
  }
  return query;
}

router.get('/parser/events', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const query = parserEventsQuery(req.query);

    const [total, events] = await Promise.all([
      ParserEvent.countDocuments(query),
      ParserEvent.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId', 'email')
        .lean()
    ]);

    res.json({
      success: true,
      events: events.map(serializeParserEvent),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching parser events.' });
  }
});

router.delete('/parser/events', async (req, res) => {
  try {
    const query = parserEventsQuery(req.query);
    if (!Object.keys(query).length) {
      return res.status(400).json({ error: 'Use the clear-all endpoint to delete every parser event.' });
    }
    const result = await ParserEvent.deleteMany(query);
    auditLog(req.user, 'PARSER_EVENTS_CLEAR_FILTERED', { deleted: result.deletedCount || 0, filter: query });
    res.json({ success: true, deleted: result.deletedCount || 0 });
  } catch (error) {
    res.status(500).json({ error: 'Error clearing parser events.' });
  }
});

router.delete('/parser/events/all', async (req, res) => {
  try {
    let totalDeleted = 0;
    const BATCH_SIZE = 10000;
    // Delete in batches to avoid locking the database with very large collections
    let batch;
    do {
      const ids = await ParserEvent.find({}, { _id: 1 }).limit(BATCH_SIZE).lean();
      if (ids.length === 0) break;
      batch = await ParserEvent.deleteMany({ _id: { $in: ids.map(d => d._id) } });
      totalDeleted += batch.deletedCount || 0;
    } while (batch.deletedCount >= BATCH_SIZE);
    auditLog(req.user, 'PARSER_EVENTS_CLEAR_ALL', { deleted: totalDeleted });
    res.json({ success: true, deleted: totalDeleted });
  } catch (error) {
    res.status(500).json({ error: 'Error clearing parser events.' });
  }
});

router.get('/support/messages', async (req, res) => {
  try {
    const status = String(req.query.status || '').substring(0, 20);
    const search = String(req.query.q || '').trim().substring(0, 120);
    const filters = [];
    if (status && ['open', 'pending', 'closed'].includes(status)) filters.push({ status });
    if (search) {
      const pattern = new RegExp(escapeRegExp(search), 'i');
      filters.push({
        $or: [
          { fromEmail: pattern },
          { fromName: pattern },
          { subject: pattern },
          { text: pattern },
          { source: pattern }
        ]
      });
    }
    const query = filters.length ? { $and: filters } : {};
    const messages = await SupportMessage.find(query)
      .sort({ updatedAt: -1 })
      .limit(150)
      .populate('replies.adminUser', 'email displayName')
      .lean();
    const emails = [...new Set(messages.map(m => String(m.fromEmail || '').toLowerCase()).filter(Boolean))];
    const linkedUsers = emails.length
      ? await User.find({ email: { $in: emails } })
        .select('email displayName role credits stats streak isBanned extensionLastSeenAt extensionLastSeenReason extensionLastSeenUrl extensionLastSeenPlatform createdAt')
        .lean()
      : [];
    const usersByEmail = new Map(linkedUsers.map(user => [user.email, serializeAdminUser(user)]));
    res.json({
      success: true,
      messages: messages.map(m => ({
        id: m._id,
        fromEmail: m.fromEmail,
        fromName: m.fromName,
        toEmail: m.toEmail,
        subject: m.subject,
        text: m.text,
        html: m.html,
        providerMessageId: m.providerMessageId,
        source: m.source,
        status: m.status,
        isRead: m.isRead,
        receivedAt: m.receivedAt,
        repliedAt: m.repliedAt,
        linkedUser: usersByEmail.get(String(m.fromEmail || '').toLowerCase()) || null,
        replies: (m.replies || []).map(r => ({
          id: r._id,
          admin: r.adminUser?.displayName || r.adminUser?.email || r.fromEmail || 'Customer',
          fromEmail: r.fromEmail,
          toEmail: r.toEmail,
          subject: r.subject,
          text: r.text,
          html: r.html,
          providerMessageId: r.providerMessageId,
          sentAt: r.sentAt,
          delivery: r.delivery,
          error: r.error
        }))
      }))
    });
  } catch {
    res.status(500).json({ error: 'Error fetching support messages.' });
  }
});

router.patch('/support/messages/:messageId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.messageId)) return res.status(400).json({ error: 'Invalid ID.' });
    const patch = {};
    if (['open', 'pending', 'closed'].includes(req.body.status)) patch.status = req.body.status;
    if (typeof req.body.isRead === 'boolean') patch.isRead = req.body.isRead;
    const message = await SupportMessage.findByIdAndUpdate(req.params.messageId, { $set: patch }, { new: true });
    if (!message) return res.status(404).json({ error: 'Support message not found.' });
    auditLog(req.user, 'SUPPORT_UPDATE', { messageId: message._id.toString(), patch });
    res.json({ success: true, message });
  } catch {
    res.status(500).json({ error: 'Error updating support message.' });
  }
});

router.post('/support/messages/:messageId/reply', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.messageId)) return res.status(400).json({ error: 'Invalid ID.' });
    const message = await SupportMessage.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Support message not found.' });
    const text = String(req.body.text || '').trim().substring(0, 10000);
    if (!text) return res.status(400).json({ error: 'Reply text is required.' });
    
    let template = supportReplyTemplate({ message, replyText: text });
    let finalText = text;
    
    if (req.body.generateDiscount) {
      try {
        const { createLemonSqueezyDiscount, generateRandomCode } = require('../services/lemonSqueezyService');
        const code = generateRandomCode('SUPPORT');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await createLemonSqueezyDiscount({
          name: `Support Discount for ${message.fromEmail}`,
          code,
          amountPercent: 10,
          maxRedemptions: 1,
          expiresAt
        });
        
        const discountBox = `<div style="margin-top:20px;padding:15px;border:1px dashed #06b6d4;border-radius:8px;background:rgba(6,182,212,0.05);color:#06b6d4;text-align:center;">
          <strong>TwĂłj kod rabatowy (-10%, waĹĽny 7 dni):</strong><br>
          <span style="font-size:24px;font-weight:bold;letter-spacing:2px;display:block;margin-top:10px;">${code}</span>
        </div>`;
        
        template.html = template.html.replace('</body>', discountBox + '</body>');
        template.text += `\n\nTwĂłj jednorazowy kod rabatowy (-10%, waĹĽny 7 dni): ${code}`;
        finalText += `\n\nTwĂłj jednorazowy kod rabatowy (-10%, waĹĽny 7 dni): ${code}`;
      } catch (err) {
        console.error('Failed to generate discount:', err);
      }
    }

    let delivery = { success: false, disabled: true };
    let error = '';
    try {
      delivery = await sendEmail({
        to: message.fromEmail,
        replyTo: SUPPORT_EMAIL,
        ...template
      });
    } catch (err) {
      error = err.message || 'Email delivery failed.';
    }
    
    message.replies.push({
      adminUser: req.user._id,
      fromEmail: SUPPORT_EMAIL,
      toEmail: message.fromEmail,
      subject: template.subject,
      text: finalText,
      html: template.html,
      providerMessageId: delivery.id || '',
      delivery: delivery.success ? 'sent' : (delivery.disabled ? 'disabled' : 'failed'),
      error
    });
    message.status = delivery.success ? 'pending' : message.status;
    message.isRead = true;
    message.repliedAt = new Date();
    await message.save();
    auditLog(req.user, 'SUPPORT_REPLY', { messageId: message._id.toString(), to: message.fromEmail, delivery: delivery.success ? 'sent' : 'not-sent' });
    res.json({
      success: true,
      delivery,
      message: {
        id: message._id,
        status: message.status,
        replies: message.replies
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error sending support reply.' });
  }
});

router.delete('/support/messages/:messageId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.messageId)) {
      return res.status(400).json({ error: 'Invalid support message id.' });
    }
    const message = await SupportMessage.findByIdAndDelete(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Support message not found.' });
    auditLog(req.user, 'SUPPORT_DELETE', { messageId: message._id.toString(), from: message.fromEmail });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Error deleting support message.' });
  }
});

router.delete('/users/:userId', async (req, res) => {
  try {
    if (req.params.userId === req.user._id.toString()) return res.status(400).json({ error: 'Cannot delete yourself.' });
    const user = await User.findByIdAndDelete(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    await Purchase.deleteMany({ userId: req.params.userId });
    auditLog(req.user, 'DELETE_USER', { target: user.email });
    res.json({ success: true, message: `${user.email} deleted.` });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting user.' });
  }
});

router.get('/cache/stats', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const search = String(req.query.q || '').trim().substring(0, 120);
    const query = search
      ? { questionText: new RegExp(escapeRegExp(search), 'i') }
      : {};

    const [totalCached, totalMatching, topHits] = await Promise.all([
      CachedAnswer.countDocuments(),
      CachedAnswer.countDocuments(query),
      CachedAnswer.find(query)
        .sort({ lastUsedAt: -1, createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('questionText questionType hitCount options prompts rows answer createdAt lastUsedAt')
    ]);

    res.json({
      success: true,
      totalCached,
      totalMatching,
      topHits,
      pagination: {
        page,
        limit,
        total: totalMatching,
        pages: Math.max(1, Math.ceil(totalMatching / limit))
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching cache stats.' });
  }
});

router.delete('/cache/clear', async (req, res) => {
  try {
    const result = await CachedAnswer.deleteMany({});
    auditLog(req.user, 'CACHE_CLEAR', { deleted: result.deletedCount });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: 'Error clearing cache.' });
  }
});

router.delete('/cache/:cacheId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.cacheId)) {
      return res.status(400).json({ error: 'Invalid cache id.' });
    }

    const cacheEntry = await CachedAnswer.findByIdAndDelete(req.params.cacheId);
    if (!cacheEntry) return res.status(404).json({ error: 'Cache entry not found.' });

    auditLog(req.user, 'CACHE_ENTRY_DELETE', {
      cacheId: cacheEntry._id.toString(),
      questionHash: cacheEntry.questionHash,
      hitCount: cacheEntry.hitCount
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting cache entry.' });
  }
});

router.get('/billing/safety', async (req, res) => {
  try {
    const chargedMatch = {
      $or: [
        { charged: true },
        { status: 'charged' },
        { status: { $exists: false }, chargedAt: { $ne: null } }
      ]
    };
    const staleDate = new Date(Date.now() - 15 * 60 * 1000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      totalClaims,
      chargedRecords,
      waivedRecords,
      activeClaims,
      staleClaims,
      abortedRecords,
      declinedRecords,
      chargedLast24h,
      duplicateCharges,
      recentCharges
    ] = await Promise.all([
      CreditUsage.countDocuments(),
      CreditUsage.countDocuments(chargedMatch),
      CreditUsage.countDocuments({ status: 'waived' }),
      CreditUsage.countDocuments({ status: 'claimed', createdAt: { $gte: staleDate } }),
      CreditUsage.countDocuments({ status: 'claimed', createdAt: { $lt: staleDate } }),
      CreditUsage.countDocuments({ status: 'aborted' }),
      CreditUsage.countDocuments({ status: 'declined' }),
      CreditUsage.countDocuments({ ...chargedMatch, chargedAt: { $gte: dayAgo } }),
      CreditUsage.aggregate([
        { $match: chargedMatch },
        {
          $group: {
            _id: { user: '$user', action: '$action', questionHash: '$questionHash', dedupeWindow: '$dedupeWindow' },
            count: { $sum: 1 },
            credits: { $sum: '$credits' },
            actions: { $addToSet: '$action' },
            firstChargedAt: { $min: '$chargedAt' },
            lastChargedAt: { $max: '$chargedAt' }
          }
        },
        {
          $addFields: {
            spanMs: { $subtract: ['$lastChargedAt', '$firstChargedAt'] }
          }
        },
        {
          $match: {
            count: { $gt: 1 },
            spanMs: { $lte: CREDIT_DUPLICATE_REVIEW_WINDOW_MS }
          }
        },
        { $sort: { lastChargedAt: -1 } },
        { $limit: 25 },
        { $lookup: { from: 'users', localField: '_id.user', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            userId: '$_id.user',
            email: '$user.email',
            action: '$_id.action',
            questionHash: '$_id.questionHash',
            dedupeWindow: '$_id.dedupeWindow',
            count: 1,
            credits: 1,
            actions: 1,
            spanMs: 1,
            reviewWindowMs: CREDIT_DUPLICATE_REVIEW_WINDOW_MS,
            firstChargedAt: 1,
            lastChargedAt: 1
          }
        }
      ]),
      CreditUsage.find(chargedMatch)
        .sort({ chargedAt: -1, updatedAt: -1 })
        .limit(10)
        .populate('user', 'email')
        .lean()
    ]);

    const duplicateHashes = [...new Set((duplicateCharges || []).map(item => item.questionHash).filter(Boolean))];
    const duplicateUserIds = [...new Set((duplicateCharges || []).map(item => String(item.userId || '')).filter(Boolean))];
    const [duplicateNotes, duplicateCachedAnswers] = duplicateHashes.length ? await Promise.all([
      StudyNote.find({ questionHash: { $in: duplicateHashes }, user: { $in: duplicateUserIds } })
        .sort({ lastSeenAt: -1 })
        .select('user questionHash questionText questionType answer options prompts rows sourceUrl platform')
        .lean(),
      CachedAnswer.find({ questionHash: { $in: duplicateHashes } })
        .select('questionHash questionText questionType answer options prompts rows')
        .lean()
    ]) : [[], []];
    const duplicateNotesByUserHash = new Map();
    for (const note of duplicateNotes) {
      const key = `${note.user}:${note.questionHash}`;
      if (!duplicateNotesByUserHash.has(key)) duplicateNotesByUserHash.set(key, note);
    }
    const duplicateCacheByHash = new Map(duplicateCachedAnswers.map(item => [item.questionHash, item]));

    res.json({
      success: true,
      billing: {
        totalClaims,
        chargedRecords,
        waivedRecords,
        activeClaims,
        staleClaims,
        abortedRecords,
        declinedRecords,
        chargedLast24h,
        duplicateGroups: (duplicateCharges || []).map(group => {
          const key = `${group.userId}:${group.questionHash}`;
          const source = duplicateNotesByUserHash.get(key) || duplicateCacheByHash.get(group.questionHash) || {};
          return {
            ...group,
            questionText: source.questionText || '',
            questionType: source.questionType || '',
            answerText: answerToText(source.questionType, source.options || [], source.answer, { prompts: source.prompts || [], rows: source.rows || [] }),
            sourceUrl: source.sourceUrl || '',
            platform: source.platform || ''
          };
        }),
        recentCharges: recentCharges.map(item => ({
          id: item._id,
          email: item.user?.email || 'Unknown user',
          userId: item.user?._id || item.user,
          action: item.action,
          questionHash: item.questionHash,
          credits: item.credits,
          chargedAt: item.chargedAt,
          status: item.status || (item.chargedAt ? 'charged' : 'claimed')
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching billing safety.' });
  }
});

router.get('/billing/usage', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const status = String(req.query.status || '').trim();
    const action = String(req.query.action || '').trim();
    const userId = String(req.query.userId || '').trim();
    const search = String(req.query.q || '').trim().substring(0, 120);
    const validStatuses = new Set(['claimed', 'charged', 'waived', 'aborted', 'declined']);
    const validActions = new Set(['solve', 'solve-snapshot', 'solve-batch', 'explain', 'follow-up']);
    const query = {};

    if (status && status !== 'all' && validStatuses.has(status)) query.status = status;
    if (action && action !== 'all' && validActions.has(action)) query.action = action;
    if (userId && mongoose.Types.ObjectId.isValid(userId)) query.user = new mongoose.Types.ObjectId(userId);

    if (search) {
      const searchRegex = new RegExp(escapeRegExp(search), 'i');
      const [matchingUsers, matchingNotes, matchingCached] = await Promise.all([
        User.find({
          $or: [
            { email: searchRegex },
            { displayName: searchRegex }
          ]
        }).select('_id').limit(50).lean(),
        StudyNote.find({ questionText: searchRegex }).select('questionHash').limit(100).lean(),
        CachedAnswer.find({ questionText: searchRegex }).select('questionHash').limit(100).lean()
      ]);
      const userIds = matchingUsers.map(user => user._id);
      const questionHashes = [...new Set([
        ...matchingNotes.map(note => note.questionHash),
        ...matchingCached.map(cache => cache.questionHash)
      ].filter(Boolean))];
      const searchFilters = [];
      if (userIds.length) searchFilters.push({ user: { $in: userIds } });
      if (questionHashes.length) searchFilters.push({ questionHash: { $in: questionHashes } });
      if (search.length >= 6) searchFilters.push({ questionHash: searchRegex });
      if (validActions.has(search)) searchFilters.push({ action: search });
      if (validStatuses.has(search)) searchFilters.push({ status: search });
      query.$or = searchFilters.length ? searchFilters : [{ _id: null }];
    }

    const chargedCondition = {
      $or: [
        { charged: true },
        { status: 'charged' },
        { status: { $exists: false }, chargedAt: { $ne: null } }
      ]
    };
    const chargedQuery = { $and: [query, chargedCondition] };

    const [total, usageRecords, statusCounts, chargedAgg] = await Promise.all([
      CreditUsage.countDocuments(query),
      CreditUsage.find(query)
        .sort({ chargedAt: -1, claimedAt: -1, updatedAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'email displayName credits role')
        .lean(),
      CreditUsage.aggregate([
        { $match: query },
        { $group: { _id: '$status', count: { $sum: 1 }, credits: { $sum: '$credits' } } }
      ]),
      CreditUsage.aggregate([
        { $match: chargedQuery },
        { $group: { _id: null, count: { $sum: 1 }, credits: { $sum: '$credits' } } }
      ])
    ]);

    const questionHashes = [...new Set(usageRecords.map(item => item.questionHash).filter(Boolean))];
    const userIds = [...new Set(usageRecords.map(item => String(item.user?._id || item.user || '')).filter(Boolean))];
    const [notes, cachedAnswers] = questionHashes.length ? await Promise.all([
      StudyNote.find({ questionHash: { $in: questionHashes }, user: { $in: userIds } })
        .sort({ lastSeenAt: -1 })
        .select('user questionHash questionText questionType options prompts rows answer sourceUrl platform seenCount lastSeenAt')
        .lean(),
      CachedAnswer.find({ questionHash: { $in: questionHashes } })
        .select('questionHash questionText questionType options prompts rows answer hitCount lastUsedAt')
        .lean()
    ]) : [[], []];

    const notesByUserHash = new Map();
    for (const note of notes) {
      const key = `${note.user}:${note.questionHash}`;
      if (!notesByUserHash.has(key)) notesByUserHash.set(key, note);
    }
    const cacheByHash = new Map(cachedAnswers.map(item => [item.questionHash, item]));
    const statusSummary = statusCounts.reduce((acc, item) => {
      const key = item._id || 'unknown';
      acc[key] = { count: item.count || 0, credits: item.credits || 0 };
      return acc;
    }, {});

    res.json({
      success: true,
      usage: usageRecords.map(item => {
        const key = `${item.user?._id || item.user}:${item.questionHash}`;
        return serializeAdminCreditUsage(item, notesByUserHash.get(key), cacheByHash.get(item.questionHash));
      }),
      summary: {
        total,
        chargedRecords: chargedAgg[0]?.count || 0,
        chargedCredits: chargedAgg[0]?.credits || 0,
        status: statusSummary
      },
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit))
      }
    });
  } catch (error) {
    console.error('[Admin] Billing usage error:', error.message);
    res.status(500).json({ error: 'Error fetching credit usage.' });
  }
});

router.get('/system/health', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const dbState = mongoose.connection.readyState;
    const dbStates = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
    const mem = process.memoryUsage();

    res.json({
      success: true,
      health: {
        uptime: Math.floor(process.uptime()),
        database: dbStates[dbState] || 'unknown',
        memory: {
          rss: Math.round(mem.rss / 1048576) + ' MB',
          heapUsed: Math.round(mem.heapUsed / 1048576) + ' MB',
          heapTotal: Math.round(mem.heapTotal / 1048576) + ' MB'
        },
        nodeVersion: process.version,
        env: process.env.NODE_ENV || 'development'
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error checking health.' });
  }
});

router.get('/client-errors', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    
    const ClientError = require('../models/ClientError');
    const [errors, total] = await Promise.all([
      ClientError.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'email displayName')
        .lean(),
      ClientError.countDocuments()
    ]);

    res.json({
      success: true,
      errors: errors.map(e => ({
        id: e._id,
        message: e.message,
        stack: e.stack,
        url: e.url,
        source: e.source,
        userAgent: e.userAgent,
        version: e.version,
        user: e.user ? { id: e.user._id, email: e.user.email, displayName: e.user.displayName } : null,
        createdAt: e.createdAt
      })),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load client errors.' });
  }
});

router.delete('/client-errors/:id', async (req, res) => {
  try {
    const ClientError = require('../models/ClientError');
    await ClientError.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete client error.' });
  }
});

router.post('/users/:id/quick-grant', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid credits amount' });
    const Purchase = require('../models/Purchase');
    const result = await Purchase.recordPurchase(req.params.id, 'admin_grant', amount, {
      priceUsd: 0,
      paymentProvider: 'manual',
      grantedBy: req.user._id,
      grantReason: 'Admin quick grant'
    });
    res.json({ success: true, purchase: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/users/:id/grant-credits', async (req, res) => {
  try {
    const { credits, reason } = req.body;
    if (!credits || credits <= 0) return res.status(400).json({ error: 'Invalid credits amount' });
    const Purchase = require('../models/Purchase');
    const result = await Purchase.recordPurchase(req.params.id, 'admin_grant', credits, {
      priceUsd: 0,
      paymentProvider: 'manual',
      grantedBy: req.user._id,
      grantReason: reason || 'Admin manual grant'
    });
    res.json({ success: true, purchase: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.delete('/support/messages/:messageId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.messageId)) {
      return res.status(400).json({ error: 'Invalid support message id.' });
    }
    const message = await SupportMessage.findByIdAndDelete(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Support message not found.' });
    auditLog(req.user, 'SUPPORT_DELETE', { messageId: message._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error deleting support message.' });
  }
});

router.get('/marketing/all-emails', async (req, res) => {
  try {
    const users = await User.find({}, 'email').sort({ createdAt: -1 }).limit(10000);
    res.json({ success: true, emails: users.map(u => u.email) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch emails.' });
  }
});

router.get('/marketing/users', async (req, res) => {
  try {
    const users = await User.find({ marketingConsent: true }, 'email').sort({ createdAt: -1 });
    res.json({ success: true, users: users.map(u => u.email) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

router.get('/marketing/stats', async (req, res) => {
  try {
    const totalOptIn = await User.countDocuments({ marketingConsent: true });
    res.json({ success: true, totalOptIn });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

router.post('/marketing/send', async (req, res) => {
  try {
    const { subject, html, targetCount, targetEmail, ignoreConsent, discountType, discountPrefix, discountExactCode, discountPercent, discountExpiresDays, discountMaxUses } = req.body;
    if (!subject || !html) return res.status(400).json({ error: 'Subject and HTML required.' });
    
    let users = [];
    if (targetEmail) {
      let user = await User.findOne({ email: targetEmail });
      if (!user) {
        // If not in DB, create a dummy object so we can still send the email
        user = { _id: new mongoose.Types.ObjectId(), email: targetEmail, marketingConsent: false };
      }
      users = [user];
    } else {
      const query = ignoreConsent ? {} : { marketingConsent: true };
      users = await User.find(query, '_id email').limit(5000);
      if (targetCount && targetCount < users.length) {
        users = users.sort(() => 0.5 - Math.random()).slice(0, targetCount);
      }
    }
    
    if (users.length === 0) return res.status(400).json({ error: 'No users to send to.' });
    const { sendMarketingBatch } = require('../services/emailService');
    const { createLemonSqueezyDiscount, generateRandomCode } = require('../services/lemonSqueezyService');

    let globalCode = null;
    let uniqueCodes = [];
    
    const expiresAt = discountExpiresDays ? new Date(Date.now() + discountExpiresDays * 24 * 60 * 60 * 1000).toISOString() : null;

    if (discountType === 'global') {
      globalCode = discountExactCode ? (discountPrefix || 'PROMO') : generateRandomCode(discountPrefix || 'PROMO');
      await createLemonSqueezyDiscount({
        name: `Global ${discountPrefix || 'PROMO'} Campaign`,
        code: globalCode,
        amountPercent: discountPercent || 10,
        maxRedemptions: discountMaxUses || 0,
        expiresAt
      });
    } else if (discountType === 'unique') {
      for (let i = 0; i < users.length; i++) {
        const code = generateRandomCode(discountPrefix || 'PROMO');
        uniqueCodes.push(code);
        await createLemonSqueezyDiscount({
          name: `Unique ${discountPrefix || 'PROMO'} for ${users[i].email}`,
          code: code,
          amountPercent: discountPercent || 10,
          maxRedemptions: 1,
          expiresAt
        });
      }
    }

    const result = await sendMarketingBatch(users, subject, html, {
      discountType,
      globalCode,
      uniqueCodes,
      discountPercent,
      discountExpiresDays
    });
    
    auditLog(req.user, 'MARKETING_SENT', { subject, count: users.length, discountType });
    res.json(result);
  } catch (err) {
    console.error('Marketing send error:', err);
    res.status(500).json({ error: err.message || 'Failed to send marketing emails.' });
  }
});


router.get('/dataset', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../data/parser_dataset.jsonl');
    if (!fs.existsSync(filePath)) {
      return res.json([]);
    }
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const data = fileContent.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch(e){ return null; }
    }).filter(Boolean).reverse();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to read dataset' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   CONVERSION FUNNEL (cohort based)
   GET /api/admin/funnel?days=30[&version=x.y.z]
   Cohort = non-admin users registered in the period. Each step counts
   distinct users from that cohort who reached it.
   ───────────────────────────────────────────────────────────────── */
router.get('/funnel', async (req, res) => {
  try {
    const CreditUsage = require('../models/CreditUsage');
    const CheckoutStart = require('../models/CheckoutStart');
    const Purchase = require('../models/Purchase');

    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
    const since = new Date(Date.now() - days * 86400000);
    const userMatch = { createdAt: { $gte: since }, role: { $ne: 'admin' } };
    const version = typeof req.query.version === 'string' ? req.query.version.trim() : '';
    if (version) userMatch.extensionVersion = version;

    const cohort = await User.find(userMatch).select('_id credits stats.totalQuestionsSolved').limit(100000).lean();
    const ids = cohort.map(u => u._id);

    const signedUp = cohort.length;
    const solvedSet = new Set(cohort.filter(u => (u.stats?.totalQuestionsSolved || 0) > 0).map(u => String(u._id)));

    // "Out of credits": balance is 0 now OR a request was declined for lack of credits
    const exhaustedSet = new Set(cohort.filter(u => (u.credits || 0) <= 0).map(u => String(u._id)));
    const [declinedIds, checkoutIds, paidRows, firstCheckout] = await Promise.all([
      CreditUsage.distinct('user', { user: { $in: ids }, status: 'declined' }),
      CheckoutStart.distinct('user', { user: { $in: ids } }),
      Purchase.find({
        userId: { $in: ids },
        paymentProvider: { $in: ['lemonsqueezy', 'whop'] },
        priceUsd: { $gt: 0 },
      }).select('userId priceUsd').lean(),
      CheckoutStart.findOne().sort({ createdAt: 1 }).select('createdAt').lean(),
    ]);
    declinedIds.forEach(id => exhaustedSet.add(String(id)));

    const paidSet = new Set(paidRows.map(p => String(p.userId)));
    const revenue = paidRows.reduce((s, p) => s + (p.priceUsd || 0), 0);
    const checkoutSet = new Set(checkoutIds.map(String));

    const steps = [
      { key: 'signup',    label: 'Rejestracja',            count: signedUp },
      { key: 'solved',    label: 'Pierwsze rozwiązanie',   count: solvedSet.size },
      { key: 'exhausted', label: 'Kredyty wyczerpane',     count: exhaustedSet.size },
      { key: 'checkout',  label: 'Checkout rozpoczęty',    count: checkoutSet.size },
      { key: 'purchase',  label: 'Zakup',                  count: paidSet.size },
    ];

    res.json({
      success: true,
      days,
      version: version || null,
      steps,
      revenue: Number(revenue.toFixed(2)),
      arpu: signedUp ? Number((revenue / signedUp).toFixed(3)) : 0,
      payerValue: paidSet.size ? Number((revenue / paidSet.size).toFixed(2)) : 0,
      // Checkout tracking started on deploy - earlier checkouts are not in the data
      checkoutTrackedSince: firstCheckout?.createdAt || null,
    });
  } catch (error) {
    console.error('[funnel]', error);
    res.status(500).json({ error: 'Error building funnel' });
  }
});
router.get('/chart-stats', async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const Purchase = require('../models/Purchase');
    const User = require('../models/User');
    
    const [purchases, users, usages] = await Promise.all([
      Purchase.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { 
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            revenue: { $sum: '$priceUsd' },
            credits: { $sum: '$credits' }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      User.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { 
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            signups: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      require('../models/CreditUsage').aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo }, status: 'charged' } },
        { $group: { 
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            spentCredits: { $sum: '$credits' }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);
    
    res.json({ success: true, purchases, users, usages });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching chart stats' });
  }
});




/* ─────────────────────────────────────────────────────────────────
   PARSER ANALYSIS ZIP EXPORT
   GET /api/admin/parser/analysis-zip?days=N&includeHtml=true
   ───────────────────────────────────────────────────────────────── */
const zlib = require('zlib');

function buildZip(files) {
  const buffers = [];
  const centralDir = [];
  let offset = 0;

  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; };
  const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; };

  const now = new Date();
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();

  function crc32(buf) {
    let crc = 0xffffffff;
    for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  for (const file of files) {
    const raw  = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const comp = zlib.deflateRawSync(raw, { level: 6 });
    const crc  = crc32(raw);
    const name = Buffer.from(file.name, 'utf8');

    const lh = Buffer.concat([
      Buffer.from([0x50,0x4b,0x03,0x04]),
      u16(20), u16(0), u16(8),
      u16(dosTime), u16(dosDate),
      u32(crc), u32(comp.length), u32(raw.length),
      u16(name.length), u16(0),
      name, comp,
    ]);

    centralDir.push(Buffer.concat([
      Buffer.from([0x50,0x4b,0x01,0x02]),
      u16(20), u16(20), u16(0), u16(8),
      u16(dosTime), u16(dosDate),
      u32(crc), u32(comp.length), u32(raw.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), name,
    ]));

    offset += lh.length;
    buffers.push(lh);
  }

  const cdBuf = Buffer.concat(centralDir);
  const eocd  = Buffer.concat([
    Buffer.from([0x50,0x4b,0x05,0x06]),
    u16(0), u16(0),
    u16(files.length), u16(files.length),
    u32(cdBuf.length), u32(offset), u16(0),
  ]);

  return Buffer.concat([...buffers, cdBuf, eocd]);
}

// List of extension versions seen in parser events / bug reports (newest first)
router.get('/parser/versions', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [a, b] = await Promise.all([
      ParserEvent.distinct('extensionVersion'),
      BugReport.distinct('extensionVersion'),
    ]);
    const cmp = (x, y) => y.localeCompare(x, undefined, { numeric: true });
    const versions = [...new Set([...a, ...b].filter(v => typeof v === 'string' && v.trim()))].sort(cmp);
    res.json({ success: true, versions });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching versions' });
  }
});

router.get('/parser/analysis-zip', authMiddleware, adminOnly, async (req, res) => {
  try {
    const days        = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 90);
    const includeHtml = req.query.includeHtml !== 'false';
    const version = req.query.version || null;
    const since = new Date(Date.now() - days * 86400_000);
    const matchFilter = { createdAt: { $gte: since } };
    if (version) matchFilter.extensionVersion = version;

    const [events, bugReports, recentAnswers] = await Promise.all([
      ParserEvent.find(matchFilter)
        .populate('userId', 'email')
        .sort({ createdAt: -1 })
        .limit(5000)
        .lean(),
      BugReport.find(matchFilter)
        .populate('userId', 'email')
        .sort({ createdAt: -1 })
        .limit(500)
        .lean(),
      version ? Promise.resolve([]) : CachedAnswer.find({ createdAt: { $gte: since } })
        .sort({ hitCount: -1 })
        .limit(200)
        .select('questionText questionType options answer explanation platform hitCount createdAt')
        .lean(),
    ]);

    // Questions saved by users (tagged with extension version); images excluded to keep ZIP small
    const questionNotes = await StudyNote.find(matchFilter)
      .populate('user', 'email')
      .sort({ createdAt: -1 })
      .limit(2000)
      .select('-questionImageBase64 -personalNote -userNote')
      .lean();

    const failedEvents  = events.filter(e => ['error','empty','weak'].includes(e.outcome));
    const successEvents = events.filter(e => e.outcome === 'success');

    // ── Aggregations ──────────────────────────────────────────
    const byOutcome  = {};
    const byPlatform = {};
    let totalConf = 0, confCount = 0;

    for (const e of events) {
      byOutcome[e.outcome] = (byOutcome[e.outcome] || 0) + 1;
      const pk = e.platform || 'universal';
      if (!byPlatform[pk]) byPlatform[pk] = { total:0, success:0, failed:0, partial:0, confSum:0, confN:0 };
      const pp = byPlatform[pk];
      pp.total++;
      if (e.outcome === 'success') pp.success++;
      if (['error','empty','weak'].includes(e.outcome)) pp.failed++;
      if (e.outcome === 'partial') pp.partial++;
      if (e.confidence > 0) { pp.confSum += e.confidence; pp.confN++; totalConf += e.confidence; confCount++; }
    }

    const platformSummary = Object.entries(byPlatform).map(([plat, d]) => ({
      platform: plat, total: d.total, success: d.success, failed: d.failed, partial: d.partial,
      successRate: d.total ? (d.success/d.total*100).toFixed(1)+'%' : '—',
      avgConfidence: d.confN ? (d.confSum/d.confN).toFixed(3) : '—',
    })).sort((a,b) => b.total - a.total);

    // Problem groups
    const pgMap = {};
    for (const e of failedEvents) {
      const key = `${e.hostname}|${e.platform}|${e.outcome}`;
      if (!pgMap[key]) pgMap[key] = { hostname: e.hostname, platform: e.platform, outcome: e.outcome, reason: e.reason, count: 0, lastSeenAt: e.createdAt, urls: [] };
      pgMap[key].count++;
      if (e.url && pgMap[key].urls.length < 3 && !pgMap[key].urls.includes(e.url)) pgMap[key].urls.push(e.url);
      if (e.createdAt > pgMap[key].lastSeenAt) pgMap[key].lastSeenAt = e.createdAt;
    }
    const problemGroups = Object.values(pgMap).sort((a,b) => b.count - a.count).slice(0, 100);

    // Confidence buckets
    const confBuckets = { '0.0-0.2':0, '0.2-0.4':0, '0.4-0.6':0, '0.6-0.8':0, '0.8-1.0':0 };
    for (const e of events) {
      const c = e.confidence || 0;
      if      (c < 0.2) confBuckets['0.0-0.2']++;
      else if (c < 0.4) confBuckets['0.2-0.4']++;
      else if (c < 0.6) confBuckets['0.4-0.6']++;
      else if (c < 0.8) confBuckets['0.6-0.8']++;
      else              confBuckets['0.8-1.0']++;
    }

    // Top failure reasons
    const reasonMap = {};
    for (const e of failedEvents) {
      const r = e.reason || '(no reason)';
      reasonMap[r] = (reasonMap[r] || 0) + 1;
    }
    const topReasons = Object.entries(reasonMap).sort((a,b) => b[1]-a[1]).slice(0,30)
      .map(([reason, count]) => ({ reason, count }));

    // Selector patterns from failed snapshots
    const selectorPatterns = {};
    for (const e of failedEvents) {
      for (const [sel, cnt] of Object.entries(e.snapshot?.selectorSummary || {})) {
        selectorPatterns[sel] = (selectorPatterns[sel] || 0) + Number(cnt);
      }
    }
    const topSelectors = Object.entries(selectorPatterns).sort((a,b) => b[1]-a[1]).slice(0,20)
      .map(([selector, count]) => ({ selector, count }));

    // Daily breakdown
    const dayMap = {};
    for (const e of events) {
      const d = (e.createdAt || new Date()).toISOString().slice(0,10);
      if (!dayMap[d]) dayMap[d] = { date:d, total:0, success:0, failed:0, partial:0 };
      dayMap[d].total++;
      if (e.outcome === 'success')                      dayMap[d].success++;
      if (['error','empty','weak'].includes(e.outcome)) dayMap[d].failed++;
      if (e.outcome === 'partial')                      dayMap[d].partial++;
    }
    const dailyBreakdown = Object.values(dayMap).sort((a,b) => a.date.localeCompare(b.date));

    // ── Serializers ────────────────────────────────────────────
    const serEvent = (e, withSnap) => ({
      id: e._id, outcome: e.outcome, platform: e.platform, detectorPlatform: e.detectorPlatform,
      url: e.url, hostname: e.hostname, confidence: e.confidence, reason: e.reason,
      questionCount: e.questionCount, supportedQuestionCount: e.supportedQuestionCount,
      questionTypes: e.questionTypes, attemptedTypes: e.attemptedTypes,
      parserVersion: e.parserVersion, extensionVersion: e.extensionVersion,
      userEmail: e.userId?.email || 'unknown', createdAt: e.createdAt,
      ...(withSnap && includeHtml ? {
        snapshot_title:          e.snapshot?.title,
        snapshot_bodyText:       (e.snapshot?.bodyText    || '').slice(0, 2000),
        snapshot_htmlSnippet:    (e.snapshot?.htmlSnippet || '').slice(0, 4000),
        snapshot_questionTexts:  e.snapshot?.questionTexts || [],
        snapshot_optionsSample:  e.snapshot?.optionsSample || [],
        snapshot_selectorSummary: e.snapshot?.selectorSummary || {},
        snapshot_questionsData:  (e.snapshot?.questionsData || []).slice(0, 10),
      } : {}),
    });

    const serBug = b => ({
      id: b._id, isRead: b.isRead, platform: b.platform, sourceUrl: b.sourceUrl,
      userEmail: b.userId?.email || 'unknown', description: b.description,
      parserOutcome: b.parserOutcome, questionText: b.questionText,
      extensionVersion: b.extensionVersion || '',
      hasSnapshot: !!(b.parserSnapshotFileId || b.snapshotId), createdAt: b.createdAt,
    });

    // ── README ─────────────────────────────────────────────────
    const readme = [
      '# Parser Analysis Export',
      `Generated: ${new Date().toISOString()}`,
      `Period: last ${days} days (${since.toISOString().slice(0,10)} → ${new Date().toISOString().slice(0,10)})`,
      '',
      '## Files',
      '',
      '| File | Description |',
      '|------|-------------|',
      '| summary.json | Totals, by-outcome counts, platform breakdown, daily trend |',
      '| failed_events.jsonl | All error/empty/weak events with snapshot data — main debug source |',
      '| success_sample.jsonl | 100 random successful events for comparison |',
      '| bug_reports.json | User-submitted bug reports for the period |',
      '| problem_groups.json | Failures aggregated by hostname+platform+outcome with sample URLs |',
      '| confidence_distribution.json | Confidence score bucket histogram |',
      '| top_failure_reasons.json | Most frequent parser reason strings ranked |',
      '| selector_patterns.json | CSS selectors found on pages that failed parsing |',
      '| daily_breakdown.json | Per-day event counts |',
      '| questions.jsonl | Questions saved by users (with extensionVersion) - filtered to the selected version |',
      '| cached_answers_sample.json | Recently cached correct answers (what the parser did get right) |',
      '',
      '## Outcome meanings',
      '- **success**: questions + high-confidence answers found',
      '- **partial**: questions found, answers incomplete or low confidence',
      '- **empty**: page loaded, no quiz structure detected at all',
      '- **weak**: found something but confidence below threshold',
      '- **error**: exception or timeout during parsing',
      '- **reported**: user manually submitted as incorrect',
      '',
      '## Key analysis areas',
      '1. **problem_groups.json** — hosts with many failures → indicates platform-specific issues',
      '2. **top_failure_reasons.json** — most common reason strings → shows what the parser gives up on',
      '3. **selector_patterns.json** in failed events → which DOM selectors exist on failing pages',
      '4. **snapshot_htmlSnippet** in failed_events.jsonl → actual HTML the parser saw',
      '5. **snapshot_questionsData** — what the parser partially extracted before giving up',
      '6. **bug_reports.json** — user-confirmed bad results, best have questionText for ground truth',
      '7. Compare snapshot_selectorSummary between failed and success events for DOM pattern diffs',
      '',
      '## Stats at export time',
      `- Total events: ${events.length}`,
      `- Failed: ${failedEvents.length} (${events.length ? (failedEvents.length/events.length*100).toFixed(1) : 0}%)`,
      `- Success: ${successEvents.length}`,
      `- Bug reports: ${bugReports.length}`,
    ].join('\n');

    // ── Build ZIP ──────────────────────────────────────────────
    const summary = {
      exportedAt: new Date().toISOString(),
      period: { days, since: since.toISOString(), until: new Date().toISOString() },
      totals: {
        events: events.length, failed: failedEvents.length, success: successEvents.length,
        bugReports: bugReports.length, questions: questionNotes.length, extensionVersion: version || 'all',
        avgConfidence: confCount ? Number((totalConf/confCount).toFixed(4)) : 0,
        successRate: events.length ? (successEvents.length/events.length*100).toFixed(1)+'%' : '—',
      },
      byOutcome, platformSummary, dailyBreakdown,
    };

    const zipFiles = [
      { name: 'README.md',                   data: readme },
      { name: 'summary.json',                data: JSON.stringify(summary, null, 2) },
      { name: 'failed_events.jsonl',         data: failedEvents.map(e => JSON.stringify(serEvent(e, true))).join('\n') || '// no failed events' },
      { name: 'success_sample.jsonl',        data: successEvents.sort(() => Math.random()-.5).slice(0,100).map(e => JSON.stringify(serEvent(e, false))).join('\n') || '// no success events' },
      { name: 'bug_reports.json',            data: JSON.stringify(bugReports.map(serBug), null, 2) },
      { name: 'problem_groups.json',         data: JSON.stringify(problemGroups, null, 2) },
      { name: 'confidence_distribution.json',data: JSON.stringify(confBuckets, null, 2) },
      { name: 'top_failure_reasons.json',    data: JSON.stringify(topReasons, null, 2) },
      { name: 'selector_patterns.json',      data: JSON.stringify(topSelectors, null, 2) },
      { name: 'daily_breakdown.json',        data: JSON.stringify(dailyBreakdown, null, 2) },
      { name: 'questions.jsonl',             data: questionNotes.map(n => JSON.stringify({ id: n._id, extensionVersion: n.extensionVersion || '', userEmail: n.user?.email || 'unknown', questionType: n.questionType, questionText: n.questionText, options: n.options, prompts: n.prompts, rows: n.rows, answer: n.answer, explanation: n.explanation, sourceUrl: n.sourceUrl, platform: n.platform, createdAt: n.createdAt })).join('\n') || '// no questions' },
      { name: 'cached_answers_sample.json',  data: JSON.stringify(recentAnswers, null, 2) },
    ];

    const zipBuf  = buildZip(zipFiles);
    const fname   = `parser-analysis-${days}d-${new Date().toISOString().slice(0,10)}.zip`;

    res.setHeader('Content-Type',        'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Content-Length',      zipBuf.length);
    res.send(zipBuf);

  } catch (err) {
    console.error('[parser-zip]', err);
    res.status(500).json({ error: 'Failed to generate analysis ZIP', detail: err.message });
  }
});

module.exports = router;


