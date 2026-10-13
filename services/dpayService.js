const crypto = require('crypto');
const { CREDIT_PACKS } = require('../config/creditPacks');

const DPAY_REGISTER_URL = 'https://api-payments.dpay.pl/api/v1_0/payments/register';
const DPAY_FALLBACK_REGISTER_URL = 'https://secure.dpay.pl/register/';
const DPAY_DETAILS_URL = 'https://panel.dpay.pl/api/v1/pbl/details';

// Fixed PLN prices for credit packs (in PLN with 2 decimals)
const PLN_PACK_PRICES = {
  starter: 4.99,
  popular: 14.99,
  pro: 39.00
};

function looksPlaceholder(value) {
  return !value || /xxxx|placeholder|changeme|todo/i.test(String(value));
}

function getService() {
  return String(
    process.env.DPAY_SERVICE_HASH ||
    process.env.DPAY_SERVICE_NAME ||
    process.env.DPAY_SERVICE_ID ||
    ''
  ).trim();
}

function getSecret() {
  return String(
    process.env.DPAY_SECRET_KEY ||
    process.env.DPAY_SECRET_HASH ||
    process.env.DPAY_HASH ||
    ''
  ).trim();
}

function isConfigured() {
  const service = getService();
  const secret = getSecret();
  return Boolean(service && secret && !looksPlaceholder(service) && !looksPlaceholder(secret));
}

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a || '').trim().toLowerCase(), 'utf8');
  const right = Buffer.from(String(b || '').trim().toLowerCase(), 'utf8');
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

/**
 * Generates SHA-256 checksum for registering payment on dpay.pl
 * Formula from docs.dpay.pl:
 * sha256({service}|{hash}|{value}|{url_success}|{url_fail}|{url_ipn})
 */
