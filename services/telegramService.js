const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Purchase = require('../models/Purchase');
const CreditUsage = require('../models/CreditUsage');
const StudyNote = require('../models/StudyNote');
const CachedAnswer = require('../models/CachedAnswer');
const BugReport = require('../models/BugReport');
const SupportMessage = require('../models/SupportMessage');
const ParserEvent = require('../models/ParserEvent');

const STATE_FILE = path.join(__dirname, '..', 'config', 'telegram_state.json');
const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

let botToken = process.env.TELEGRAM_BOT_TOKEN || '8823426310:AAHW0GBYxKKdwWz7xiu0QQnV0V2WkTJZlkc';
let adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID ? String(process.env.TELEGRAM_ADMIN_CHAT_ID).trim() : '';
let isPollingActive = false;
let pollingAbortController = null;
let scheduledTimeout = null;

const DEFAULT_SETTINGS = {
  dailyReport: true,
  purchases: true,
  support: true,
  bugs: true,
  uninstalls: true
};

const SETTING_METADATA = {
  dailyReport: {
    label: 'Raport dzienny (08:00)',
    shortLabel: 'Raport 08:00',
    icon: '📊'
  },
  purchases: {
    label: 'Zakupy kredytów ($ / zł)',
    shortLabel: 'Zakupy ($ / zł)',
    icon: '💰'
  },
  support: {
    label: 'Wiadomości supportu i maile',
    shortLabel: 'Support i maile',
    icon: '📬'
  },
  bugs: {
    label: 'Błędy i alerty parsera',
    shortLabel: 'Błędy i parser',
    icon: '🐛'
  },
  uninstalls: {
    label: 'Ankiety odinstalowania',
    shortLabel: 'Odinstalowania',
    icon: '📉'
  }
};

let adminSettings = { ...DEFAULT_SETTINGS };

function isNotificationEnabled(key) {
  if (adminSettings && typeof adminSettings[key] === 'boolean') {
    return adminSettings[key];
  }
  return true;
}

// Load persisted adminChatId and settings from disk if available
function loadPersistedState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (data?.adminChatId && !adminChatId) {
        adminChatId = String(data.adminChatId).trim();
        console.log(`[TelegramBot] Loaded persisted adminChatId: ${adminChatId}`);
      }
      if (data?.settings && typeof data.settings === 'object') {
        adminSettings = { ...DEFAULT_SETTINGS, ...data.settings };
      }
    }
  } catch (err) {
    console.warn('[TelegramBot] Could not read telegram_state.json:', err.message);
  }
}

function persistCurrentState() {
  try {
    const payload = {
      adminChatId: adminChatId || '',
      adminUsername: 'kam567122',
      updatedAt: new Date().toISOString(),
      settings: adminSettings
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.warn('[TelegramBot] Failed to persist telegram_state.json:', err.message);
  }
}

function persistAdminChatId(id) {
  adminChatId = String(id).trim();
  persistCurrentState();
  console.log(`[TelegramBot] Persisted adminChatId: ${adminChatId}`);
}

// Timezone & Date Helpers (Europe/Warsaw)
function getWarsawOffset(dateStr) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Warsaw',
      timeZoneName: 'shortOffset'
    }).formatToParts(new Date(dateStr));
    const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '+02:00';
    const m = tzPart.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (!m) return '+02:00';
    const sign = m[1][0];
    const hours = Math.abs(parseInt(m[1], 10)).toString().padStart(2, '0');
    const mins = m[2] ? m[2].padStart(2, '0') : '00';
    return sign + hours + ':' + mins;
  } catch {
    return '+02:00';
  }
}

function getWarsawDayBoundaries(dateStr) {
  const offset = getWarsawOffset(`${dateStr}T12:00:00Z`);
  const start = new Date(`${dateStr}T00:00:00.000${offset}`);
  const end = new Date(`${dateStr}T23:59:59.999${offset}`);
  return { start, end };
}

