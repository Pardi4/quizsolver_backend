const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { webhookLimiter } = require('../middleware/rateLimiter');
const Purchase = require('../models/Purchase');
const User = require('../models/User');
const { packFromLemonVariantId, CREDIT_PACKS } = require('../config/creditPacks');
const dpayService = require('../services/dpayService');
const promoService = require('../services/promoService');

const router = express.Router();

router.use(express.raw({ type: 'application/json', limit: '100kb' }));
router.use(express.urlencoded({ extended: true, limit: '100kb' }));
router.use(webhookLimiter);

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyLemonSignature(rawBody, signature, secret) {
  if (!secret || !signature || !rawBody) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqualHex(digest, signature);
}

function parseJsonBody(rawBody) {
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
}

function centsToUsd(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount > 0 ? amount / 100 : 0;
}

function eventName(payload) {
  return payload?.meta?.event_name || payload?.event_name || payload?.type || '';
}

function customData(payload) {
  return payload?.meta?.custom_data
    || payload?.data?.attributes?.custom_data
    || payload?.data?.attributes?.checkout_data?.custom
    || {};
}

function orderAttributes(payload) {
  return payload?.data?.attributes || {};
}

function orderId(payload) {
  return payload?.data?.id || orderAttributes(payload).order_id || orderAttributes(payload).identifier || '';
}

function orderVariantId(attributes) {
  return attributes.first_order_item?.variant_id
    || attributes.variant_id
    || attributes.product_variant_id
    || attributes.order_item?.variant_id
    || '';
}

function orderEmail(attributes, custom) {
  return String(
    custom.email
    || attributes.user_email
    || attributes.customer_email
    || attributes.email
    || ''
  ).trim().toLowerCase();
}

function orderTotalUsd(attributes, packInfo) {
  return centsToUsd(attributes.total_usd)
    || centsToUsd(attributes.subtotal_usd)
    || centsToUsd(attributes.total)
    || packInfo?.price
    || 0;
}

function orderDiscountCode(payload) {
  const custom = customData(payload);
  const attributes = orderAttributes(payload);
  return String(
    custom.discount_code ||
    attributes.discount_code ||
    attributes.first_order_item?.discount_name ||
    ''
  ).trim().toUpperCase();
}

function resolvePack(payload) {
  const attributes = orderAttributes(payload);
  const custom = customData(payload);

  // 1. Always prioritize the actual product variant purchased
  const byVariant = packFromLemonVariantId(orderVariantId(attributes));
  if (byVariant) return byVariant;

  // 2. Fallback to amount paid (October 2026 prices)
  const amountUsd = orderTotalUsd(attributes, null);
  if (amountUsd >= 14) return { id: 'pro',     credits: 2000, price: 14.99 };
  if (amountUsd >= 6)  return { id: 'popular', credits: 500,  price: 6.99 };
  if (amountUsd >= 2)  return { id: 'starter', credits: 100,  price: 2.99 };

  // 3. Only if no price and no variant (e.g. manual admin invoice), trust custom data safely
  const customPack = String(custom.pack || '').trim();
  const customCredits = parseInt(custom.credits, 10);
  if (customPack && Number.isFinite(customCredits) && customCredits > 0 && amountUsd >= (customCredits * 0.001)) {
    return { id: customPack, credits: customCredits, price: amountUsd };
  }

  return null;
}

async function findTargetUser(payload) {
  const custom = customData(payload);
  const attributes = orderAttributes(payload);

  if (custom.user_id) {
    const user = await User.findById(custom.user_id);
    if (user) return user;
  }

  const email = orderEmail(attributes, custom);
  return email ? User.findOne({ email }) : null;
}

async function grantReferralBonus(targetUser, credits, sourceOrderId = '') {
  if (!targetUser.referredBy) return;

  const referrer = await User.findById(targetUser.referredBy);
  if (!referrer) return;

  const bonus = Math.max(1, Math.floor(credits * 0.10));
  const referralSource = sourceOrderId ? String(sourceOrderId) : `user:${targetUser._id}`;
  await Purchase.recordPurchase(referrer._id, 'referral_bonus', bonus, {
    priceUsd: 0,
    paymentProvider: 'referral',
    externalOrderId: `referral:${referrer._id}:${referralSource}`,
    grantReason: `Referral bonus (10%) from ${targetUser.email}`
  });
  console.log(`[Webhook] Referral 10% bonus: +${bonus} credits to ${referrer.email}`);
}

