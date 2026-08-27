const crypto = require('crypto');

async function createLemonSqueezyDiscount({ name, code, amountPercent, maxRedemptions, expiresAt }) {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  
  if (!apiKey || !storeId) {
    throw new Error('LemonSqueezy API Key or Store ID missing.');
  }

  const payload = {
    data: {
      type: 'discounts',
      attributes: {
        name: name,
        code: code,
        amount: amountPercent,
        amount_type: 'percent',
        is_limited_to_products: false,
        is_limited_redemptions: maxRedemptions > 0,
        max_redemptions: maxRedemptions > 0 ? maxRedemptions : 0,
        expires_at: expiresAt || null
      },
      relationships: {
        store: {
          data: { type: 'stores', id: storeId.toString() }
        }
      }
    }
  };

  const response = await fetch('https://api.lemonsqueezy.com/v1/discounts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    console.error('LemonSqueezy Discount Error:', data);
    throw new Error('Failed to create discount in LemonSqueezy');
  }

  return data.data; // The created discount object
}

function generateRandomCode(prefix = 'PROMO') {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomPart = '';
  for (let i = 0; i < 6; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  // LemonSqueezy strictly allows only alphanumeric characters (no dashes).
  let cleanPrefix = String(prefix).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleanPrefix) cleanPrefix = 'PROMO';
  
  return `${cleanPrefix}${randomPart}`;
}

module.exports = {
  createLemonSqueezyDiscount,
  generateRandomCode
};
