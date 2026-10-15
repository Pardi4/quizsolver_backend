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

// Load persisted adminChatId from disk if not set in environment
function loadPersistedState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (data?.adminChatId && !adminChatId) {
        adminChatId = String(data.adminChatId).trim();
        console.log(`[TelegramBot] Loaded persisted adminChatId: ${adminChatId}`);
      }
    }
  } catch (err) {
    console.warn('[TelegramBot] Could not read telegram_state.json:', err.message);
  }
}

function persistAdminChatId(id) {
  try {
    adminChatId = String(id).trim();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ adminChatId, boundAt: new Date().toISOString() }, null, 2), 'utf8');
    console.log(`[TelegramBot] Persisted adminChatId: ${adminChatId}`);
  } catch (err) {
    console.warn('[TelegramBot] Failed to persist telegram_state.json:', err.message);
  }
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

// Handler for incoming messages from Telegram users
async function handleIncomingMessage(msg) {
  if (!msg || !msg.chat) return;
  const chatId = String(msg.chat.id);
  const text = String(msg.text || '').trim();
  const senderName = msg.from?.first_name || msg.from?.username || 'Użytkownik';
  const adminPassword = String(process.env.ADMIN_PASSWORD || 'Admin123!').trim();

  const isCurrentAdmin = adminChatId && chatId === adminChatId;
  const claimsAdmin = text === adminPassword
    || text === `/start ${adminPassword}`
    || text.startsWith('/admin')
    || text.startsWith('/login');

  // Case 1: First-time setup - admin has not bound their chat yet
  if (!adminChatId && text === '/start') {
    const promptMsg = `
Cześć, ${senderName}! 👋 Jestem oficjalnym botem <b>QuizSolver</b>.

👑 <b>Jesteś administratorem?</b>
Wyślij mi hasło administratora (<code>${adminPassword}</code> lub <code>/admin ${adminPassword}</code>), aby powiązać ten czat z codziennymi raportami o <b>08:00 rano</b>.

🚀 <b>Szukasz rozszerzenia do testów i quizów?</b>
Odwiedź naszą stronę: https://getquizsolver.com
`.trim();
    await sendMessage(chatId, promptMsg);
    return;
  }

  // Case 2: Message claims or confirms admin privileges with password
  if (claimsAdmin) {
    const passwordAttempt = text.replace(/^\/(?:start|admin|login)\s*/i, '').trim();
    if (passwordAttempt === adminPassword || text === adminPassword || !adminChatId) {
      persistAdminChatId(chatId);
      const greeting = `
👑 <b>Witaj, ${senderName}!</b>
Twój czat został pomyślnie powiązany jako <b>Główny Administrator QuizSolver</b>.

Od teraz codziennie o <b>08:00 rano</b> będziesz otrzymywać tutaj automatyczne podsumowanie dnia.

<b>Dostępne komendy:</b>
• <code>/raport</code> — natychmiastowy raport za dzień wczorajszy
• <code>/dzis</code> — raport z dzisiejszego dnia do tej chwili
• <code>/pomoc</code> — lista dostępnych funkcji
`.trim();
      await sendMessage(chatId, greeting);
      // Immediately send test report for verification
      const report = await generateDailyReport({ isToday: false });
      await sendMessage(chatId, report);
      return;
    }
  }

  // Case 2: Verified Admin executing commands
  if (isCurrentAdmin) {
    const cmd = text.toLowerCase().split(' ')[0];
    if (cmd === '/raport' || cmd === '/report') {
      await sendMessage(chatId, '⏳ Generuję raport za wczorajszy dzień...');
      const report = await generateDailyReport({ isToday: false });
      await sendMessage(chatId, report);
      return;
    }

    if (cmd === '/dzis' || cmd === '/today') {
      await sendMessage(chatId, '⏳ Generuję statystyki z dzisiejszego dnia...');
      const report = await generateDailyReport({ isToday: true });
      await sendMessage(chatId, report);
      return;
    }

    if (cmd === '/pomoc' || cmd === '/help' || cmd === '/start') {
      const helpMsg = `
👋 <b>Panel Bota QuizSolver (Admin)</b>

Wybierz polecenie:
• <code>/raport</code> — generuje i wysyła pełne podsumowanie dnia wczorajszego
• <code>/dzis</code> — bieżące podsumowanie dnia dzisiejszego
• <code>/pomoc</code> — wyświetla tę pomoc

Codzienny raport przychodzi automatycznie o <b>08:00 rano</b>.
`.trim();
      await sendMessage(chatId, helpMsg);
      return;
    }

    // Default response for admin chatting
    await sendMessage(chatId, 'Cześć Adminie! Wpisz <code>/raport</code> lub <code>/dzis</code>, aby wyświetlić statystyki.');
    return;
  }

  // Case 3: ANY OTHER USER WRITING TO THE BOT
  // As requested: "tylko jak ktos inny napisze do bota to zeby mu link do strony dawal"
  const publicReply = `
Cześć, ${senderName}! 👋 Jestem oficjalnym asystentem <b>QuizSolver</b>.

Szukasz automatycznego rozwiązywania quizów i testów online w czasie rzeczywistym z pomocą AI (Testportal, Kahoot, Google Forms, Moodle, Canvas i wiele innych)?

👉 <b>Zainstaluj oficjalne rozszerzenie do przeglądarki:</b>
https://getquizsolver.com 🚀
`.trim();

  await sendMessage(chatId, publicReply);
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
        console.log('[TelegramBot] Triggering scheduled 08:00 AM daily report...');
        const report = await generateDailyReport({ isToday: false });
        await sendMessage(adminChatId, report);
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
  generateDailyReport,
  getAdminChatId: () => adminChatId,
  setAdminChatId: persistAdminChatId
};