function getYesterdayWarsawDateStr() {
  const now = new Date();
  const warsawTodayStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' });
  const d = new Date(warsawTodayStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function getTodayWarsawDateStr() {
  const now = new Date();
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' });
}

function msUntilNextWarsaw8AM() {
  const now = new Date();
  const warsawStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' });
  const [year, month, day] = warsawStr.split('-').map(Number);
  const offset = getWarsawOffset(`${warsawStr}T08:00:00Z`);

  let target = new Date(`${warsawStr}T08:00:00.000${offset}`);
  if (now.getTime() >= target.getTime()) {
    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
    const tomStr = tomorrow.toISOString().slice(0, 10);
    const tomOffset = getWarsawOffset(`${tomStr}T08:00:00Z`);
    target = new Date(`${tomStr}T08:00:00.000${tomOffset}`);
  }
  return Math.max(target.getTime() - now.getTime(), 1000);
}

// Telegram API Wrapper
async function callTelegram(method, payload = {}) {
  const url = `${TELEGRAM_API_BASE}${botToken}/${method}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error(`[TelegramBot] API error on ${method}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendMessage(chatId, text, options = {}) {
  if (!chatId || !text) return false;
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: options.disable_web_page_preview !== false,
    ...options
  };
  const res = await callTelegram('sendMessage', payload);
  return res && res.ok === true;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendAdminAlert(htmlText) {
  if (!adminChatId) {
    loadPersistedState();
  }
  if (!adminChatId) return false;
  return sendMessage(adminChatId, htmlText);
}

// Real-time alert: New Credit Purchase
async function notifyPurchase(purchase, buyer) {
  try {
    if (!isNotificationEnabled('purchases')) return;
    if (!purchase || purchase.pack === 'referral_bonus' || purchase.paymentProvider === 'referral' || purchase.paymentProvider === 'admin') return;

    let buyerEmail = buyer?.email || '';
    if (!buyerEmail && purchase.userId) {
      try {
        const u = await User.findById(purchase.userId).select('email');
        if (u) buyerEmail = u.email;
      } catch {}
    }

    const provider = String(purchase.paymentProvider || '').toLowerCase();
    const isPln = provider === 'dpay' || purchase.currency === 'PLN';
    const amountStr = isPln
      ? `${Number(purchase.pricePln || 0).toFixed(2)} zł (BLIK / DPay)`
      : `$${Number(purchase.priceUsd || 0).toFixed(2)} (Lemon Squeezy)`;

    const packName = purchase.pack ? String(purchase.pack).toUpperCase() : 'PAKIET';
    const credits = purchase.credits || 0;
    const discountInfo = purchase.discountCode ? `\n• 🏷 <b>Kod rabatowy:</b> <code>${escapeHtml(purchase.discountCode)}</code>` : '';
    const nowWarsaw = new Date().toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });

    const text = `
💰 <b>NOWY ZAKUP KREDYTÓW!</b>

• 👤 <b>Klient:</b> <code>${escapeHtml(buyerEmail || 'Nieznany')}</code>
• 📦 <b>Pakiet:</b> <b>${escapeHtml(packName)}</b> (<b>+${credits.toLocaleString('pl-PL')}</b> kredytów)
• 💵 <b>Kwota:</b> <b>${amountStr}</b>${discountInfo}
• 🧾 <b>ID zamówienia:</b> <code>${escapeHtml(String(purchase.externalOrderId || purchase._id))}</code>
• ⏰ <b>Godzina:</b> ${nowWarsaw}
`.trim();

    await sendAdminAlert(text);
  } catch (err) {
    console.error('[TelegramBot] notifyPurchase error:', err.message);
  }
}

// Real-time alert: New Support Message / Email
async function notifySupportMessage(message, options = {}) {
  try {
    if (!isNotificationEnabled('support')) return;
    if (!message) return;
    const fromEmail = message.fromEmail || options.fromEmail || 'Nieznany nadawca';
    const fromName = message.fromName || '';
    const subject = message.subject || '(Brak tematu)';
    const body = options.replyText || message.text || '(Brak treści)';
    const shortBody = body.substring(0, 350) + (body.length > 350 ? '...' : '');

    const senderDisplay = fromName ? `${escapeHtml(fromName)} &lt;${escapeHtml(fromEmail)}&gt;` : `<code>${escapeHtml(fromEmail)}</code>`;
    const typeLabel = options.isReply ? 'Odpowiedź w wątku' : (options.isContactForm ? 'Formularz kontaktowy' : 'Nowa wiadomość e-mail');

    const adminUrl = process.env.NODE_ENV === 'production' ? 'https://getquizsolver.com' : 'http://localhost:3000';
    const nowWarsaw = new Date().toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });

    const text = `
📬 <b>NOWA WIADOMOŚĆ NA SUPPORCIE!</b>

• 👤 <b>Od:</b> ${senderDisplay}
• 📌 <b>Temat:</b> <b>${escapeHtml(subject)}</b>
• 🏷 <b>Typ:</b> ${typeLabel}
• ⏰ <b>Godzina:</b> ${nowWarsaw}
• 💬 <b>Treść:</b>
<blockquote>${escapeHtml(shortBody)}</blockquote>

🔗 <a href="${adminUrl}">Przejdź do Panelu Admina</a>
`.trim();

    await sendAdminAlert(text);
  } catch (err) {
    console.error('[TelegramBot] notifySupportMessage error:', err.message);
  }
}

