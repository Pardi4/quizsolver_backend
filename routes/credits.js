const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const Purchase = require('../models/Purchase');
const BugReport = require('../models/BugReport');
const User = require('../models/User');
const ParserEvent = require('../models/ParserEvent');
const { CREDIT_PACKS } = require('../config/creditPacks');

const router = express.Router();
router.use(authMiddleware);

const PACKS = CREDIT_PACKS;

function looksPlaceholder(value) {
  return !value || /xxxx|placeholder|changeme|todo/i.test(String(value));
}

function hasLemonSqueezyConfig(packInfo) {
  return !looksPlaceholder(process.env.LEMONSQUEEZY_API_KEY)
    && !looksPlaceholder(process.env.LEMONSQUEEZY_STORE_ID)
    && !looksPlaceholder(process.env[packInfo.lemonVariantEnv]);
}

function cleanText(value, max = 500) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, max);
}

function cleanHtml(value, max = 12000) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s(?:src|href)\s*=\s*(['"])(?!#|\/|\.\/).*?\1/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, max);
}

function cleanToken(value, max = 80) {
  return String(value || '').replace(/[^a-z0-9_.:-]/gi, '').substring(0, max);
}

function cleanArray(value, maxItems = 12, maxLength = 220) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => cleanText(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function cleanParserSnapshot(snapshot = {}) {
  const selectorSummary = snapshot && typeof snapshot.selectorSummary === 'object' && !Array.isArray(snapshot.selectorSummary)
    ? Object.fromEntries(Object.entries(snapshot.selectorSummary).slice(0, 30).map(([key, value]) => [
        cleanToken(key, 60),
        Number.isFinite(Number(value)) ? Number(value) : cleanText(value, 80)
      ]))
    : {};
  return {
    title: cleanText(snapshot.title, 180),
    bodyText: cleanText(snapshot.bodyText, 8000),
    htmlSnippet: cleanHtml(snapshot.htmlSnippet, 12000),
    questionTexts: cleanArray(snapshot.questionTexts, 8, 300),
    optionsSample: cleanArray(snapshot.optionsSample, 20, 180),
    selectorSummary
  };
}

function cleanParserDiagnostics(value = {}) {
  return {
    outcome: cleanToken(value.outcome || 'reported', 40),
    confidence: Math.min(Math.max(Number(value.confidence || 0), 0), 1),
    reason: cleanText(value.reason || '', 240),
    questionCount: Math.min(Math.max(parseInt(value.questionCount, 10) || 0, 0), 200),
    optionCount: Math.min(Math.max(parseInt(value.optionCount, 10) || 0, 0), 1000),
    attemptedTypes: cleanArray(value.attemptedTypes, 8, 80)
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

    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    const storeId = String(process.env.LEMONSQUEEZY_STORE_ID || '').trim();
    const variantId = String(process.env[packInfo.lemonVariantEnv] || '').trim();

    if (!hasLemonSqueezyConfig(packInfo)) {
      console.warn('[Credits] Lemon Squeezy is not fully configured.');
      return res.status(503).json({ error: 'Payments are not configured yet.' });
    }

    const successUrl = process.env.CHECKOUT_SUCCESS_URL || `${process.env.PUBLIC_SITE_URL || 'https://getquizsolver.com'}/success`;

    const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            product_options: {
              redirect_url: successUrl,
              receipt_button_text: 'Open QuizSolver',
              receipt_link_url: successUrl,
              receipt_thank_you_note: 'Thanks for your purchase. Your QuizSolver credits will be added to your account automatically.',
              enabled_variants: [Number(variantId)]
            },
            checkout_options: {
              embed: false,
              media: true,
              logo: true,
              desc: true,
              discount: true
            },
            checkout_data: {
              email: req.user.email,
              name: req.user.displayName || '',
              custom: {
                user_id: req.user._id.toString(),
                pack: packInfo.id,
                credits: String(packInfo.credits),
                email: req.user.email
              }
            }
          },
          relationships: {
            store: {
              data: {
                type: 'stores',
                id: storeId
              }
            },
            variant: {
              data: {
                type: 'variants',
                id: variantId
              }
            }
          }
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Credits] Lemon Squeezy error:', response.status, errText.substring(0, 300));
      return res.status(502).json({ error: 'Payment provider error. Try again later.' });
    }

    const data = await response.json();
    const checkoutUrl = data.data?.attributes?.url || data.url || data.checkout_url;
    if (!checkoutUrl) {
      console.error('[Credits] Lemon Squeezy checkout response missing URL.');
      return res.status(502).json({ error: 'Payment provider error. Try again later.' });
    }

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
    const platform = cleanToken(req.body.platform || '', 80);
    const parserSnapshot = cleanParserSnapshot(req.body.parserSnapshot || {});
    const parserDiagnostics = cleanParserDiagnostics(req.body.parserDiagnostics || {});
    let hostname = '';

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required.' });
    }

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'Invalid URL protocol.' });
      }
      url = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
      hostname = parsed.hostname.substring(0, 180);
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
      platform,
      parserDiagnostics,
      parserSnapshot,
      userAgent: (req.headers['user-agent'] || '').substring(0, 300)
    });

    ParserEvent.create({
      userId: req.user._id,
      eventType: 'manual-report',
      outcome: 'reported',
      platform: platform || 'universal',
      detectorPlatform: platform || '',
      url: url.substring(0, 500),
      hostname,
      confidence: parserDiagnostics.confidence || 0,
      reason: parserDiagnostics.reason || description || 'Manual user report',
      questionCount: parserDiagnostics.questionCount || 0,
      optionCount: parserDiagnostics.optionCount || 0,
      attemptedTypes: parserDiagnostics.attemptedTypes || [],
      parserVersion: 'v2',
      snapshot: parserSnapshot
    }).catch(error => console.warn('[ParserEvent] Could not record bug report event:', error.message));

    res.json({ success: true, message: 'Bug report submitted. Thank you!' });
  } catch (error) {
    res.status(500).json({ error: 'Error submitting report.' });
  }
});

module.exports = router;
