require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const connectDB = require('./config/db');
const { generalLimiter, adminLimiter } = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth');
const { router: quizRoutes, publicRouter: quizPublicRoutes } = require('./routes/quiz');
const adminRoutes = require('./routes/admin');
const creditsRoutes = require('./routes/credits');
const webhookRoutes = require('./routes/webhook');
const supportRoutes = require('./routes/support');

const User = require('./models/User');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 30583;
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT, 10) || 40583;
const ADMIN_HOST = process.env.ADMIN_HOST || '127.0.0.1';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://getquizsolver.com').replace(/\/+$/, '');
const CHROME_WEB_STORE_URL = 'https://chromewebstore.google.com/detail/quiz-solver-pro/cjchfdnplpjkihigljnicebnhjkpndik';
const ANGULAR_BROWSER_DIR = path.join(__dirname, '..', 'frontend', 'dist', 'angular-web', 'browser');
const ANGULAR_INDEX = path.join(ANGULAR_BROWSER_DIR, 'index.html');
const HAS_ANGULAR_BUILD = fs.existsSync(ANGULAR_INDEX);

const PAGE_ROUTES = {
  home: { en: '/', pl: '/pl' },
  dashboard: { en: '/dashboard', pl: '/pl/dashboard' },
  quiz: { en: '/quiz', pl: '/pl/quiz' },
  demo: { en: '/demo', pl: '/pl/demo' },
  credits: { en: '/credits', pl: '/pl/credits' },
  admin: { en: '/admin', pl: '/admin' },
  privacy: { en: '/privacy', pl: '/pl/privacy' },
  success: { en: '/success', pl: '/pl/success' },
  notFound: { en: '/404', pl: '/pl/404' },
  quizSolverAi: { en: '/quiz-solver-ai', pl: '/pl/quiz-solver-ai' },
  testportal: { en: '/testportal-quiz-solver', pl: '/pl/testportal-quiz-solver' },
  moodle: { en: '/moodle-quiz-solver', pl: '/pl/moodle-quiz-solver' },
  canvas: { en: '/canvas-quiz-solver', pl: '/pl/canvas-quiz-solver' },
  googleForms: { en: '/google-forms-quiz-solver', pl: '/pl/google-forms-quiz-solver' },
  microsoftForms: { en: '/microsoft-forms-quiz-solver', pl: '/pl/microsoft-forms-quiz-solver' },
  blackboard: { en: '/blackboard-quiz-solver', pl: '/pl/blackboard-quiz-solver' },
  quizlet: { en: '/quizlet-solver', pl: '/pl/quizlet-solver' },
  socrative: { en: '/socrative-quiz-solver', pl: '/pl/socrative-quiz-solver' },
  kahoot: { en: '/kahoot-ai-bot', pl: '/pl/kahoot-ai-bot' },
  quizizz: { en: '/quizizz-solver', pl: '/pl/quizizz-solver' }
};

const ANGULAR_ROUTE_PATHS = Array.from(new Set(
  Object.values(PAGE_ROUTES).flatMap(route => Object.values(route))
));

const INDEXED_ROUTES = [
  PAGE_ROUTES.home.en,
  PAGE_ROUTES.home.pl,
  PAGE_ROUTES.quiz.en,
  PAGE_ROUTES.quiz.pl,
  PAGE_ROUTES.demo.en,
  PAGE_ROUTES.demo.pl,
  PAGE_ROUTES.credits.en,
  PAGE_ROUTES.credits.pl,
  PAGE_ROUTES.quizSolverAi.en,
  PAGE_ROUTES.quizSolverAi.pl,
  PAGE_ROUTES.testportal.en,
  PAGE_ROUTES.testportal.pl,
  PAGE_ROUTES.moodle.en,
  PAGE_ROUTES.moodle.pl,
  PAGE_ROUTES.canvas.en,
  PAGE_ROUTES.canvas.pl,
  PAGE_ROUTES.googleForms.en,
  PAGE_ROUTES.googleForms.pl,
  PAGE_ROUTES.microsoftForms.en,
  PAGE_ROUTES.microsoftForms.pl,
  PAGE_ROUTES.blackboard.en,
  PAGE_ROUTES.blackboard.pl,
  PAGE_ROUTES.quizlet.en,
  PAGE_ROUTES.quizlet.pl,
  PAGE_ROUTES.socrative.en,
  PAGE_ROUTES.socrative.pl,
  PAGE_ROUTES.kahoot.en,
  PAGE_ROUTES.kahoot.pl,
  PAGE_ROUTES.quizizz.en,
  PAGE_ROUTES.quizizz.pl,
  PAGE_ROUTES.privacy.en,
  PAGE_ROUTES.privacy.pl
];

const STATIC_OPTIONS = {
  index: false,
  etag: true,
  maxAge: IS_PRODUCTION ? '30d' : 0,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
};

