require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const connectDB = require('./config/db');
const { generalLimiter, adminLimiter } = require('./middleware/rateLimiter');
const {
  getMarketingRoutes,
  getRobotsTxt,
  getSitemapXml,
  renderMarketingPage
} = require('./marketing/render');

const authRoutes = require('./routes/auth');
const quizRoutes = require('./routes/quiz');
const adminRoutes = require('./routes/admin');
const creditsRoutes = require('./routes/credits');
const webhookRoutes = require('./routes/webhook');

const User = require('./models/User');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 30583;
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT, 10) || 40583;
const ADMIN_HOST = process.env.ADMIN_HOST || '127.0.0.1';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

connectDB();

app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  xFrameOptions: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const extId = process.env.EXTENSION_ID;
    if (extId && origin === `chrome-extension://${extId}`) {
      return callback(null, true);
    }

    if (!IS_PRODUCTION) {
      if (origin.startsWith('chrome-extension://')) return callback(null, true);
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) return callback(null, true);
    }

    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.includes(origin)) return callback(null, true);

    if (IS_PRODUCTION) {
      return callback(new Error('CORS: origin not allowed'));
    }

    callback(null, true);
  },
  credentials: true
}));

app.use('/api/webhook', webhookRoutes);

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

app.use('/api/', generalLimiter);

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(getRobotsTxt());
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(getSitemapXml());
});

app.get('/index.html', (req, res) => {
  res.redirect(301, '/');
});

app.get('/pl', (req, res) => {
  res.redirect(301, '/pl/');
});

app.get('/ai-quiz-solver', (req, res) => {
  res.redirect(301, '/quiz-solver-ai');
});

app.get('/pl/ai-quiz-solver', (req, res) => {
  res.redirect(301, '/pl/quiz-solver-ai');
});

app.get('/pricing', (req, res) => {
  res.redirect(301, '/#pricing');
});

app.get('/download', (req, res) => {
  res.redirect(301, '/#pricing');
});

app.get('/pl/pricing', (req, res) => {
  res.redirect(301, '/pl/#pricing');
});

app.get('/pl/download', (req, res) => {
  res.redirect(301, '/pl/#pricing');
});

getMarketingRoutes().forEach(({ path: routePath, pageKey, locale }) => {
  app.get(routePath, (req, res) => {
    if (req.query.lang === 'pl') {
      return res.redirect(301, locale === 'pl' ? routePath : `/pl${routePath === '/' ? '/' : routePath}`);
    }
    res.set('Content-Language', locale);
    res.type('html').send(renderMarketingPage({
      pageKey,
      locale,
      nonce: res.locals.cspNonce
    }));
  });
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use('/api/auth', authRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/credits', creditsRoutes);

app.get('/api/leaderboard', async (req, res) => {
  try {
    const User = require('./models/User');
    const users = await User.find({
      excludeFromLeaderboard: { $ne: true },
      isBanned: { $ne: true },
      role: { $ne: 'admin' }
    })
      .sort({ 'stats.totalQuestionsSolved': -1 })
      .limit(10)
      .select('email stats.totalQuestionsSolved streak');
    const leaderboard = users.map((u, i) => ({
      rank: i + 1,
      name: u.getLeaderboardName(),
      questionsSolved: u.stats.totalQuestionsSolved,
      streak: u.streak.current
    }));
    res.json({ success: true, leaderboard });
  } catch { res.json({ success: true, leaderboard: [] }); }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() });
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get('/pl/privacy', (req, res) => {
  res.redirect(301, '/privacy');
});

app.get('/privacy.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get('/quiz', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quiz.html'));
});

app.get('/quiz.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quiz.html'));
});

app.get('/pl/quiz', (req, res) => {
  res.redirect(302, '/quiz');
});

app.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

if (!IS_PRODUCTION) {
  app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

app.use((err, req, res, next) => {
  if (IS_PRODUCTION) {
    res.status(500).json({ error: 'Internal server error.' });
  } else {
    console.error('[Server]', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function seedAdmin() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminEmail || !adminPassword) return;

    const existing = await User.findOne({ email: adminEmail });
    if (!existing) {
      const admin = new User({
        email: adminEmail,
        passwordHash: adminPassword,
        displayName: 'Administrator',
        role: 'admin'
      });
      await admin.save();
      console.log(`[Server] Admin created: ${adminEmail}`);
    }
  } catch (error) {
    if (error.code !== 11000) {
      console.error('[Server] Admin seed error:', error.message);
    }
  }
}

function startAdminServer() {
  const adminApp = express();
  adminApp.set('trust proxy', 1);

  adminApp.use(helmet({ contentSecurityPolicy: false }));

  adminApp.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (!IS_PRODUCTION) return callback(null, true);
      if (origin === `http://127.0.0.1:${ADMIN_PORT}` || origin === `http://localhost:${ADMIN_PORT}`) {
        return callback(null, true);
      }
      const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
      if (allowed.includes(origin)) return callback(null, true);
      callback(new Error('CORS blocked'));
    },
    credentials: true
  }));

  adminApp.use(adminLimiter);

  adminApp.use(express.static(path.join(__dirname, 'public'), { index: false }));

  adminApp.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  });

  adminApp.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  });

  adminApp.use(express.json({ limit: '10kb' }));
  adminApp.use('/api/auth', authRoutes);
  adminApp.use('/api/admin', adminRoutes);
  adminApp.use('/api/credits', creditsRoutes);

  adminApp.use((req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  adminApp.listen(ADMIN_PORT, ADMIN_HOST, () => {
    console.log(`[Server] Admin panel on ${ADMIN_HOST}:${ADMIN_PORT}`);
  });
}

app.listen(PORT, HOST, async () => {
  console.log(`[Server] QuizSolver v2.0 | ${HOST}:${PORT} | env: ${process.env.NODE_ENV || 'development'}`);
  await seedAdmin();
  startAdminServer();
});

module.exports = app;
