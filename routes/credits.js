const express = require('express');
const crypto = require('crypto');
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

function envFlag(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

function envDisabled(name) {
  return String(process.env[name] || '').toLowerCase() === 'false';
}

function looksPlaceholder(value) {
  return !value || /xxxx|placeholder|changeme|todo/i.test(String(value));
}

function realPaymentsEnabled() {
  return envFlag('REAL_PAYMENTS') || envFlag('WHOP_PAYMENTS');
}

function testPaymentsEnabled() {
  if (envFlag('DEMO_PAYMENTS') || envFlag('TEST_PAYMENTS')) return true;
  if (envDisabled('DEMO_PAYMENTS') || envDisabled('TEST_PAYMENTS')) return false;

  // Temporary default: keep the project in test checkout mode until real
  // payments are explicitly enabled on the VPS.
  return !realPaymentsEnabled();
}

function hasWhopConfig(packInfo) {
  return !looksPlaceholder(process.env.WHOP_API_KEY) && !looksPlaceholder(process.env[packInfo.planEnv]);
}

function testCheckoutUrl(req, pack, packInfo) {
  const siteUrl = (process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${siteUrl}/demo-checkout.html?pack=${pack}&credits=${packInfo.credits}&price=${packInfo.price}&userId=${req.user._id}&email=${encodeURIComponent(req.user.email)}`;
}

function testCheckoutResponse(req, pack, packInfo, reason = 'test') {
  return {
    success: true,
    checkoutUrl: testCheckoutUrl(req, pack, packInfo),
    pack: packInfo.id,
    credits: packInfo.credits,
    test: true,
    demo: true,
    reason
  };
}

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

    if (testPaymentsEnabled()) {
      return res.json(testCheckoutResponse(req, pack, packInfo, 'test-payments-enabled'));
    }

    const apiKey = process.env.WHOP_API_KEY;
    const planId = process.env[packInfo.planEnv];

    if (!hasWhopConfig(packInfo)) {
      console.warn('[Credits] Whop is not fully configured, using test checkout.');
      return res.json(testCheckoutResponse(req, pack, packInfo, 'whop-not-configured'));
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
      return res.json(testCheckoutResponse(req, pack, packInfo, 'whop-error'));
    }

    const data = await response.json();
    const checkoutUrl = data.url || data.checkout_url || data.data?.url || `https://whop.com/checkout/${planId}`;

    res.json({ success: true, checkoutUrl, pack: packInfo.id, credits: packInfo.credits });
  } catch (error) {
    console.error('[Credits] Buy error:', error.message);
    const packInfo = PACKS[req.body?.pack];
    if (packInfo) {
      return res.json(testCheckoutResponse(req, req.body.pack, packInfo, 'checkout-error'));
    }
    res.status(500).json({ error: 'Error creating checkout.' });
  }
});

router.post('/demo-complete', async (req, res) => {
  try {
    const { pack } = req.body || {};
    if (!pack || !PACKS[pack]) {
      return res.status(400).json({ error: 'Invalid credit top-up.' });
    }

    const packInfo = PACKS[pack];
    if (!testPaymentsEnabled() && hasWhopConfig(packInfo)) {
      return res.status(403).json({ error: 'Test payments are disabled.' });
    }

    const orderId = `demo_${req.user._id}_${pack}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    await Purchase.recordPurchase(req.user._id, packInfo.id, packInfo.credits, {
      priceUsd: packInfo.price,
      paymentProvider: 'demo',
      externalOrderId: orderId,
      grantReason: 'Temporary test checkout'
    });

    const freshUser = await User.findById(req.user._id).select('-__v');
    res.json({
      success: true,
      creditsAdded: packInfo.credits,
      pack: packInfo.id,
      orderId,
      user: freshUser?.toPublicJSON?.() || null
    });
  } catch (error) {
    console.error('[Credits] Demo checkout error:', error.message);
    res.status(500).json({ error: 'Error completing test payment.' });
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