// Deduplication map for bug reports to prevent flood (10 min cooldown per platform+url)
const recentBugAlerts = new Map();

// Real-time alert: Bug Report or Parser Failure
async function notifyBugReport(bugReport, user) {
  try {
    if (!isNotificationEnabled('bugs')) return;
    if (!bugReport) return;

    const dedupeKey = `${bugReport.platform || ''}_${bugReport.url || ''}_${bugReport.source || ''}`;
    const now = Date.now();
    if (recentBugAlerts.has(dedupeKey) && now - recentBugAlerts.get(dedupeKey) < 10 * 60 * 1000) {
      return;
    }
    recentBugAlerts.set(dedupeKey, now);

    if (recentBugAlerts.size > 200) {
      for (const [k, ts] of recentBugAlerts.entries()) {
        if (now - ts > 10 * 60 * 1000) recentBugAlerts.delete(k);
      }
    }

    let userEmail = user?.email || '';
    if (!userEmail && bugReport.userId) {
      try {
        const u = await User.findById(bugReport.userId).select('email');
        if (u) userEmail = u.email;
      } catch {}
    }

    const platform = bugReport.platform || 'universal';
    const sourceLabel = bugReport.source === 'manual' ? 'Zgłoszenie ręczne (użytkownik)' : 'Automatyczny błąd parsera';
    const description = bugReport.description || bugReport.parserDiagnostics?.reason || 'Brak opisu';
    const shortDesc = description.substring(0, 300) + (description.length > 300 ? '...' : '');

    const cleanUrl = bugReport.url ? (bugReport.url.length > 80 ? bugReport.url.slice(0, 77) + '...' : bugReport.url) : 'Brak URL';
    const adminUrl = process.env.NODE_ENV === 'production' ? 'https://getquizsolver.com' : 'http://localhost:3000';
    const nowWarsaw = new Date().toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });

    const text = `
🐛 <b>NOWE ZGŁOSZENIE BŁĘDU!</b>

• 👤 <b>Użytkownik:</b> <code>${escapeHtml(userEmail || 'Anonim')}</code>
• 🌐 <b>Platforma:</b> <b>${escapeHtml(platform)}</b>
• 🔗 <b>Strona:</b> <code>${escapeHtml(cleanUrl)}</code>
• 🏷 <b>Typ:</b> ${sourceLabel}
• ⏰ <b>Godzina:</b> ${nowWarsaw}
• 📝 <b>Opis:</b>
<blockquote>${escapeHtml(shortDesc)}</blockquote>

🔗 <a href="${adminUrl}">Przejdź do Panelu Admina</a>
`.trim();

    await sendAdminAlert(text);
  } catch (err) {
    console.error('[TelegramBot] notifyBugReport error:', err.message);
  }
}

