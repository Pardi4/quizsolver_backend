const express = require('express');
const crypto = require('crypto');
const { webhookLimiter } = require('../middleware/rateLimiter');
const Purchase = require('../models/Purchase');
const User = require('../models/User');
const { packFromCredits, packFromLemonVariantId } = require('../config/creditPacks');

const router = express.Router();

router.use(express.raw({ type: 'application/json', limit: '100kb' }));
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

function resolvePack(payload) {
  const custom = customData(payload);
  const attributes = orderAttributes(payload);

  const customPack = String(custom.pack || '').trim();
  const customCredits = parseInt(custom.credits, 10);

  if (customPack && Number.isFinite(customCredits) && customCredits > 0) {
    return {
      id: customPack,
      credits: customCredits,
      price: 0
    };
  }

  const byCredits = packFromCredits(customCredits);
  if (byCredits) return byCredits;

  const byVariant = packFromLemonVariantId(orderVariantId(attributes));
  if (byVariant) return byVariant;

  const amountUsd = orderTotalUsd(attributes, null);
  if (amountUsd >= 9) return { id: 'pro', credits: 2000, price: 9.99 };
  if (amountUsd >= 4) return { id: 'popular', credits: 500, price: 4.99 };
  if (amountUsd >= 1) return { id: 'starter', credits: 100, price: 1.99 };
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

  const bonus = Math.max(1, Math.floor(credits * 0.05));
  const referralSource = sourceOrderId ? String(sourceOrderId) : `user:${targetUser._id}`;
  await Purchase.recordPurchase(referrer._id, 'referral_bonus', bonus, {
    priceUsd: 0,
    paymentProvider: 'referral',
    externalOrderId: `referral:${referrer._id}:${referralSource}`,
    grantReason: `Referral bonus (5%) from ${targetUser.email}`
  });
  console.log(`[Webhook] Referral 5% bonus: +${bonus} credits to ${referrer.email}`);
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

    const purchase = await Purchase.recordPurchase(targetUser._id, packInfo.id, packInfo.credits, {
      priceUsd: orderTotalUsd(attributes, packInfo),
      paymentProvider: 'lemonsqueezy',
      externalOrderId
    });

    await grantReferralBonus(targetUser, packInfo.credits, externalOrderId || purchase._id);

    console.log(`[LemonSqueezy] +${packInfo.credits} credits for ${targetUser.email}`);
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[LemonSqueezy] Error:', error.message);
    return res.status(200).json({ received: true });
  }
});

module.exports = router;
