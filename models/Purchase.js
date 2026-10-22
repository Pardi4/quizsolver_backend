const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  pack: {
    type: String,
    enum: ['starter', 'popular', 'pro', 'subscription', 'admin_grant', 'referral_bonus'],
    required: true
  },
  credits: {
    type: Number,
    required: true,
    min: 1
  },
  priceUsd: {
    type: Number,
    default: 0
  },
  pricePln: {
    type: Number,
    default: null
  },
  currency: {
    type: String,
    default: 'USD'
  },
  paymentProvider: {
    type: String,
    enum: ['lemonsqueezy', 'whop', 'manual', 'free', 'referral', 'dpay', 'promo_free'],
    default: 'lemonsqueezy'
  },
  externalOrderId: {
    type: String,
    default: undefined
  },
  discountCode: {
    type: String,
    default: null
  },
  discountPercent: {
    type: Number,
    default: 0
  },
  creditsApplied: {
    type: Boolean,
    default: true,
    index: true
  },
  creditsAppliedAt: {
    type: Date,
    default: null
  },
  grantedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  grantReason: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

purchaseSchema.index(
  { externalOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: { externalOrderId: { $type: 'string' } }
  }
);

purchaseSchema.index({ userId: 1, pack: 1, createdAt: -1 });

purchaseSchema.statics.applyCredits = async function(purchaseOrId) {
  const User = require('./User');
  const purchase = typeof purchaseOrId === 'object' && purchaseOrId?._id
    ? purchaseOrId
    : await this.findById(purchaseOrId);

  if (!purchase) throw new Error('Purchase not found.');
  if (purchase.creditsApplied !== false) return purchase;

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: purchase.userId,
      appliedCreditPurchases: { $ne: purchase._id }
    },
    {
      $inc: {
        credits: purchase.credits,
        paidCredits: purchase.credits,
        'stats.totalCreditsPurchased': purchase.credits
      },
      $addToSet: { appliedCreditPurchases: purchase._id }
    },
    { new: true }
  );

  const alreadyApplied = updatedUser ? true : await User.exists({
    _id: purchase.userId,
    appliedCreditPurchases: purchase._id
  });
  if (!alreadyApplied) {
    throw new Error('Could not apply credits to user.');
  }

  if (!purchase.creditsApplied) {
    purchase.creditsApplied = true;
    purchase.creditsAppliedAt = purchase.creditsAppliedAt || new Date();
    await purchase.save();

    try {
      const telegramService = require('../services/telegramService');
      telegramService.notifyPurchase(purchase, updatedUser);
    } catch (e) {
      // Fire-and-forget notification
    }
  }

  return purchase;
};

purchaseSchema.statics.revokeCredits = async function(purchaseOrId) {
  const User = require('./User');
  const purchase = typeof purchaseOrId === 'object' && purchaseOrId?._id
    ? purchaseOrId
    : await this.findById(purchaseOrId);

  if (!purchase) throw new Error('Purchase not found.');
  if (purchase.creditsApplied === false) return purchase;

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: purchase.userId,
      appliedCreditPurchases: purchase._id
    },
    {
      $inc: {
        credits: -purchase.credits,
        paidCredits: -purchase.credits,
        'stats.totalCreditsPurchased': -purchase.credits
      },
      $pull: { appliedCreditPurchases: purchase._id }
    },
    { new: true }
  );

  if (!updatedUser) {
    throw new Error('Could not revoke credits from user. Perhaps already revoked?');
  }

  if (purchase.creditsApplied) {
    purchase.creditsApplied = false;
    purchase.creditsAppliedAt = null;
    await purchase.save();
  }

  return purchase;
};

purchaseSchema.statics.recordPurchase = async function(userId, pack, credits, details = {}) {
  const User = require('./User');
  const normalizedCredits = Math.max(parseInt(credits, 10) || 0, 0);
  if (!normalizedCredits) throw new Error('Credits must be greater than 0.');

  const buyer = await User.findById(userId);
  if (!buyer) throw new Error('User not found for credit purchase.');

  const purchaseData = {
    userId,
    pack,
    credits: normalizedCredits,
    priceUsd: details.priceUsd || 0,
    pricePln: details.pricePln !== undefined && details.pricePln !== null
      ? details.pricePln
      : (details.paymentProvider === 'dpay' ? (details.amountPln || (details.priceUsd ? Number((details.priceUsd * 4).toFixed(2)) : null)) : null),
    currency: details.currency || (details.paymentProvider === 'dpay' ? 'PLN' : 'USD'),
    paymentProvider: details.paymentProvider || 'lemonsqueezy',
    grantedBy: details.grantedBy || null,
    grantReason: details.grantReason || null,
    discountCode: details.discountCode || null,
    discountPercent: Number(details.discountPercent) || 0,
    creditsApplied: false,
    creditsAppliedAt: null
  };

  if (details.externalOrderId) {
    purchaseData.externalOrderId = String(details.externalOrderId);
  }

  let purchase;
  try {
    purchase = await this.create(purchaseData);
  } catch (error) {
    if (error.code !== 11000 || !purchaseData.externalOrderId) throw error;
    purchase = await this.findOne({ externalOrderId: purchaseData.externalOrderId });
    if (!purchase) throw error;
  }

  const result = await this.applyCredits(purchase);

  // Referral gamification: give 10% of credits to the referrer
  if (purchase.creditsApplied && buyer.referredBy && pack !== 'referral_bonus' && normalizedCredits > 0) {
    try {
      const bonusCredits = Math.max(1, Math.floor(normalizedCredits * 0.10));
      const refOrderId = `referral:${buyer.referredBy}:${purchaseData.externalOrderId || purchase._id}`;
      const existingRef = await this.findOne({ externalOrderId: refOrderId });
      if (!existingRef) {
        const bonusPurchase = await this.create({
          userId: buyer.referredBy,
          pack: 'referral_bonus',
          credits: bonusCredits,
          priceUsd: 0,
          currency: 'USD',
          paymentProvider: 'referral',
          externalOrderId: refOrderId,
          grantReason: `Referral bonus from purchase ${purchaseData.externalOrderId || 'unknown'} by ${buyer.email}`
        });
        await this.applyCredits(bonusPurchase);
        console.log(`[Referral] Granted ${bonusCredits} bonus credits to referrer ${buyer.referredBy}`);
      }
    } catch (err) {
      console.error('[Referral] Failed to grant referral bonus:', err);
    }
  }

  return result;
};

module.exports = mongoose.model('Purchase', purchaseSchema);