// Real-time alert: Extension Uninstall Feedback
async function notifyUninstallFeedback(item) {
  try {
    if (!isNotificationEnabled('uninstalls')) return;
    if (!item) return;

    const REASON_LABELS = {
      not_working: 'Nie działało na teście/stronie',
      too_expensive: 'Za drogo / za mało kredytów',
      hard_to_use: 'Skomplikowane w obsłudze',
      exams_finished: 'Koniec sesji / egzaminów',
      inaccurate_ai: 'Błędne odpowiedzi AI',
      alternative_found: 'Znalazłem inne narzędzie',
      privacy_concern: 'Obawy o prywatność',
      other: 'Inny powód'
    };

    const reasonsList = Array.isArray(item.reasons) && item.reasons.length
      ? item.reasons.map(r => REASON_LABELS[r] || r).join(', ')
      : 'Nie wybrano';

    const feedbackText = item.feedback || item.customReason || 'Brak dodatkowego komentarza';
    const shortFeedback = feedbackText.substring(0, 350) + (feedbackText.length > 350 ? '...' : '');

    const adminUrl = process.env.NODE_ENV === 'production' ? 'https://getquizsolver.com' : 'http://localhost:3000';
    const nowWarsaw = new Date().toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });

    const platform = item.platformUsed ? `\n• 🌐 <b>Platforma:</b> <b>${escapeHtml(item.platformUsed)}</b>` : '';
    const emailInfo = item.email ? `\n• 👤 <b>Email kontaktowy:</b> <code>${escapeHtml(item.email)}</code>` : '';
    const langInfo = item.lang ? `\n• 🌍 <b>Język:</b> <code>${escapeHtml(String(item.lang).toUpperCase())}</code>` : '';

    const text = `
📉 <b>NOWA ANKIETA ODINSTALOWANIA!</b>

• 🏷 <b>Powody:</b> ${escapeHtml(reasonsList)}${platform}${emailInfo}${langInfo}
• ⚙️ <b>Wersja:</b> ${escapeHtml(item.extensionVersion || 'b/d')}
• ⏰ <b>Godzina:</b> ${nowWarsaw}
• 💬 <b>Komentarz:</b>
<blockquote>${escapeHtml(shortFeedback)}</blockquote>

🔗 <a href="${adminUrl}">Zobacz ankiety w Panelu Admina</a>
`.trim();

    await sendAdminAlert(text);
  } catch (err) {
    console.error('[TelegramBot] notifyUninstallFeedback error:', err.message);
  }
}