router.post('/lemonsqueezy', async (req, res) => {
  const rawBody = req.body;
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  const signature = req.headers['x-signature'] || '';

  try {
    if (!secret) {
      console.error('[LemonSqueezy] LEMONSQUEEZY_WEBHOOK_SECRET is not configured.');
      return res.status(500).json({ error: 'Webhook configuration error.' });
    }

    if (!verifyLemonSignature(rawBody, signature, secret)) {
      console.warn('[LemonSqueezy] Invalid or missing webhook signature.');
      return res.status(400).json({ error: 'Invalid signature.' });
    }

    const payload = parseJsonBody(rawBody);
    if (!payload) return res.status(400).json({ error: 'Invalid JSON.' });

    const action = eventName(payload);
    const attributes = orderAttributes(payload);
    const lemonOrderId = orderId(payload);
    const externalOrderId = lemonOrderId ? `lemonsqueezy:${lemonOrderId}` : '';

    console.log(`[LemonSqueezy] Event: ${action}${externalOrderId ? ` (${externalOrderId})` : ''}`);

    if (action === 'order_refunded' || action === 'order_chargebacked') {
      if (externalOrderId) {
        const existingPurchase = await Purchase.findOne({ externalOrderId });
        if (existingPurchase && existingPurchase.creditsApplied) {
          await Purchase.revokeCredits(existingPurchase);
          console.log(`[LemonSqueezy] Revoked ${existingPurchase.credits} credits for refunded/chargebacked order: ${externalOrderId}`);
        } else {
          console.log(`[LemonSqueezy] Refund ignored - purchase not found or already revoked: ${externalOrderId}`);
        }
      }
      return res.status(200).json({ received: true, action: 'revoked' });
    }

    if (action !== 'order_created') {
      return res.status(200).json({ received: true, ignored: true });
    }

    if (externalOrderId) {
      const existingPurchase = await Purchase.findOne({ externalOrderId });
      if (existingPurchase) {
        if (existingPurchase.creditsApplied === false) {
          await Purchase.recordPurchase(existingPurchase.userId, existingPurchase.pack, existingPurchase.credits, {
            priceUsd: existingPurchase.priceUsd,
            paymentProvider: existingPurchase.paymentProvider,
            externalOrderId
          });
          console.log(`[LemonSqueezy] Duplicate recovered unapplied credits: ${externalOrderId}`);
          return res.status(200).json({ received: true, duplicate: true, recovered: true });
        }
        console.log(`[LemonSqueezy] Duplicate ignored: ${externalOrderId}`);
        return res.status(200).json({ received: true, duplicate: true });
      }
    }

    const packInfo = resolvePack(payload);
    if (!packInfo?.credits || !packInfo.id) {
      console.warn('[LemonSqueezy] Cannot determine credit pack from order.');
      return res.status(200).json({ received: true, ignored: true });
    }

    const targetUser = await findTargetUser(payload);
    if (!targetUser) {
      console.error('[LemonSqueezy] User not found for completed order.');
      return res.status(200).json({ received: true, ignored: true });
    }

    const discountCode = orderDiscountCode(payload);
    const purchase = await Purchase.recordPurchase(targetUser._id, packInfo.id, packInfo.credits, {
      priceUsd: orderTotalUsd(attributes, packInfo),
      paymentProvider: 'lemonsqueezy',
      externalOrderId,
      discountCode: discountCode || null
    });

    if (discountCode) {
      await promoService.markPromoUsed(discountCode, 'lemonsqueezy');
      console.log(`[LemonSqueezy] Counted promo code redemption: ${discountCode}`);
    }

    await grantReferralBonus(targetUser, packInfo.credits, externalOrderId || purchase._id);

    console.log(`[LemonSqueezy] +${packInfo.credits} credits for ${targetUser.email}`);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[LemonSqueezy] Error:', error.message);
    return res.status(200).json({ received: true });
  }
});