function calculateRegistrationChecksum(service, secret, value, urlSuccess, urlFail, urlIpn = '') {
  const normalizedValue = Number(value).toFixed(2);
  const raw = `${service}|${secret}|${normalizedValue}|${urlSuccess}|${urlFail}|${urlIpn}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

const promoService = require('./promoService');

/**
 * Calculates PLN price for a given pack with optional discount code or percent
 */
function getPlnPrice(packId, discountCodeOrPercent = 0) {
  let percent = 0;
  if (typeof discountCodeOrPercent === 'number') {
    percent = discountCodeOrPercent;
  } else if (discountCodeOrPercent) {
    const code = promoService.normalizePromoCode(discountCodeOrPercent);
    if (code && promoService.BUILTIN_PROMO_CODES[code]) {
      percent = promoService.BUILTIN_PROMO_CODES[code].percent;
    } else if (code === 'WELCOME10') {
      percent = 10;
    }
  }
  return promoService.calculatePlnPrice(packId, percent);
}

/**
 * Registers a transaction in dpay.pl and returns checkout URL
 */
async function createPayment({
  user,
  pack,
  discountCode,
  discountPercent = 0,
  successUrl,
  failUrl,
  ipnUrl
}) {
  if (!isConfigured()) {
    throw new Error('DPay is not configured.');
  }

  const service = getService();
  const secret = getSecret();
  const packInfo = CREDIT_PACKS[pack?.id || pack] || pack;
  if (!packInfo || !packInfo.credits) {
    throw new Error('Invalid pack information.');
  }

  const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://getquizsolver.com').replace(/\/+$/, '');
  const finalSuccessUrl = successUrl || `${siteUrl}/pl/success?provider=dpay`;
  const finalFailUrl = failUrl || `${siteUrl}/pl/credits?status=cancelled`;
  const finalIpnUrl = ipnUrl || process.env.DPAY_IPN_URL || `${siteUrl}/api/webhook/dpay`;

  // Resolve discount percentage
  let effectiveDiscountPercent = Number(discountPercent) || 0;
  let normalizedCode = discountCode ? promoService.normalizePromoCode(discountCode) : '';

  if (normalizedCode && effectiveDiscountPercent <= 0) {
    const promoValidation = await promoService.validatePromoCode(normalizedCode, user, packInfo.id);
    if (promoValidation.valid) {
      effectiveDiscountPercent = promoValidation.discountPercent;
    }
  }

  const amountNumber = promoService.calculatePlnPrice(packInfo.id, effectiveDiscountPercent);
  const formattedValue = amountNumber.toFixed(2);

  const checksum = calculateRegistrationChecksum(
    service,
    secret,
    formattedValue,
    finalSuccessUrl,
    finalFailUrl,
    finalIpnUrl
  );

  const customData = `${user._id.toString()}:${packInfo.id}:${packInfo.credits}`;
  let description = `QuizSolver - ${packInfo.credits} kredytów (${user.email})`;
  if (normalizedCode && effectiveDiscountPercent > 0) {
    description += ` [Kod: ${normalizedCode} -${effectiveDiscountPercent}%]`;
  }

  const payload = {
    service,
    transactionType: 'transfers',
    value: formattedValue,
    url_success: finalSuccessUrl,
    url_fail: finalFailUrl,
    url_ipn: finalIpnUrl,
    checksum,
    custom: customData,
    description,
    email: user.email,
    blik: 1
  };

  let responseData = null;
  let responseStatus = 0;

  try {
    const res = await fetch(DPAY_REGISTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    responseStatus = res.status;
    responseData = await res.json().catch(() => null);
  } catch (err) {
    console.warn(`[DPay] Primary endpoint error (${err.message}), trying fallback...`);
    try {
      const fallbackRes = await fetch(DPAY_FALLBACK_REGISTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      responseStatus = fallbackRes.status;
      responseData = await fallbackRes.json().catch(() => null);
    } catch (fallbackErr) {
      console.error('[DPay] Fallback register failed:', fallbackErr.message);
      return {
        success: false,
        error: 'Nie można połączyć się z operatorem płatności dPay.'
      };
    }
  }

  if (!responseData) {
    return {
      success: false,
      error: `Błąd operatora dPay (HTTP ${responseStatus}).`
    };
  }

  // dPay success structure:
  // { error: false, status: true, msg: "https://secure.dpay.pl/transfer@pay@...", transactionId: "..." }
  const checkoutUrl = (typeof responseData.msg === 'string' && responseData.msg.startsWith('http'))
    ? responseData.msg
    : responseData.url;

  if (checkoutUrl) {
    return {
      success: true,
      checkoutUrl,
      transactionId: responseData.transactionId || '',
      amount: formattedValue,
      currency: 'PLN',
      discountCode: normalizedCode || null,
      discountPercent: effectiveDiscountPercent
    };
  }

  const errMsg = responseData.message || responseData.msg || (responseData.errors ? JSON.stringify(responseData.errors) : 'Nieznany błąd bramki dPay');
  console.error('[DPay] Registration error response:', responseStatus, responseData);
  return {
    success: false,
    error: errMsg
  };
}

/**
 * Verifies IPN signature received from dpay.pl
 * Official docs formula:
 * sha256({id}{SecretHash}{amount}{email}{type}{attempt}{version}{custom})
 */
function verifyIpnSignature(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const secret = getSecret();
  if (!secret) return false;

  const id = String(payload.id || payload.transaction_id || '').trim();
  const amount = String(payload.amount || payload.value || '').trim();
  const email = String(payload.email || '').trim();
  const type = String(payload.type || 'transfer').trim();
  const attempt = String(payload.attempt !== undefined ? payload.attempt : '1').trim();
  const version = String(payload.version !== undefined ? payload.version : '1').trim();
  const custom = String(payload.custom || '').trim();
  const signature = String(payload.signature || payload.checksum || '').trim().toLowerCase();

  if (!id || !amount || !signature) {
    return false;
  }

  // 1. Official dPay IPN v1 formula for "transfer":
  // sha256({id}{SecretHash}{amount}{email}{type}{attempt}{version}{custom})
  const expectedTransfer = crypto
    .createHash('sha256')
    .update(`${id}${secret}${amount}${email}${type}${attempt}${version}${custom}`)
    .digest('hex');

  if (timingSafeEqualHex(expectedTransfer, signature)) {
    return true;
  }

  // 2. DCB notification formula (omits email):
  // sha256({id}{SecretHash}{amount}{type}{attempt}{version}{custom})
  const expectedDcb = crypto
    .createHash('sha256')
    .update(`${id}${secret}${amount}${type}${attempt}${version}${custom}`)
    .digest('hex');

  if (timingSafeEqualHex(expectedDcb, signature)) {
    return true;
  }

  // 3. Fallback without version/attempt or with pipes:
  const expectedPipes = crypto
    .createHash('sha256')
    .update(`${id}|${secret}|${amount}|${custom}`)
    .digest('hex');

  if (timingSafeEqualHex(expectedPipes, signature)) {
    return true;
  }

  return false;
}

/**
 * Queries transaction status from dPay panel API
 * (Formula from Biolasek: sha256(`${service}|${transaction_id}|${secret}`))
 */
async function getTransactionDetails(transactionId) {
  const service = getService();
  const secret = getSecret();
  if (!service || !secret || !transactionId) return null;

  try {
    const checksum = crypto
      .createHash('sha256')
      .update(`${service}|${transactionId}|${secret}`)
      .digest('hex');

    const res = await fetch(DPAY_DETAILS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service,
        transaction_id: transactionId,
        checksum
      })
    });

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[DPay] getTransactionDetails query failed:', err.message);
    return null;
  }
}

function getWebhookSecret() {
  return String(process.env.DPAY_WEBHOOK_SECRET || '').trim();
}

function timingSafeEqualRaw(a, b) {
  const left = Buffer.from(String(a || '').trim(), 'utf8');
  const right = Buffer.from(String(b || '').trim(), 'utf8');
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function verifyHmacWebhook(rawBody, headers = {}) {
  const webhookSecret = getWebhookSecret();
  if (!webhookSecret) return false;

  const sigHeader = typeof headers === 'string'
    ? headers
    : (headers['webhook-signature'] || headers['x-dpay-signature'] || headers['dpay-signature'] || headers['signature'] || '');

  if (!sigHeader) return false;

  try {
    const raw = typeof rawBody === 'string' ? rawBody : (Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(rawBody));
    const msgId = typeof headers === 'object' ? (headers['webhook-id'] || headers['x-dpay-webhook-id'] || headers['svix-id'] || '') : '';
    const msgTimestamp = typeof headers === 'object' ? (headers['webhook-timestamp'] || headers['x-dpay-webhook-timestamp'] || headers['svix-timestamp'] || '') : '';

    const keyBytes = webhookSecret.startsWith('whsec_')
      ? Buffer.from(webhookSecret.slice(6), 'base64')
      : Buffer.from(webhookSecret, 'utf8');

    // 1. Standard Svix signature (${msgId}.${msgTimestamp}.${body})
    if (msgId && msgTimestamp) {
      const toSign = `${msgId}.${msgTimestamp}.${raw}`;
      const expectedBase64 = crypto.createHmac('sha256', keyBytes).update(toSign).digest('base64');
      const expectedHex = crypto.createHmac('sha256', keyBytes).update(toSign).digest('hex');

      const signatures = String(sigHeader).split(/\s+/);
      for (const item of signatures) {
        const val = item.includes('v1,') ? item.split('v1,')[1] : (item.includes('v1=') ? item.split('v1=')[1] : item);
        if (timingSafeEqualRaw(expectedBase64, val) || timingSafeEqualHex(expectedHex, val)) {
          return true;
        }
      }
    }

    // 2. Direct HMAC on body (hex or base64)
    const directHex = crypto.createHmac('sha256', keyBytes).update(raw).digest('hex');
    const directBase64 = crypto.createHmac('sha256', keyBytes).update(raw).digest('base64');
    const cleanSig = String(sigHeader).replace(/^v1[,=]/, '').trim();

    if (timingSafeEqualHex(directHex, cleanSig) || timingSafeEqualRaw(directBase64, cleanSig)) {
      return true;
    }

    // 3. Fallback with raw secret string if whsec_ wasn't base64 decoded
    const rawSecretHex = crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');
    if (timingSafeEqualHex(rawSecretHex, cleanSig)) {
      return true;
    }

    return false;
  } catch (err) {
    console.warn('[DPay] HMAC verify error:', err.message);
    return false;
  }
}


module.exports = {
  isConfigured,
  getService,
  getSecret,
  getWebhookSecret,
  calculateRegistrationChecksum,
  verifyIpnSignature,
  verifyHmacWebhook,
  createPayment,
  getTransactionDetails,
  getPlnPrice,
  PLN_PACK_PRICES
};