// Data Aggregation & Report Generation
async function generateDailyReport(options = {}) {
  const isToday = options.isToday === true;
  const targetDateStr = isToday ? getTodayWarsawDateStr() : getYesterdayWarsawDateStr();
  const { start, end } = getWarsawDayBoundaries(targetDateStr);
  const now = new Date();
  const effectiveEnd = isToday && now < end ? now : end;

  // Month-to-date boundary in Warsaw
  const thisMonthStr = `${targetDateStr.slice(0, 7)}-01`;
  const monthStart = getWarsawDayBoundaries(thisMonthStr).start;

  const [
    newSignups,
    dauUsers,
    onlineNow,
    outOfCreditsUsers,
    lemonAgg,
    blikAgg,
    lemonMtdAgg,
    blikMtdAgg,
    creditUsageAgg,
    newCachedAnswers,
    topPlatformsAgg,
    newBugReports,
    unreadBugs,
    unreadSupport,
    openSupport,
    parserErrorsAgg
  ] = await Promise.all([
    User.countDocuments({ createdAt: { $gte: start, $lte: effectiveEnd } }),
    User.countDocuments({ extensionLastSeenAt: { $gte: start, $lte: effectiveEnd } }),
    User.countDocuments({ extensionLastSeenAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) } }),
    User.countDocuments({ credits: { $lte: 0 }, role: { $ne: 'admin' } }),

    // Lemon Squeezy ($) yesterday
    Purchase.aggregate([
      { $match: { paymentProvider: { $in: ['lemonsqueezy', 'lemon', 'whop'] }, createdAt: { $gte: start, $lte: effectiveEnd } } },
      { $group: { _id: null, total: { $sum: '$priceUsd' }, count: { $sum: 1 } } }
    ]),

    // BLIK (zł) yesterday
    Purchase.aggregate([
      { $match: { paymentProvider: 'dpay', createdAt: { $gte: start, $lte: effectiveEnd } } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$pricePln', { $multiply: ['$priceUsd', 4] }] } }, count: { $sum: 1 } } }
    ]),

    // Lemon Squeezy ($) MTD
    Purchase.aggregate([
      { $match: { paymentProvider: { $in: ['lemonsqueezy', 'lemon', 'whop'] }, createdAt: { $gte: monthStart, $lte: effectiveEnd } } },
      { $group: { _id: null, total: { $sum: '$priceUsd' }, count: { $sum: 1 } } }
    ]),

    // BLIK (zł) MTD
    Purchase.aggregate([
      { $match: { paymentProvider: 'dpay', createdAt: { $gte: monthStart, $lte: effectiveEnd } } },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$pricePln', { $multiply: ['$priceUsd', 4] }] } }, count: { $sum: 1 } } }
    ]),

    // Credits spent & questions solved
    CreditUsage.aggregate([
      { $match: { createdAt: { $gte: start, $lte: effectiveEnd }, status: 'charged' } },
      { $group: { _id: null, totalCredits: { $sum: '$credits' }, count: { $sum: 1 } } }
    ]),

    CachedAnswer.countDocuments({ createdAt: { $gte: start, $lte: effectiveEnd } }),

    // Top platforms
    StudyNote.aggregate([
      { $match: { createdAt: { $gte: start, $lte: effectiveEnd } } },
      { $group: { _id: '$platform', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 4 }
    ]),

    BugReport.countDocuments({ createdAt: { $gte: start, $lte: effectiveEnd } }),
    BugReport.countDocuments({ isRead: false }),
    SupportMessage.countDocuments({ isRead: false }),
    SupportMessage.countDocuments({ status: { $ne: 'closed' } }),

    ParserEvent.aggregate([
      { $match: { createdAt: { $gte: start, $lte: effectiveEnd }, outcome: 'error' } },
      { $group: { _id: '$platform', count: { $sum: 1 } } }
    ])
  ]);

  const lemonRev = (lemonAgg[0]?.total || 0).toFixed(2);
  const lemonCount = lemonAgg[0]?.count || 0;
  const blikRev = (blikAgg[0]?.total || 0).toFixed(2);
  const blikCount = blikAgg[0]?.count || 0;

  const lemonMtdRev = (lemonMtdAgg[0]?.total || 0).toFixed(2);
  const blikMtdRev = (blikMtdAgg[0]?.total || 0).toFixed(2);

  const questionsSolved = creditUsageAgg[0]?.count || 0;
  const creditsSpent = creditUsageAgg[0]?.totalCredits || 0;

  const cacheHitCount = Math.max(questionsSolved - newCachedAnswers, 0);
  const cacheHitRate = questionsSolved > 0 ? Math.round((cacheHitCount / questionsSolved) * 100) : 0;

  const topPlatformsStr = topPlatformsAgg.length > 0
    ? topPlatformsAgg.map(p => `<b>${p._id || 'Inne'}:</b> ${p.count}`).join(', ')
    : 'Brak danych';

  const parserErrorsCount = parserErrorsAgg.reduce((s, x) => s + (x.count || 0), 0);
  const parserErrorsDetail = parserErrorsAgg.length > 0
    ? ` (${parserErrorsAgg.map(p => `${p._id}: ${p.count}`).join(', ')})`
    : '';

  const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://getquizsolver.com').replace(/\/+$/, '');
  const adminUrl = `${siteUrl}/admin`;

  const titlePrefix = isToday ? '🔴 STAN NA DZIŚ' : '📊 RAPORT DZIENNY';
  const dateSubtitle = isToday
    ? `Dzisiaj, ${targetDateStr} (stan na godz. ${now.toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' })})`
    : `Dzień wczorajszy: ${targetDateStr}`;

  return `
${titlePrefix} — <b>QUIZSOLVER PRO</b>
📅 <i>${dateSubtitle}</i>

💰 <b>PRZYCHODY ${isToday ? 'DZISIAJ' : 'WCZORAJ'}</b>
• 🍋 <b>Lemon Squeezy:</b> <code>$${lemonRev}</code> (${lemonCount} zam.)
• ⚡ <b>BLIK (DPay):</b> <code>${blikRev} zł</code> (${blikCount} zam.)
• 📈 <b>W tym miesiącu (MTD):</b> <code>$${lemonMtdRev}</code> | <code>${blikMtdRev} zł</code>

👥 <b>UŻYTKOWNICY & RUCH</b>
• ✨ <b>Nowe rejestracje:</b> <code>+${newSignups}</code> kont
• 🔥 <b>Aktywni ${isToday ? 'dziś' : 'wczoraj'} (DAU):</b> <code>${dauUsers}</code> osób
• 🟢 <b>Online teraz:</b> <code>${onlineNow}</code> w rozszerzeniu
• 🪫 <b>Wyczerpane kredyty:</b> <code>${outOfCreditsUsers}</code> użytkowników

🎯 <b>ROZWIĄZYWANIE & AI</b>
• 📝 <b>Rozwiązane pytania:</b> <code>${questionsSolved.toLocaleString('pl-PL')}</code>
• 🎟 <b>Wydane kredyty:</b> <code>${creditsSpent.toLocaleString('pl-PL')}</code>
• ⚡ <b>AI Cache Hit:</b> <code>${cacheHitRate}%</code> pytań z cache ($0 kosztu)
• 🏆 <b>Platformy:</b> ${topPlatformsStr}

⚠️ <b>STATUS & SUPPORT</b>
• 🐛 <b>Nowe bugi:</b> <code>${newBugReports}</code> (nieprzeczytane: ${unreadBugs})
• 📬 <b>Wiadomości supportu:</b> <code>${unreadSupport}</code> nowe (otwarte: ${openSupport})
• 🛠 <b>Błędy parsera:</b> <code>${parserErrorsCount}</code>${parserErrorsDetail}

🔗 <a href="${adminUrl}">Przejdź do Panelu Admina</a>
`.trim();
}

