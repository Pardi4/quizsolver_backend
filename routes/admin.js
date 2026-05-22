const express = require('express');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const User = require('../models/User');
const CachedAnswer = require('../models/CachedAnswer');
const Purchase = require('../models/Purchase');
const BugReport = require('../models/BugReport');
const SupportMessage = require('../models/SupportMessage');
const { sendEmail, supportReplyTemplate, SUPPORT_EMAIL, escapeHtml } = require('../services/emailService');

const router = express.Router();

router.use(authMiddleware);
router.use(adminOnly);

function auditLog(adminUser, action, details = {}) {
  console.log(`[AUDIT] ${JSON.stringify({ ts: new Date().toISOString(), admin: adminUser.email, action, ...details })}`);
}

router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const adminUsers = await User.countDocuments({ role: 'admin' });
    const cachedAnswers = await CachedAnswer.countDocuments();
    const totalPurchases = await Purchase.countDocuments();
    const totalBugReports = await BugReport.countDocuments();
    const openSupportMessages = await SupportMessage.countDocuments({ status: { $ne: 'closed' } });

    const totalQuestionsAgg = await User.aggregate([{ $group: { _id: null, total: { $sum: '$stats.totalQuestionsSolved' } } }]);
    const totalQuestions = totalQuestionsAgg[0]?.total || 0;

    const totalCreditsAgg = await User.aggregate([{ $group: { _id: null, total: { $sum: '$credits' } } }]);
    const totalCreditsInSystem = totalCreditsAgg[0]?.total || 0;

    const revenueAgg = await Purchase.aggregate([{ $match: { paymentProvider: 'whop' } }, { $group: { _id: null, total: { $sum: '$priceUsd' } } }]);
    const totalRevenue = revenueAgg[0]?.total || 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayPurchases = await Purchase.countDocuments({ createdAt: { $gte: today } });

    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthRevenueAgg = await Purchase.aggregate([
      { $match: { paymentProvider: 'whop', createdAt: { $gte: thisMonth } } },
      { $group: { _id: null, total: { $sum: '$priceUsd' } } }
    ]);
    const monthRevenue = monthRevenueAgg[0]?.total || 0;

    const bannedUsers = await User.countDocuments({ isBanned: true });

    const recentUsers = await User.find().sort({ createdAt: -1 }).limit(10).select('email displayName role credits stats createdAt isBanned');

    res.json({
      success: true,
      stats: {
        totalUsers, adminUsers, cachedAnswers, totalPurchases,
        totalBugReports, totalQuestions, totalCreditsInSystem,
        totalRevenue, todayPurchases, monthRevenue, bannedUsers,
        openSupportMessages
      },
      recentUsers: recentUsers.map(u => u.toPublicJSON())
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching stats.' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const search = (req.query.search || '').substring(0, 100);
    const query = search ? { $or: [
      { email: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { displayName: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
    ]} : {};
    const users = await User.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('email displayName role credits stats createdAt isBanned excludeFromLeaderboard streak');
    const total = await User.countDocuments(query);
    res.json({
      success: true,
      users: users.map(u => ({
        ...u.toPublicJSON(),
        isBanned: u.isBanned,
        excludeFromLeaderboard: u.excludeFromLeaderboard
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching users.' });
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
        reason: p.grantReason
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching purchases.' });
  }
});

router.get('/bug-reports', async (req, res) => {
  try {
    const reports = await BugReport.find().sort({ createdAt: -1 }).limit(100).populate('userId', 'email');
    res.json({
      success: true,
      reports: reports.map(r => ({
        id: r._id, user: r.userId?.email, url: r.url,
        description: r.description, date: r.createdAt
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching bug reports.' });
  }
});

router.get('/support/messages', async (req, res) => {
  try {
    const status = String(req.query.status || '').substring(0, 20);
    const query = status && ['open', 'pending', 'closed'].includes(status) ? { status } : {};
    const messages = await SupportMessage.find(query)
      .sort({ receivedAt: -1 })
      .limit(150)
      .populate('replies.adminUser', 'email displayName')
      .lean();
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
        source: m.source,
        status: m.status,
        isRead: m.isRead,
        receivedAt: m.receivedAt,
        repliedAt: m.repliedAt,
        replies: (m.replies || []).map(r => ({
          id: r._id,
          admin: r.adminUser?.displayName || r.adminUser?.email || 'Admin',
          fromEmail: r.fromEmail,
          toEmail: r.toEmail,
          subject: r.subject,
          text: r.text,
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
    const totalCached = await CachedAnswer.countDocuments();
    const topHits = await CachedAnswer.find().sort({ hitCount: -1 }).limit(10).select('questionText questionType hitCount createdAt lastUsedAt');
    res.json({ success: true, totalCached, topHits });
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
