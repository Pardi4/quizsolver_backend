const CREDIT_PACKS = {
  starter: {
    id: 'starter',
    name: '100 Credits',
    credits: 100,
    price: 1.99,
    lemonVariantEnv: 'LEMONSQUEEZY_VARIANT_100'
  },
  popular: {
    id: 'popular',
    name: '500 Credits',
    credits: 500,
    price: 4.99,
    lemonVariantEnv: 'LEMONSQUEEZY_VARIANT_500'
  },
  pro: {
    id: 'pro',
    name: '2000 Credits',
    credits: 2000,
    price: 9.99,
    lemonVariantEnv: 'LEMONSQUEEZY_VARIANT_2000'
  }
};

function packFromCredits(credits) {
  const amount = parseInt(credits, 10);
  return Object.values(CREDIT_PACKS).find(pack => pack.credits === amount) || null;
}

function packFromLemonVariantId(variantId) {
  const normalized = String(variantId || '').trim();
  if (!normalized) return null;
  return Object.values(CREDIT_PACKS).find(pack => (
    String(process.env[pack.lemonVariantEnv] || '').trim() === normalized
  )) || null;
}

module.exports = { CREDIT_PACKS, packFromCredits, packFromLemonVariantId };