// View for interactive settings with inline toggle buttons
function renderSettingsView() {
  const lines = [
    '⚙️ <b>Ustawienia powiadomień QuizSolver</b>',
    '',
    'Wybierz, które alerty chcesz otrzymywać na Telegramie. Kliknij w przycisk, aby włączyć lub wyłączyć powiadomienia:',
    ''
  ];

  for (const [key, meta] of Object.entries(SETTING_METADATA)) {
    const isEnabled = adminSettings[key] !== false;
    const statusIcon = isEnabled ? '🟢' : '🔴';
    const statusText = isEnabled ? 'WŁĄCZONE' : 'WYŁĄCZONE';
    lines.push(`• ${meta.icon} <b>${escapeHtml(meta.label)}:</b> ${statusIcon} <i>${statusText}</i>`);
  }

  lines.push('');
  lines.push('💡 <i>Zmiany są zapisywane automatycznie i chronione wyłącznie dla @kam567122.</i>');

  const keyboard = [];
  for (const [key, meta] of Object.entries(SETTING_METADATA)) {
    const isEnabled = adminSettings[key] !== false;
    const btnText = `${isEnabled ? '🟢' : '🔴'} ${meta.shortLabel}`;
    keyboard.push([{ text: btnText, callback_data: `toggle_${key}` }]);
  }
  keyboard.push([
    { text: '🔄 Odśwież stan', callback_data: 'refresh_settings' }
  ]);

  return {
    text: lines.join('\n'),
    reply_markup: {
      inline_keyboard: keyboard
    }
  };
}

// Callback Query Handler for Telegram Inline Buttons
async function handleCallbackQuery(cq) {
  if (!cq || !cq.from) return;
  const cqId = cq.id;
  const senderUsername = String(cq.from.username || '').replace(/^@/, '').toLowerCase().trim();
  const allowedAdminUsername = String(process.env.TELEGRAM_ADMIN_USERNAME || 'kam567122').replace(/^@/, '').toLowerCase().trim();

  // STRICT SECURITY GUARD: Only @kam567122 can use interactive controls!
  if (senderUsername !== allowedAdminUsername) {
    await callTelegram('answerCallbackQuery', {
      callback_query_id: cqId,
      text: '⛔ Brak uprawnień administratora.',
      show_alert: true
    });
    return;
  }

  const data = String(cq.data || '');
  if (data.startsWith('toggle_')) {
    const key = data.replace('toggle_', '');
    if (key in adminSettings) {
      adminSettings[key] = !adminSettings[key];
      persistCurrentState();

      const newStatus = adminSettings[key] ? 'WŁĄCZONE 🟢' : 'WYŁĄCZONE 🔴';
      const label = SETTING_METADATA[key]?.shortLabel || key;
      await callTelegram('answerCallbackQuery', {
        callback_query_id: cqId,
        text: `${label}: ${newStatus}`
      });

      if (cq.message && cq.message.chat && cq.message.message_id) {
        const view = renderSettingsView();
        await callTelegram('editMessageText', {
          chat_id: cq.message.chat.id,
          message_id: cq.message.message_id,
          text: view.text,
          parse_mode: 'HTML',
          reply_markup: view.reply_markup
        });
      }
    }
  } else if (data === 'refresh_settings') {
    await callTelegram('answerCallbackQuery', {
      callback_query_id: cqId,
      text: 'Zaktualizowano statusy!'
    });
    if (cq.message && cq.message.chat && cq.message.message_id) {
      const view = renderSettingsView();
      await callTelegram('editMessageText', {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        text: view.text,
        parse_mode: 'HTML',
        reply_markup: view.reply_markup
      });
    }
  }
}

