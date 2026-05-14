const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const Purchase = require('../models/Purchase');
const BugReport = require('../models/BugReport');
const User = require('../models/User');

const router = express.Router();
router.use(authMiddleware);

const PACKS = {
  starter: { id: 'starter', name: '100 Credits', credits: 100, price: 1.99, planEnv: 'WHOP_PLAN_100' },
  popular: { id: 'popular', name: '500 Credits', credits: 500, price: 4.99, planEnv: 'WHOP_PLAN_500' },
  pro:     { id: 'pro',     name: '2000 Credits', credits: 2000, price: 9.99, planEnv: 'WHOP_PLAN_2000' }
};

router.get('/packs', (req, res) => {
  res.json({
    success: true,
    packs: Object.values(PACKS).map(p => ({
      id: p.id,
      name: p.name,
      credits: p.credits,
      price: p.price,
      currency: 'USD'
    }))
  });
});

router.get('/balance', async (req, res) => {
  try {
    req.user.resetFreeCreditsIfNeeded();
    await req.user.save();

    res.json({
      success: true,
      credits: req.user.role === 'admin' ? Infinity : req.user.credits,
      isAdmin: req.user.role === 'admin'
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching balance.' });
  }
});

router.post('/buy', async (req, res) => {
  try {
    const { pack } = req.body;

    if (!pack || !PACKS[pack]) {
      return res.status(400).json({ error: 'Invalid credit top-up.' });
    }

    const packInfo = PACKS[pack];
    const apiKey = process.env.WHOP_API_KEY;
    const planId = process.env[packInfo.planEnv];

    if (!apiKey || !planId || planId.includes('XXXXXXX')) {
      return res.status(503).json({ error: 'Payment not configured. Contact admin.' });
    }

    const response = await fetch('https://api.whop.com/api/v1/checkout_configurations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan_id: planId,
        metadata: {
          user_id: req.user._id.toString(),
          pack: pack,
          credits: packInfo.credits.toString(),
          email: req.user.email
        },
        redirect_url: process.env.CHECKOUT_SUCCESS_URL || 'https://quizsolver.us/success',
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Credits] Whop error:', response.status, errText.substring(0, 300));

      const checkoutUrl = `https://whop.com/quizsolver/?utm_source=app&pack=${pack}&email=${encodeURIComponent(req.user.email)}`;
      return res.json({ success: true, checkoutUrl, pack: packInfo.id, credits: packInfo.credits, fallback: true });
    }

    const data = await response.json();
    const checkoutUrl = data.url || data.checkout_url || data.data?.url || `https://whop.com/checkout/${planId}`;

    res.json({ success: true, checkoutUrl, pack: packInfo.id, credits: packInfo.credits });
  } catch (error) {
    console.error('[Credits] Buy error:', error.message);
    res.status(500).json({ error: 'Error creating checkout.' });
  }
});

router.get('/history', async (req, res) => {
  try {
    const purchases = await Purchase.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('pack credits priceUsd paymentProvider createdAt');

    res.json({ success: true, purchases });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching history.' });
  }
});

router.get('/referrals', async (req, res) => {
  try {
    const [referredUsers, referralPurchases, referralBonusAgg] = await Promise.all([
      User.countDocuments({ referredBy: req.user._id }),
      Purchase.countDocuments({
        userId: req.user._id,
        pack: 'referral_bonus',
        paymentProvider: 'referral'
      }),
      Purchase.aggregate([
        {
          $match: {
            userId: req.user._id,
            pack: 'referral_bonus',
            paymentProvider: 'referral'
          }
        },
        { $group: { _id: null, credits: { $sum: '$credits' } } }
      ])
    ]);

    const siteUrl = (process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const referralCode = req.user.referralCode || '';

    res.json({
      success: true,
      referralCode,
      referralLink: referralCode ? `${siteUrl}/?ref=${encodeURIComponent(referralCode)}` : '',
      referredUsers,
      referralPurchases,
      referralCredits: referralBonusAgg[0]?.credits || 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching referral stats.' });
  }
});

router.post('/report-bug', async (req, res) => {
  try {
    let { url, description } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required.' });
    }

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'Invalid URL protocol.' });
      }
      url = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
    } catch {
      return res.status(400).json({ error: 'Invalid URL format.' });
    }

    if (description) {
      description = String(description)
        .substring(0, 1000)
        .replace(/<[^>]*>/g, '')
        .trim();
    }

    await BugReport.create({
      userId: req.user._id,
      url: url.substring(0, 500),
      description: description || '',
      userAgent: (req.headers['user-agent'] || '').substring(0, 300)
    });

    res.json({ success: true, message: 'Bug report submitted. Thank you!' });
  } catch (error) {
    res.status(500).json({ error: 'Error submitting report.' });
  }
});

module.exports = router;
