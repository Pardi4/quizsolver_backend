const mongoose = require('mongoose');

/**
 * One record per checkout session created via POST /api/credits/buy.
 * Used by the admin funnel (signup -> solve -> out of credits -> checkout -> purchase)
 * to tell apart "never wanted to buy" from "started paying but abandoned".
 */
const checkoutStartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  pack: {
    type: String,
    required: true
  },
  credits: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

checkoutStartSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CheckoutStart', checkoutStartSchema);