app.set('trust proxy', 1);
connectDB();

app.use((req, res, next) => {
  if (!IS_PRODUCTION) return next();
  if (process.env.DISABLE_HTTPS_REDIRECT === 'true') return next();

  const host = req.get('host') || '';
  const hostname = host.split(':')[0].toLowerCase();
  
  let proto = req.headers['x-forwarded-proto'] || req.protocol || '';
  if (req.headers['cf-visitor']) {
    try {
      const cfVisitor = JSON.parse(req.headers['cf-visitor']);
      if (cfVisitor && cfVisitor.scheme) {
        proto = cfVisitor.scheme;
      }
    } catch (e) {}
  }
  const forwardedProto = String(proto).split(',')[0].trim();
  
  const apexHost = 'getquizsolver.com';
  const isLocalHost = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(hostname);
  const isPublicHost = hostname === apexHost || hostname === `www.${apexHost}`;

  if (isLocalHost) return next();

  if (hostname === `www.${apexHost}` || (isPublicHost && forwardedProto && forwardedProto !== 'https')) {
    return res.redirect(301, `https://${apexHost}${req.originalUrl}`);
  }

  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      // Angular prerender output contains inline hydration scripts and a CSS onload handler.
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  xFrameOptions: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: IS_PRODUCTION ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  } : false
}));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.startsWith('chrome-extension://')) return callback(null, true);
    if (!IS_PRODUCTION && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return callback(null, true);
    }

    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.includes(origin)) return callback(null, true);
    if (IS_PRODUCTION) return callback(new Error('CORS: origin not allowed'));
    return callback(null, true);
  },
  credentials: true
}));

function angularIndexPath(routePath) {
  const cleanPath = routePath.replace(/^\/+/, '').replace(/\/+$/, '');
  return cleanPath ? path.join(ANGULAR_BROWSER_DIR, cleanPath, 'index.html') : ANGULAR_INDEX;
}

const routeFileCache = new Map();

async function sendAngularPage(req, res, routePath = req.path, statusCode = 200) {
  if (!HAS_ANGULAR_BUILD) {
    res.status(503).type('html').send([
      '<!doctype html><html><head><meta charset="utf-8"><title>QuizSolver</title></head>',
      '<body style="font-family:system-ui;background:#0f0f1a;color:#f0f0f5;padding:40px">',
      '<h1>Angular build missing</h1>',
      '<p>Run <code>npm run build:web</code> from the backend directory and restart the server.</p>',
      '</body></html>'
    ].join(''));
    return true;
  }

  const routeFile = angularIndexPath(routePath);
  let filePath = ANGULAR_INDEX;

  if (routeFileCache.has(routeFile)) {
    filePath = routeFileCache.get(routeFile) ? routeFile : ANGULAR_INDEX;
  } else {
    try {
      await fs.promises.access(routeFile, fs.constants.R_OK);
      routeFileCache.set(routeFile, true);
      filePath = routeFile;
    } catch {
      routeFileCache.set(routeFile, false);
      filePath = ANGULAR_INDEX;
    }
  }

  const noStore = /(?:dashboard|success|404|admin|quiz|credits)/.test(routePath);

  res.status(statusCode);
  res.set('Cache-Control', noStore ? 'no-store' : 'public, max-age=300, stale-while-revalidate=86400');
  res.sendFile(filePath);
  return true;
}

function robotsTxt() {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /dashboard',
    'Disallow: /pl/dashboard',
    '',
    `Sitemap: ${PUBLIC_SITE_URL}/sitemap.xml`,
    ''
  ].join('\n');
}

