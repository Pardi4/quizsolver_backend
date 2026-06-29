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
  streak_asc: { 'streak.current': 1, createdAt: 1, _id: 1 }
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
    excludeFromLeaderboard: !!user.excludeFromLeaderboard,
    isExtensionActive,
    extensionLastSeenAt,
    extensionLastSeenReason: user.extensionLastSeenReason || '',
    extensionLastSeenUrl: user.extensionLastSeenUrl || '',
    extensionLastSeenPlatform: user.extensionLastSeenPlatform || '',
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
    createdAt: event.createdAt
  };
}

router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const adminUsers = await User.countDocuments({ role: 'admin' });
    const cachedAnswers = await CachedAnswer.countDocuments();
    const totalPurchases = await Purchase.countDocuments();
    const totalBugReports = await BugReport.countDocuments();
    const unreadBugReports = await BugReport.countDocuments({ $and: [{ isRead: false }, { isRead: { $exists: true } }] });
    const openSupportMessages = await SupportMessage.countDocuments({ status: { $ne: 'closed' } });
    const unreadSupportMessages = await SupportMessage.countDocuments({ isRead: false });

    const totalQuestionsAgg = await User.aggregate([{ $group: { _id: null, total: { $sum: '$stats.totalQuestionsSolved' } } }]);
    const totalQuestions = totalQuestionsAgg[0]?.total || 0;

    const totalCreditsAgg = await User.aggregate([{ $group: { _id: null, total: { $sum: '$credits' } } }]);
    const totalCreditsInSystem = totalCreditsAgg[0]?.total || 0;

    const revenueAgg = await Purchase.aggregate([{ $match: { paymentProvider: { $in: paidProviders } } }, { $group: { _id: null, total: { $sum: '$priceUsd' } } }]);
    const totalRevenue = revenueAgg[0]?.total || 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayPurchases = await Purchase.countDocuments({ createdAt: { $gte: today } });

    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthRevenueAgg = await Purchase.aggregate([
      { $match: { paymentProvider: { $in: paidProviders }, createdAt: { $gte: thisMonth } } },
      { $group: { _id: null, total: { $sum: '$priceUsd' } } }
    ]);
    const monthRevenue = monthRevenueAgg[0]?.total || 0;

    const bannedUsers = await User.countDocuments({ isBanned: true });

    const recentUsers = await User.find().sort({ createdAt: -1 }).limit(10).select('email displayName role credits stats createdAt isBanned');

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
    const users = await User.find(query).sort(USER_SORTS[sort]).skip((page - 1) * limit).limit(limit).select('email displayName role credits stats createdAt isBanned excludeFromLeaderboard streak extensionLastSeenAt extensionLastSeenReason extensionLastSeenUrl extensionLastSeenPlatform');
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

router.patch('/users/:userId/leaderboard', async (req, res) => {
  try {
    const { exclude } = req.body;
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    user.excludeFromLeaderboard = !!exclude;
    await user.save();
    auditLog(req.user, 'LEADERBOARD_TOGGLE', { target: user.email, exclude: !!exclude });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error updating leaderboard setting.' });
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
        parserDiagnostics: r.parserDiagnostics || {},
        parserSnapshot: r.parserSnapshot || {},
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

router.get('/parser/health', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const match = { createdAt: { $gte: since } };
    const failedOutcomes = ['empty', 'weak', 'error'];

    const [summaryAgg, platforms, problemGroups, recentEvents, recentBugReports] = await Promise.all([
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
      ParserEvent.find(match)
        .sort({ createdAt: -1 })
        .limit(30)
        .populate('userId', 'email')
        .lean(),
      BugReport.find({ createdAt: { $gte: since } })
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
      recentEvents: recentEvents.map(serializeParserEvent),
      recentBugReports: recentBugReports.map(report => ({
        id: report._id,
        user: report.userId?.email || 'Unknown user',
        url: report.url,
        platform: report.platform || '',
        parserDiagnostics: report.parserDiagnostics || {},
        parserSnapshot: report.parserSnapshot || {},
        isRead: report.isRead !== false,
        date: report.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching parser health.' });
  }
});

router.get('/parser/events', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const platform = String(req.query.platform || '').trim().substring(0, 80);
    const outcome = String(req.query.outcome || '').trim().substring(0, 40);
    const search = String(req.query.q || '').trim().substring(0, 120);
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
        .select('email displayName role credits stats streak isBanned excludeFromLeaderboard extensionLastSeenAt extensionLastSeenReason extensionLastSeenUrl extensionLastSeenPlatform createdAt')
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
    const message = await SupportMessage.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Support message not found.' });
    const text = String(req.body.text || '').trim().substring(0, 10000);
    if (!text) return res.status(400).json({ error: 'Reply text is required.' });
    const template = supportReplyTemplate({ message, replyText: text });
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
      text,
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
        repliedAt: message.repliedAt,
        replyPreviewHtml: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`
      }
    });
  } catch {
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
        .sort({ hitCount: -1, lastUsedAt: -1 })
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

router.get('/leaderboard', async (req, res) => {
  try {
    const users = await User.find({
      excludeFromLeaderboard: { $ne: true },
      isBanned: { $ne: true },
      role: { $ne: 'admin' }
    })
    .sort({ 'stats.totalQuestionsSolved': -1 })
    .limit(10)
    .select('email stats.totalQuestionsSolved stats.totalQuizzesSolved streak');

    const leaderboard = users.map((u, i) => ({
      rank: i + 1,
      name: u.getLeaderboardName(),
      questionsSolved: u.stats.totalQuestionsSolved,
      streak: u.streak.current
    }));

    res.json({ success: true, leaderboard });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching leaderboard.' });
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

module.exports = router;