// Handler for incoming messages from Telegram users
async function handleIncomingMessage(msg) {
  if (!msg || !msg.chat) return;

  // STRICT SECURITY GUARD 1: Only direct private 1-on-1 chats (ignore any groups/channels)
  if (msg.chat.type && msg.chat.type !== 'private') return;

  const chatId = String(msg.chat.id);
  const text = String(msg.text || '').trim();
  const senderName = msg.from?.first_name || msg.from?.username || 'Użytkownik';
  const senderUsername = String(msg.from?.username || '').replace(/^@/, '').toLowerCase().trim();
  const allowedAdminUsername = String(process.env.TELEGRAM_ADMIN_USERNAME || 'kam567122').replace(/^@/, '').toLowerCase().trim();

  // STRICT SECURITY GUARD 2: Only @kam567122 can be admin.
  // Anyone else, regardless of message content, receives only the public website invite:
  const isOwnerUser = Boolean(senderUsername && senderUsername === allowedAdminUsername);

  // 1. For EVERYONE ELSE:
  // No admin access, no password prompts - only friendly greeting with link to website
  if (!isOwnerUser) {
    const publicReply = `
Cześć, ${senderName}! 👋 Jestem oficjalnym botem <b>QuizSolver</b>.

Szukasz automatycznego rozwiązywania quizów i testów online w czasie rzeczywistym z pomocą AI (Testportal, Kahoot, Google Forms, Moodle, Canvas i wiele innych)?

👉 <b>Zainstaluj rozszerzenie na naszej stronie:</b>
https://getquizsolver.com 🚀
`.trim();

    await sendMessage(chatId, publicReply);
    return;
  }

  // 2. FOR OWNER (@kam567122):
  // Ensure chatId is persisted for daily 08:00 AM reports
  if (!adminChatId || adminChatId !== chatId) {
    persistAdminChatId(chatId);
  }

  const cmd = text.toLowerCase().split(' ')[0].replace(/@\w+$/, '');

  // Command: /settings, /ustawienia, /opcje
  if (cmd === '/settings' || cmd === '/ustawienia' || cmd === '/opcje') {
    const view = renderSettingsView();
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: view.text,
      parse_mode: 'HTML',
      reply_markup: view.reply_markup
    });
    return;
  }

  // Command: /raport (yesterday's report)
  if (cmd === '/raport' || cmd === '/report') {
    await sendMessage(chatId, '⏳ Generuję raport za wczorajszy dzień...');
    const report = await generateDailyReport({ isToday: false });
    await sendMessage(chatId, report);
    return;
  }

  // Command: /dzis (today's live stats)
  if (cmd === '/dzis' || cmd === '/today') {
    await sendMessage(chatId, '⏳ Generuję statystyki z dzisiejszego dnia...');
    const report = await generateDailyReport({ isToday: true });
    await sendMessage(chatId, report);
    return;
  }

  if (cmd === '/pomoc' || cmd === '/help') {
    const helpMsg = `
👋 <b>Panel Administratora QuizSolver</b>

• <code>/raport</code> — wyślij raport za wczoraj
• <code>/dzis</code> — wyślij statystyki z dzisiaj
• <code>/settings</code> — zarządzaj powiadomieniami (włącz/wyłącz)

Raport dzienny przychodzi automatycznie o <b>08:00 rano</b> (jeśli włączony w ustawieniach).
`.trim();
    await sendMessage(chatId, helpMsg);
    return;
  }

  // Initial greeting / /start / any other message from @kam567122
  const greeting = `
👑 <b>Cześć, @${msg.from.username}!</b>
Twój czat został powiązany jako <b>Główny Administrator QuizSolver</b>.

Codziennie o <b>08:00 rano</b> będziesz otrzymywać tutaj automatyczne podsumowanie dnia.

<b>Dostępne polecenia:</b>
• <code>/raport</code> — raport za wczoraj
• <code>/dzis</code> — raport z dzisiaj
• <code>/settings</code> — ustawienia powiadomień
• <code>/pomoc</code> — lista funkcji
`.trim();
  await sendMessage(chatId, greeting);

  // Send initial report immediately so admin can verify
  try {
    const report = await generateDailyReport({ isToday: false });
    await sendMessage(chatId, report);
  } catch (e) {
    console.error('[TelegramBot] Error sending report to admin:', e.message);
  }
}

