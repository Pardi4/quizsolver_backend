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

purchaseSchema.statics.recordPurchase = async function(userId, pack, credits, details = {}) {
  const User = require('./User');

  const purchaseData = {
    userId,
    pack,
    credits,
    priceUsd: details.priceUsd || 0,
    paymentProvider: details.paymentProvider || 'lemonsqueezy',
    grantedBy: details.grantedBy || null,
    grantReason: details.grantReason || null
  };

  if (details.externalOrderId) {
    purchaseData.externalOrderId = String(details.externalOrderId);
  }

  const purchase = await this.create(purchaseData);

  const user = await User.findById(userId);
  if (user) {
    user.addCredits(credits);
    await user.save();
  }

  return purchase;
};

module.exports = mongoose.model('Purchase', purchaseSchema);
