const express = require('express');
const crypto = require('crypto');
const { webhookLimiter } = require('../middleware/rateLimiter');
const Purchase = require('../models/Purchase');
const User = require('../models/User');

const router = express.Router();

router.use(express.raw({ type: 'application/json', limit: '10kb' }));
router.use(webhookLimiter);

const PACK_MAP = {
  100: { pack: 'starter', credits: 100, price: 1.99 },
  500: { pack: 'popular', credits: 500, price: 4.99 },
  2000: { pack: 'pro', credits: 2000, price: 9.99 }
};

function verifyWhopSignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;

  try {
    const parts = signature.split(',');
    let timestamp = '';
    let sig = '';

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 't') timestamp = value;
      if (key === 'v1') sig = value;
    }

    if (!timestamp || !sig) {
      const hmac = crypto.createHmac('sha256', secret);
      const digest = hmac.update(rawBody).digest('hex');
      return crypto.timingSafeEqual(
        Buffer.from(digest, 'utf8'),
        Buffer.from(signature, 'utf8')
      );
    }

    const payload = `${timestamp}.${rawBody}`;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(expectedSig, 'utf8'),
      Buffer.from(sig, 'utf8')
    );
  } catch {
    return false;
  }
}

router.post('/payment', async (req, res) => {
  try {
    const secret = process.env.WHOP_WEBHOOK_SECRET;
    const signature = req.headers['whop-signature'] || req.headers['x-signature'] || req.headers['webhook-signature'] || '';
    const rawBody = req.body.toString();

    if (!secret) {
      console.error('[Webhook] WHOP_WEBHOOK_SECRET is not configured!');
      return res.status(500).json({ error: 'Webhook configuration error.' });
    }

    if (!signature || !verifyWhopSignature(rawBody, signature, secret)) {
      console.warn('[Webhook] Invalid or missing signature');
      return res.status(400).json({ error: 'Invalid signature.' });
    }

    const event = JSON.parse(rawBody);

    const action = event.action || event.event || event.type || '';
    const data = event.data || event;

    console.log(`[Webhook] Event: ${action}`);

    if (action === 'payment.completed' || action === 'payment_completed' || action === 'order_created' || action === 'membership.went_valid') {
      const metadata = data.metadata || data.custom_data || data.meta?.custom_data || {};
      const userId = metadata.user_id || metadata.userId;
      const creditsStr = metadata.credits;
      const packName = metadata.pack;
      const paymentId = data.id || data.payment_id || data.order_id || '';

      if (paymentId) {
        const existingPurchase = await Purchase.findOne({ externalOrderId: String(paymentId) });
        if (existingPurchase) {
          console.log(`[Webhook] Duplicate ignored: ${paymentId}`);
          return res.status(200).json({ received: true });
        }
      }

      let credits = parseInt(creditsStr) || 0;
      let pack = packName || 'starter';

      if (!credits && PACK_MAP[pack]) {
        credits = PACK_MAP[pack].credits;
      }

      if (!credits) {
        const amount = data.final_amount || data.amount || data.total || 0;
        const amountUsd = typeof amount === 'number' ? (amount > 100 ? amount / 100 : amount) : 0;

        if (amountUsd >= 9) { credits = 2000; pack = 'pro'; }
        else if (amountUsd >= 4) { credits = 500; pack = 'popular'; }
        else if (amountUsd >= 1) { credits = 100; pack = 'starter'; }
      }

      if (!credits) {
        console.warn('[Webhook] Cannot determine credits from event');
        return res.status(200).json({ received: true });
      }

      let targetUser = null;

      if (userId) {
        targetUser = await User.findById(userId);
      }

      if (!targetUser) {
        const email = (data.email || data.user_email || data.customer_email || '').toLowerCase().trim();
        if (email) {
          targetUser = await User.findOne({ email });
        }
      }

      if (!targetUser) {
        console.error('[Webhook] User not found');
        return res.status(200).json({ received: true });
      }

      await Purchase.recordPurchase(targetUser._id, pack, credits, {
        priceUsd: (data.final_amount || data.amount || 0) / 100,
        paymentProvider: 'whop',
        externalOrderId: String(paymentId)
      });

      if (targetUser.referredBy) {
        const referrer = await User.findById(targetUser.referredBy);
        if (referrer) {
          const bonus = Math.max(1, Math.floor(credits * 0.05));
          await Purchase.recordPurchase(referrer._id, 'referral_bonus', bonus, {
            priceUsd: 0,
            paymentProvider: 'referral',
            grantReason: `Referral bonus (5%) from ${targetUser.email}`
          });
          console.log(`[Webhook] Referral 5% bonus: +${bonus} credits to ${referrer.email}`);
        }
      }

      console.log(`[Webhook] +${credits} credits for ${targetUser.email} (${paymentId})`);
    }

    if (action === 'payment.refunded' || action === 'order_refunded' || action === 'charge.refunded') {
      const paymentId = String(data.id || data.payment_id || '');
      const purchase = await Purchase.findOne({ externalOrderId: paymentId });
      if (purchase) {
        const user = await User.findById(purchase.userId);
        if (user) {
          user.credits = Math.max(0, user.credits - purchase.credits);
          await user.save();
          console.log(`[Webhook] Refund: -${purchase.credits} from ${user.email}`);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[Webhook] Error:', error.message);
    res.status(200).json({ received: true });
  }
});



module.exports = router;