function sitemapXml() {
  const urls = INDEXED_ROUTES
    .map(route => {
      const loc = `${PUBLIC_SITE_URL}${route === '/' ? '/' : route}`;
      return `  <url><loc>${loc}</loc><changefreq>weekly</changefreq><priority>${route === '/' || route === '/pl' ? '1.0' : '0.8'}</priority></url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

app.use('/api/webhook', webhookRoutes);
app.use(['/api/quiz/solve', '/api/quiz/solve-batch', '/api/quiz/solve-snapshot'], express.json({ limit: '6mb' }));
app.use(express.json({ limit: '80kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use('/api/', generalLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/quiz', quizPublicRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/credits', creditsRoutes);
app.use('/api/support', supportRoutes);

app.get('/api/stats/public', async (req, res) => {
  try {
    const [totalUsers, totalQuestions] = await Promise.all([
      User.countDocuments({ isBanned: { $ne: true } }),
      User.aggregate([
        { $group: { _id: null, total: { $sum: '$stats.totalQuestionsSolved' } } }
      ])
    ]);

    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      success: true,
      totalUsers: totalUsers || 0,
      totalQuestionsSolved: totalQuestions[0]?.total || 0
    });
  } catch {
    res.json({ success: true, totalUsers: 0, totalQuestionsSolved: 0 });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() });
});

app.get('/robots.txt', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(robotsTxt());
});

app.get('/sitemap.xml', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').send(sitemapXml());
});

app.get('/index.html', (req, res) => res.redirect(301, '/'));
app.get('/pl/', (req, res) => sendAngularPage(req, res, '/pl'));
app.get('/pricing', (req, res) => res.redirect(301, '/#pricing'));
app.get('/pl/pricing', (req, res) => res.redirect(301, '/pl/#pricing'));
app.get('/download', (req, res) => res.redirect(302, CHROME_WEB_STORE_URL));
app.get('/pl/download', (req, res) => res.redirect(302, CHROME_WEB_STORE_URL));
app.get('/onboarding', (req, res) => res.redirect(301, '/demo'));
app.get('/pl/onboarding', (req, res) => res.redirect(301, '/pl/demo'));
app.get('/ai-quiz-solver', (req, res) => res.redirect(301, '/quiz-solver-ai'));
app.get('/pl/ai-quiz-solver', (req, res) => res.redirect(301, '/pl/quiz-solver-ai'));
app.get('/privacy.html', (req, res) => res.redirect(301, '/privacy'));
app.get('/quiz.html', (req, res) => res.redirect(301, '/quiz'));
app.get('/success.html', (req, res) => res.redirect(301, '/success'));
app.get('/admin.html', (req, res) => res.redirect(301, '/admin'));
app.get('/admin-app.js', (req, res) => res.status(404).json({ error: 'Admin panel is served by Angular.' }));
app.get('/quiz/shared/:token', (req, res) => sendAngularPage(req, res, '/quiz'));


if (HAS_ANGULAR_BUILD) {
  app.use(express.static(ANGULAR_BROWSER_DIR, STATIC_OPTIONS));
}

app.use(express.static(path.join(__dirname, 'public'), STATIC_OPTIONS));

app.get(ANGULAR_ROUTE_PATHS, (req, res) => {
  const routePath = req.path === '/pl/' ? '/pl' : req.path;
  const statusCode = routePath.endsWith('/404') || routePath === '/404' ? 404 : 200;
  sendAngularPage(req, res, routePath, statusCode);
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found.' });
  }

  const locale = req.path.startsWith('/pl/') || req.path === '/pl' ? 'pl' : 'en';
  sendAngularPage(req, res, locale === 'pl' ? '/pl/404' : '/404', 404);
});

app.use((err, req, res, next) => {
  if (IS_PRODUCTION) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
  console.error('[Server]', err.message);
  return res.status(500).json({ error: err.message });
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
        role: 'admin',
        authProviders: ['password'],
        emailVerified: true
      });
      await admin.save();
      console.log(`[Server] Admin created: ${adminEmail}`);
    }
  } catch (error) {
    if (error.code !== 11000) console.error('[Server] Admin seed error:', error.message);
  }
}

function createAdminServer() {
  const adminApp = express();
  adminApp.set('trust proxy', 1);
  adminApp.use(helmet({ contentSecurityPolicy: false }));
  adminApp.use(cors({
    origin: (origin, callback) => {
      if (!origin || !IS_PRODUCTION) return callback(null, true);
      const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
      if (allowed.includes(origin)) return callback(null, true);
      callback(new Error('CORS blocked'));
    },
    credentials: true
  }));

  adminApp.use(adminLimiter);
  adminApp.use(express.json({ limit: '80kb' }));
  adminApp.use('/api/auth', authRoutes);
  adminApp.use('/api/admin', adminRoutes);
  adminApp.use('/api/credits', creditsRoutes);
  adminApp.use('/api/support', supportRoutes);

  if (HAS_ANGULAR_BUILD) {
    adminApp.use(express.static(ANGULAR_BROWSER_DIR, STATIC_OPTIONS));
  }
  adminApp.use(express.static(path.join(__dirname, 'public'), STATIC_OPTIONS));

  adminApp.get(['/', '/admin'], (req, res) => sendAngularPage(req, res, '/admin'));
  adminApp.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
    return sendAngularPage(req, res, '/admin', 404);
  });

  return adminApp;
}

app.listen(PORT, HOST, async () => {
  console.log(`[Server] QuizSolver v2.0 | ${HOST}:${PORT} | Angular: ${HAS_ANGULAR_BUILD ? 'ready' : 'missing'} | env: ${process.env.NODE_ENV || 'development'}`);
  await seedAdmin();

  createAdminServer().listen(ADMIN_PORT, ADMIN_HOST, () => {
    console.log(`[Server] Admin panel on ${ADMIN_HOST}:${ADMIN_PORT}`);
  });
});

module.exports = app;
