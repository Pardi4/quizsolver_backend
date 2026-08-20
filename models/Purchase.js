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
    enum: ['starter', 'popular', 'pro', 'admin_grant', 'referral_bonus'],
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
  paymentProvider: {
    type: String,
    enum: ['lemonsqueezy', 'whop', 'manual', 'free', 'referral'],
    default: 'lemonsqueezy'
  },
  externalOrderId: {
    type: String,
    default: undefined
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
    paymentProvider: details.paymentProvider || 'lemonsqueezy',
    grantedBy: details.grantedBy || null,
    grantReason: details.grantReason || null,
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
      const bonusPurchase = await this.create({
        userId: buyer.referredBy,
        pack: 'referral_bonus',
        credits: bonusCredits,
        priceUsd: 0,
        paymentProvider: 'referral',
        grantReason: `Referral bonus from purchase ${purchaseData.externalOrderId || 'unknown'} by ${buyer.email}`
      });
      await this.applyCredits(bonusPurchase);
      console.log(`[Referral] Granted ${bonusCredits} bonus credits to referrer ${buyer.referredBy}`);
    } catch (err) {
      console.error('[Referral] Failed to grant referral bonus:', err);
    }
  }

  return result;
};

module.exports = mongoose.model('Purchase', purchaseSchema);