// Polling loop for receiving updates from Telegram
let lastUpdateId = 0;

async function pollUpdates() {
  if (!isPollingActive) return;

  try {
    const res = await callTelegram(`getUpdates?offset=${lastUpdateId + 1}&timeout=25`);
    if (res && res.ok && Array.isArray(res.result)) {
      for (const update of res.result) {
        lastUpdateId = Math.max(lastUpdateId, update.update_id);
        if (update.message) {
          handleIncomingMessage(update.message).catch(err => {
            console.error('[TelegramBot] Error handling message:', err.message);
          });
        }
        if (update.callback_query) {
          handleCallbackQuery(update.callback_query).catch(err => {
            console.error('[TelegramBot] Error handling callback query:', err.message);
          });
        }
      }
    }
  } catch (err) {
    console.warn('[TelegramBot] Polling network warning:', err.message);
  }

  if (isPollingActive) {
    // Schedule next poll immediately with a tiny delay
    setTimeout(pollUpdates, 500);
  }
}

function startPolling() {
  if (isPollingActive || !botToken) return;
  isPollingActive = true;
  console.log('[TelegramBot] Starting Telegram long polling...');
  pollUpdates().catch(err => console.error('[TelegramBot] Poll start error:', err));
}

function stopPolling() {
  isPollingActive = false;
  if (pollingAbortController) {
    pollingAbortController.abort();
    pollingAbortController = null;
  }
}

// Scheduled 8:00 AM Cron
function scheduleNext8AM() {
  if (scheduledTimeout) {
    clearTimeout(scheduledTimeout);
    scheduledTimeout = null;
  }

  const ms = msUntilNextWarsaw8AM();
  const hours = (ms / (1000 * 60 * 60)).toFixed(2);
  console.log(`[TelegramBot] Daily 08:00 AM report scheduled in ${hours} hours.`);

  scheduledTimeout = setTimeout(async () => {
    try {
      if (adminChatId) {
        if (!isNotificationEnabled('dailyReport')) {
          console.log('[TelegramBot] Scheduled 08:00 AM daily report skipped (disabled in admin settings).');
        } else {
          console.log('[TelegramBot] Triggering scheduled 08:00 AM daily report...');
          const report = await generateDailyReport({ isToday: false });
          await sendMessage(adminChatId, report);
        }
      } else {
        console.warn('[TelegramBot] 08:00 AM reached, but adminChatId is not set yet. Write to @getQuizSolverbot to bind.');
      }
    } catch (err) {
      console.error('[TelegramBot] Error sending scheduled report:', err.message);
    } finally {
      scheduleNext8AM();
    }
  }, ms);
}

// Initialize Telegram Bot Service
function init() {
  botToken = process.env.TELEGRAM_BOT_TOKEN || botToken;
  adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID ? String(process.env.TELEGRAM_ADMIN_CHAT_ID).trim() : adminChatId;

  loadPersistedState();

  if (!botToken) {
    console.warn('[TelegramBot] TELEGRAM_BOT_TOKEN not provided, Telegram notifications disabled.');
    return;
  }

  startPolling();
  scheduleNext8AM();
  console.log('[TelegramBot] Initialized successfully with bot token.');
}

module.exports = {
  init,
  startPolling,
  stopPolling,
  sendMessage,
  sendAdminAlert,
  notifyPurchase,
  notifySupportMessage,
  notifyBugReport,
  notifyUninstallFeedback,
  generateDailyReport,
  getAdminChatId: () => adminChatId,
  setAdminChatId: persistAdminChatId,
  getSettings: () => ({ ...adminSettings }),
  isNotificationEnabled
};
