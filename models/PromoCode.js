const mongoose = require('mongoose');

const promoCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    index: true
  },
  discountPercent: {
    type: Number,
    required: true,
    min: 1,
    max: 50,
    default: 10
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  platforms: {
    type: [String],
    enum: ['dpay', 'lemonsqueezy'],
    default: ['dpay', 'lemonsqueezy']
  },
  lemonDiscountId: {
    type: String,
    default: null
  },
  maxUses: {
    type: Number,
    default: 0 // 0 = unlimited
  },
  usedCount: {
    type: Number,
    default: 0
  },
  usedCountDpay: {
    type: Number,
    default: 0
  },
  usedCountLemon: {
    type: Number,
    default: 0
  },
  expiresAt: {
    type: Date,
    default: null
  },
  active: {
    type: Boolean,
    default: true
  },
  firstPurchaseOnly: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('PromoCode', promoCodeSchema);