router.post('/dpay', async (req, res) => {
  try {
    let payload = req.body;
    if (Buffer.isBuffer(payload)) {
      payload = parseJsonBody(payload) || {};
    }
    const nestedData = (payload && payload.data && typeof payload.data === 'object') ? payload.data : {};
    const data = { ...req.query, ...nestedData, ...payload };
    const transactionId = String(data.id || data.transaction_id || data.payment_id || nestedData.id || nestedData.transaction_id || '').trim();
    const eventType = String(payload.event || payload.type || '').toLowerCase();
    const status = String(data.status || nestedData.status || (eventType === 'payment.succeeded' ? 'SUCCESS' : '')).toUpperCase();
    const custom = String(data.custom || nestedData.custom || '').trim();
    const rawAmount = data.amount || data.value || nestedData.amount || nestedData.value || 0;
    const amountPln = parseFloat(rawAmount) || 0;

    console.log(`[DPay IPN] Webhook received: id=${transactionId}, amount=${amountPln}, type=${data.type || eventType || 'transfer'}, custom=${custom}`);

    // DPay must be configured to process webhooks
    if (!dpayService.isConfigured()) {
      console.warn('[DPay IPN] REJECTED: DPay is not configured in environment.');
      return res.status(200).send('OK');
    }

    const sigHeader = req.headers['webhook-signature'] || req.headers['x-dpay-signature'] || req.headers['dpay-signature'] || req.headers['signature'];
    let isValid = false;

    // 1. Try HMAC signature if header and DPAY_WEBHOOK_SECRET are present
    if ((sigHeader || req.headers['webhook-id']) && process.env.DPAY_WEBHOOK_SECRET) {
      isValid = dpayService.verifyHmacWebhook(req.rawBody || req.body, req.headers);
      if (isValid) {
        console.log('[DPay IPN] Verified via HMAC webhook signature header.');
      }
    }

    // 2. Try official dPay IPN signature formula with Klucz Hash
    if (!isValid) {
      isValid = dpayService.verifyIpnSignature(data);
    }

    // 3. Fallback check: verify directly with dPay API in case of signature anomaly
    if (!isValid) {
      let verifiedViaApi = false;
      if (transactionId) {
        try {
          const details = await dpayService.getTransactionDetails(transactionId);
          if (details && (details.status === true || String(details.status).toUpperCase() === 'PAID' || String(details.status).toUpperCase() === 'SUCCESS')) {
            verifiedViaApi = true;
            console.log(`[DPay IPN] Verified transaction ${transactionId} via dPay status API fallback.`);
          }
        } catch (apiErr) {
          console.warn('[DPay IPN] Status API fallback failed:', apiErr.message);
        }
      }

      if (!verifiedViaApi) {
        console.warn(`[DPay IPN] REJECTED: Invalid signature for transaction ${transactionId}. Received signature: ${data.signature || data.checksum || sigHeader}`);
        // Return 200 'OK' per dPay docs so it doesn't repeatedly retry, but do NOT credit user!
        return res.status(200).send('OK');
      }
    }

    // IPN is only sent on success, but guard against explicit failures if present
    if (status && !['OK', 'SUCCESS', 'TRUE', '1', 'PAID'].includes(status)) {
      console.log(`[DPay IPN] Ignored non-success status: ${status}`);
      return res.status(200).send('OK');
    }

    const externalOrderId = transactionId ? `dpay:${transactionId}` : '';

    // 1. First priority: Check if we have a pre-recorded pending purchase for this transactionId
    if (externalOrderId) {
      const existing = await Purchase.findOne({ externalOrderId });
      if (existing) {
        if (existing.creditsApplied === false) {
          await Purchase.applyCredits(existing);
          if (existing.discountCode) {
            await promoService.markPromoUsed(existing.discountCode, 'dpay');
            console.log(`[DPay IPN] Counted promo code redemption: ${existing.discountCode}`);
          }
          console.log(`[DPay IPN] Successfully applied pending credits for user ${existing.userId}: ${externalOrderId}`);
        } else {
          console.log(`[DPay IPN] Purchase already credited: ${externalOrderId}`);
        }
        return res.status(200).send('OK');
      }
    }

    // 2. Second priority: Fallback to custom data (userId:packId:credits)
    let targetUser = null;
    let credits = 0;
    let packId = 'popular';

    if (custom) {
      const [customUserId, customPackId, customCreditsStr] = String(custom).split(':');
      if (mongoose.Types.ObjectId.isValid(customUserId)) {
        targetUser = await User.findById(customUserId);
      }
      if (customCreditsStr && !isNaN(parseInt(customCreditsStr, 10))) {
        credits = parseInt(customCreditsStr, 10);
      }
      if (customPackId) {
        packId = customPackId;
      }
    }

    // 3. Third priority: Fallback to email if user not found via custom ID
    if (!targetUser && data.email) {
      targetUser = await User.findOne({ email: String(data.email).trim().toLowerCase() });
    }

    if (!targetUser) {
      console.error('[DPay IPN] User not found for transaction:', transactionId, 'custom:', custom, 'email:', data.email);
      return res.status(200).send('OK');
    }

    if (!credits || credits <= 0) {
      const packFromAmount = Object.values(CREDIT_PACKS).find(p => Math.abs(p.pricePln - amountPln) < 0.5);
      credits = packFromAmount ? packFromAmount.credits : (amountPln >= 35 ? 2000 : (amountPln >= 12 ? 500 : 100));
      packId = packFromAmount ? packFromAmount.id : (amountPln >= 35 ? 'pro' : (amountPln >= 12 ? 'popular' : 'starter'));
    }

    const orderIdToRecord = externalOrderId || `dpay:${Date.now()}`;
    const packInfo = CREDIT_PACKS[packId] || { id: packId, credits, price: amountPln > 0 ? (amountPln / 4.0) : 4.99 };

    await Purchase.recordPurchase(targetUser._id, packInfo.id, credits, {
      priceUsd: amountPln > 0 ? (amountPln / 4.0) : packInfo.price,
      currency: 'PLN',
      paymentProvider: 'dpay',
      externalOrderId: orderIdToRecord
    });

    console.log(`[DPay IPN] Successfully recorded +${credits} credits to ${targetUser.email} (order: ${orderIdToRecord})`);
    return res.status(200).send('OK');
  } catch (error) {
    console.error('[DPay IPN] Webhook processing error:', error.message);
    return res.status(200).send('OK');
  }
});

module.exports = router;
