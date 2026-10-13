const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const Purchase = require('../models/Purchase');
const CheckoutStart = require('../models/CheckoutStart');
const BugReport = require('../models/BugReport');
const User = require('../models/User');
const CreditUsage = require('../models/CreditUsage');
const ParserEvent = require('../models/ParserEvent');
const { CREDIT_PACKS } = require('../config/creditPacks');
const { storeParserSnapshotHtml } = require('../utils/parserSnapshotFiles');
const dpayService = require('../services/dpayService');
const promoService = require('../services/promoService');

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

function hasDpayConfig() {
  return dpayService.isConfigured();
}

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?![a-zA-Z-]+$)[A-Za-z0-9_-]{32,})\b/g, '[token]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[number]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]');
}

function cleanText(value, max = 500) {
  return redactSensitiveText(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, max);
}

function cleanHtml(value, max = 12000) {
  return redactSensitiveText(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s(value|data-token|data-auth|data-key|data-secret|data-email|data-user|data-password|aria-valuetext)\s*=\s*(['"]).*?\2/gi, ' $1="[redacted]"')
    .replace(/\s(?:src|href)\s*=\s*(['"])(?!#|\/|\.\/).*?\1/gi, '')
  )
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
    selectorSummary,
    questionsData: Array.isArray(snapshot.questionsData) ? snapshot.questionsData.map(q => ({
      text: cleanText(q.text, 2000),
      options: cleanArray(q.options, 20, 1000),
      type: cleanToken(q.type, 40),
      imageUrl: cleanToken(q.imageUrl, 500),
      imageAlt: cleanText(q.imageAlt, 500),
      aiAnswer: q.aiAnswer,
      containerHtml: cleanHtml(q.containerHtml, 40000)
    })).slice(0, 100) : [],
    fullHtmlFile: snapshot.fullHtmlFile && typeof snapshot.fullHtmlFile === 'object' ? {
      id: cleanToken(snapshot.fullHtmlFile.id || '', 100),
      filename: cleanText(snapshot.fullHtmlFile.filename || '', 140),
      bytes: Math.max(0, Number(snapshot.fullHtmlFile.bytes || 0)),
      sha256: cleanToken(snapshot.fullHtmlFile.sha256 || '', 80),
      truncated: Boolean(snapshot.fullHtmlFile.truncated),
      capturedAt: snapshot.fullHtmlFile.capturedAt || null
    } : undefined
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

router.post('/validate-promo', async (req, res) => {
  try {
    const { code, pack = 'popular' } = req.body;
    if (!code) {
      return res.status(400).json({ valid: false, error: 'Wpisz kod rabatowy.' });
    }

    const promoResult = await promoService.validatePromoCode(code, req.user, pack);
    if (!promoResult.valid) {
      return res.status(400).json({
        valid: false,
        error: promoResult.message || 'Nieprawidłowy lub wygasły kod rabatowy.'
      });
    }

    const packId = PACKS[pack]?.id || pack;
    const discountPercent = promoResult.discountPercent;
    const basePricePln = promoService.BASE_PLN_PRICES[packId] || 14.99;
    const finalPricePln = promoService.calculatePlnPrice(packId, discountPercent);
    const savingsPln = Math.round((basePricePln - finalPricePln) * 100) / 100;

    const basePriceUsd = promoService.BASE_USD_PRICES[packId] || 4.99;
    const finalPriceUsd = promoService.calculateUsdPrice(packId, discountPercent);
    const savingsUsd = Math.round((basePriceUsd - finalPriceUsd) * 100) / 100;

    return res.json({
      success: true,
      valid: true,
      code: promoResult.code,
      discountPercent,
      description: promoResult.description,
      packId,
      prices: {
        pln: {
          base: basePricePln,
          baseFormatted: `${basePricePln.toFixed(2).replace('.', ',')} zł`,
          final: finalPricePln,
          finalFormatted: `${finalPricePln.toFixed(2).replace('.', ',')} zł`,
          savings: savingsPln,
          savingsFormatted: `${savingsPln.toFixed(2).replace('.', ',')} zł`
        },
        usd: {
          base: basePriceUsd,
          baseFormatted: `$${basePriceUsd.toFixed(2)}`,
          final: finalPriceUsd,
          finalFormatted: `$${finalPriceUsd.toFixed(2)}`,
          savings: savingsUsd,
          savingsFormatted: `$${savingsUsd.toFixed(2)}`
        }
      },
      message: `Kod rabatowy ${promoResult.code} (-${discountPercent}%) naliczony!`
    });
  } catch (err) {
    console.error('[Credits] validate-promo error:', err.message);
    res.status(500).json({ valid: false, error: 'Błąd weryfikacji kodu rabatowego.' });
  }
});

router.post('/buy', async (req, res) => {
  try {
    const { pack, discountCode, provider = 'lemonsqueezy' } = req.body;

    if (!pack || !PACKS[pack]) {
      return res.status(400).json({ error: 'Invalid credit top-up.' });
    }

    const packInfo = PACKS[pack];

    // Validate discount code if provided
    let validDiscountCode = null;
    let validDiscountPercent = 0;

    if (discountCode) {
      const promoValidation = await promoService.validatePromoCode(discountCode, req.user, packInfo.id);
      if (promoValidation.valid) {
        validDiscountCode = promoValidation.code;
        validDiscountPercent = promoValidation.discountPercent;
      } else {
        return res.status(400).json({ error: promoValidation.message || 'Nieprawidłowy kod rabatowy.' });
      }
    }

    if (provider === 'dpay') {
      if (!hasDpayConfig()) {
        return res.status(503).json({
          error: 'Bramka DPay (BLIK / szybki przelew) jest w trakcie aktywacji przez operatora. Wybierz Lemon Squeezy (Karta / Apple Pay / Google Pay) lub skontaktuj się z nami na support@getquizsolver.com.'
        });
      }

      const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://getquizsolver.com').replace(/\/+$/, '');
      const successUrl = process.env.CHECKOUT_SUCCESS_URL || `${siteUrl}/pl/success?provider=dpay`;
      const failUrl = `${siteUrl}/pl/credits?status=cancelled`;

      const paymentResult = await dpayService.createPayment({
        user: req.user,
        pack: packInfo,
        discountCode: validDiscountCode,
        discountPercent: validDiscountPercent,
        successUrl,
        failUrl
      });

      if (!paymentResult.success || !paymentResult.checkoutUrl) {
        console.error('[Credits] dPay error:', paymentResult.error);
        return res.status(502).json({
          error: paymentResult.error || 'Nie udało się połączyć z bramką DPay. Spróbuj ponownie za chwilę.'
        });
      }

      // Pre-record pending purchase so user is 100% guaranteed to be credited even if email differs on dpay
      if (paymentResult.transactionId) {
        await Purchase.create({
          userId: req.user._id,
          pack: packInfo.id,
          credits: packInfo.credits,
          priceUsd: paymentResult.amount ? (parseFloat(paymentResult.amount) / 4.0) : packInfo.price,
          currency: 'PLN',
          paymentProvider: 'dpay',
          externalOrderId: `dpay:${paymentResult.transactionId}`,
          discountCode: validDiscountCode,
          discountPercent: validDiscountPercent,
          creditsApplied: false
        }).catch((err) => {
          console.warn('[Credits] Pending purchase pre-record notice:', err.message);
        });
      }

      // Funnel tracking (fire and forget - must never block the checkout)
      CheckoutStart.create({ user: req.user._id, pack: packInfo.id, credits: packInfo.credits })
        .catch((e) => console.error('[Credits] CheckoutStart log failed:', e.message));

      return res.json({
        success: true,
        checkoutUrl: paymentResult.checkoutUrl,
        transactionId: paymentResult.transactionId,
        provider: 'dpay',
        pack: packInfo.id,
        credits: packInfo.credits
      });
    }

    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    const storeId = String(process.env.LEMONSQUEEZY_STORE_ID || '').trim();
    const variantId = String(process.env[packInfo.lemonVariantEnv] || '').trim();

    if (!hasLemonSqueezyConfig(packInfo)) {
      console.warn('[Credits] Lemon Squeezy is not fully configured.');
      return res.status(503).json({ error: 'Payments are not configured yet.' });
    }

    const successUrl = process.env.CHECKOUT_SUCCESS_URL || `${process.env.PUBLIC_SITE_URL || 'https://getquizsolver.com'}/success`;

    const codeToSend = validDiscountCode || (discountCode ? String(discountCode).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') : '');

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
              name: req.user.displayName || req.user.email.split('@')[0],
              ...(codeToSend ? { discount_code: codeToSend } : {}),
              custom: {
                user_id: req.user._id.toString(),
                pack: packInfo.id,
                credits: String(packInfo.credits),
                email: req.user.email,
                ...(codeToSend ? { discount_code: codeToSend } : {})
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

    // Funnel tracking (fire and forget - must never block the checkout)
    CheckoutStart.create({ user: req.user._id, pack: packInfo.id, credits: packInfo.credits })
      .catch((e) => console.error('[Credits] CheckoutStart log failed:', e.message));

    res.json({ success: true, checkoutUrl, pack: packInfo.id, credits: packInfo.credits });
  } catch (error) {
    console.error('[Credits] Buy error:', error.message);
    res.status(500).json({ error: 'Error creating checkout.' });
  }
});

const ACTION_LABELS = {
  'solve': { pl: 'Rozwiązanie pytania (AI)', en: 'AI Question Solve' },
  'solve-snapshot': { pl: 'Skan FocusScan (OCR)', en: 'FocusScan OCR Solve' },
  'solve-batch': { pl: 'Pakiet pytań (AI)', en: 'Batch Solve' },
  'explain': { pl: 'Wyjaśnienie pytania (AI)', en: 'AI Explanation' },
  'follow-up': { pl: 'Pytanie dopytujące (AI)', en: 'Follow-up Query' }
};

router.get('/history', async (req, res) => {
  try {
    const [purchases, rawUsages] = await Promise.all([
      Purchase.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .limit(50)
        .select('pack credits priceUsd paymentProvider createdAt creditsApplied creditsAppliedAt'),
      CreditUsage.find({
        user: req.user._id,
        status: { $in: ['charged', 'waived'] }
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .select('action credits status creditType wasPaid afterPurchase balanceAfter chargedAt createdAt')
    ]);

    const earliestPurchaseTime = purchases.length > 0
      ? purchases.reduce((min, p) => {
          const t = p.createdAt ? new Date(p.createdAt).getTime() : Infinity;
          return t < min ? t : min;
        }, Infinity)
      : Infinity;

    const usages = rawUsages.map(u => {
      const uTime = u.createdAt ? new Date(u.createdAt).getTime() : 0;
      const isAfterPurchase = Boolean(u.afterPurchase || (earliestPurchaseTime !== Infinity && uTime >= earliestPurchaseTime));
      const isPaid = Boolean(u.wasPaid || (isAfterPurchase && u.status === 'charged'));
      const actionName = ACTION_LABELS[u.action] || { pl: u.action, en: u.action };

      return {
        id: u._id,
        action: u.action,
        actionLabelPl: actionName.pl,
        actionLabelEn: actionName.en,
        credits: u.credits || 1,
        status: u.status,
        creditType: isPaid ? 'paid' : (u.status === 'waived' ? 'waived' : 'free'),
        wasPaid: isPaid,
        afterPurchase: isAfterPurchase,
        balanceAfter: u.balanceAfter,
        date: u.chargedAt || u.createdAt
      };
    });

    res.json({
      success: true,
      purchases,
      usages,
      paidCreditsRemaining: req.user.paidCredits || 0,
      freeCreditsRemaining: Math.max(0, (req.user.credits || 0) - (req.user.paidCredits || 0)),
      hasPurchasedCredits: purchases.length > 0
    });
  } catch (error) {
    console.error('[Credits] Error fetching history:', error);
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
    const rawParserSnapshot = req.body.parserSnapshot || {};
    const parserSnapshot = cleanParserSnapshot(rawParserSnapshot);
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

    const fullHtmlFile = await storeParserSnapshotHtml({
      html: rawParserSnapshot.fullPageHtml || rawParserSnapshot.fullBodyHtml || '',
      url,
      platform,
      source: 'manual-report',
      outcome: parserDiagnostics.outcome || 'reported',
      userId: req.user._id
    });
    if (fullHtmlFile) parserSnapshot.fullHtmlFile = fullHtmlFile;

    if (description) {
      description = String(description)
        .substring(0, 1000)
        .replace(/<[^>]*>/g, '')
        .trim();
    }

    await BugReport.create({
      userId: req.user._id,
      url: url.substring(0, 500),
      extensionVersion: req.user.extensionVersion || req.body.version || '',
      description: description || '',
      platform,
      source: 'manual',
      parserDiagnostics,
      parserSnapshot,
      userAgent: (req.headers['user-agent'] || '').substring(0, 300)
    });

    // Intentional fire-and-forget: non-critical event logging
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
