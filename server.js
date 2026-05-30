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

const SUPPORTED_LOCALES = [
  { code: 'en', prefix: '', htmlLang: 'en' },
  { code: 'pl', prefix: '/pl', htmlLang: 'pl' },
  { code: 'de', prefix: '/de', htmlLang: 'de' },
  { code: 'es', prefix: '/es', htmlLang: 'es' },
  { code: 'fr', prefix: '/fr', htmlLang: 'fr' },
  { code: 'it', prefix: '/it', htmlLang: 'it' },
  { code: 'uk', prefix: '/uk', htmlLang: 'uk' }
];
const LOCALE_CODES = SUPPORTED_LOCALES.map(locale => locale.code);

const PAGE_SLUGS = {
  home: '',
  dashboard: 'dashboard',
  quiz: 'quiz',
  demo: 'demo',
  credits: 'credits',
  admin: 'admin',
  privacy: 'privacy',
  success: 'success',
  notFound: '404',
  quizSolverAi: 'quiz-solver-ai',
  testportal: 'testportal-quiz-solver',
  moodle: 'moodle-quiz-solver',
  canvas: 'canvas-quiz-solver',
  googleForms: 'google-forms-quiz-solver',
  microsoftForms: 'microsoft-forms-quiz-solver',
  blackboard: 'blackboard-quiz-solver',
  quizlet: 'quizlet-solver',
  socrative: 'socrative-quiz-solver',
  kahoot: 'kahoot-ai-bot',
  quizizz: 'quizizz-solver'
};

function routeRecord(slug) {
  return Object.fromEntries(SUPPORTED_LOCALES.map(locale => {
    if (!slug) return [locale.code, locale.code === 'en' ? '/' : locale.prefix];
    return [locale.code, `${locale.prefix}/${slug}`.replace(/\/+/g, '/')];
  }));
}

const PAGE_ROUTES = Object.fromEntries(
  Object.entries(PAGE_SLUGS).map(([pageKey, slug]) => [pageKey, routeRecord(slug)])
);
PAGE_ROUTES.admin = Object.fromEntries(SUPPORTED_LOCALES.map(locale => [locale.code, '/admin']));

const ANGULAR_ROUTE_PATHS = Array.from(new Set(
  Object.values(PAGE_ROUTES).flatMap(route => Object.values(route))
));

const INDEXED_PAGE_KEYS = [
  'home',
  'quiz',
  'demo',
  'credits',
  'quizSolverAi',
  'testportal',
  'moodle',
  'canvas',
  'googleForms',
  'microsoftForms',
  'blackboard',
  'quizlet',
  'socrative',
  'kahoot',
  'quizizz',
  'privacy'
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

function configuredOrigins() {
  const defaults = [
    PUBLIC_SITE_URL,
    'https://getquizsolver.com',
    'https://www.getquizsolver.com'
  ];
  const configured = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set([...defaults, ...configured])];
}

function allowedOrigins() {
  const configured = configuredOrigins();
  const extensionIds = String(process.env.CHROME_EXTENSION_IDS || process.env.CHROME_EXTENSION_ID || process.env.EXTENSION_ID || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
  for (const id of extensionIds) configured.push(`chrome-extension://${id}`);
  return [...new Set(configured)];
}

function chromeExtensionOriginId(origin = '') {
  const match = String(origin).match(/^chrome-extension:\/\/([a-p]{32})$/i);
  return match ? match[1] : '';
}

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (!IS_PRODUCTION && (origin.includes('localhost') || origin.includes('127.0.0.1'))) return true;
  if (allowedOrigins().includes(origin)) return true;

  const extensionId = chromeExtensionOriginId(origin);
  const allowDevExtensions = process.env.ALLOW_DEV_EXTENSION_ORIGINS === 'true';
  return !!extensionId && allowDevExtensions;
}

function corsBlockedError(origin) {
  const error = new Error(`CORS origin not allowed: ${origin || 'unknown'}`);
  error.status = 403;
  error.type = 'CORS_ORIGIN_BLOCKED';
  error.expose = true;
  return error;
}

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedCorsOrigin(origin)) return callback(null, true);
    if (IS_PRODUCTION) return callback(corsBlockedError(origin));
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

function localeFromPath(routePath = '') {
  const firstSegment = String(routePath).split('/').filter(Boolean)[0];
  return LOCALE_CODES.includes(firstSegment) ? firstSegment : 'en';
}

function routePriority(route) {
  if (Object.values(PAGE_ROUTES.home).includes(route)) return '1.0';
  if (route.includes('kahoot-ai-bot') || route.includes('quiz-solver-ai') || route.includes('testportal-quiz-solver') || route.includes('google-forms-quiz-solver')) return '0.9';
  if (route.includes('privacy')) return '0.4';
  return '0.8';
}

function robotsTxt() {
  const privateRoutes = [
    '/admin',
    ...SUPPORTED_LOCALES.map(locale => PAGE_ROUTES.dashboard[locale.code]),
    ...SUPPORTED_LOCALES.map(locale => PAGE_ROUTES.success[locale.code])
  ];
  return [
    'User-agent: *',
    'Allow: /',
    ...Array.from(new Set(privateRoutes)).map(route => `Disallow: ${route}`),
    '',
    `Sitemap: ${PUBLIC_SITE_URL}/sitemap.xml`,
    ''
  ].join('\n');
}

function sitemapXml() {
  const lastmod = process.env.SITEMAP_LASTMOD || new Date().toISOString().slice(0, 10);
  const urls = INDEXED_PAGE_KEYS
    .flatMap(pageKey => SUPPORTED_LOCALES.map(locale => ({ pageKey, locale, route: PAGE_ROUTES[pageKey][locale.code] })))
    .map(({ pageKey, route }) => {
      const loc = `${PUBLIC_SITE_URL}${route === '/' ? '/' : route}`;
      const alternates = SUPPORTED_LOCALES
        .map(locale => `    <xhtml:link rel="alternate" hreflang="${locale.htmlLang}" href="${PUBLIC_SITE_URL}${PAGE_ROUTES[pageKey][locale.code] === '/' ? '/' : PAGE_ROUTES[pageKey][locale.code]}"/>`)
        .join('\n');
      return [
        '  <url>',
        `    <loc>${loc}</loc>`,
        alternates,
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${PUBLIC_SITE_URL}${PAGE_ROUTES[pageKey].en === '/' ? '/' : PAGE_ROUTES[pageKey].en}"/>`,
        `    <lastmod>${lastmod}</lastmod>`,
        '    <changefreq>weekly</changefreq>',
        `    <priority>${routePriority(route)}</priority>`,
        '  </url>'
      ].join('\n');
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>`;
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
SUPPORTED_LOCALES.filter(locale => locale.code !== 'en').forEach(locale => {
  app.get(`${locale.prefix}/`, (req, res) => res.redirect(301, locale.prefix));
});
app.get('/pricing', (req, res) => res.redirect(301, '/#pricing'));
SUPPORTED_LOCALES.filter(locale => locale.code !== 'en').forEach(locale => {
  app.get(`${locale.prefix}/pricing`, (req, res) => res.redirect(301, `${locale.prefix}#pricing`));
});
app.get('/download', (req, res) => res.redirect(302, CHROME_WEB_STORE_URL));
SUPPORTED_LOCALES.filter(locale => locale.code !== 'en').forEach(locale => {
  app.get(`${locale.prefix}/download`, (req, res) => res.redirect(302, CHROME_WEB_STORE_URL));
});
app.get('/onboarding', (req, res) => res.redirect(301, '/demo'));
SUPPORTED_LOCALES.filter(locale => locale.code !== 'en').forEach(locale => {
  app.get(`${locale.prefix}/onboarding`, (req, res) => res.redirect(301, `${locale.prefix}/demo`));
});
app.get('/ai-quiz-solver', (req, res) => res.redirect(301, '/quiz-solver-ai'));
SUPPORTED_LOCALES.filter(locale => locale.code !== 'en').forEach(locale => {
  app.get(`${locale.prefix}/ai-quiz-solver`, (req, res) => res.redirect(301, `${locale.prefix}/quiz-solver-ai`));
});
app.get('/privacy.html', (req, res) => res.redirect(301, '/privacy'));
app.get('/quiz.html', (req, res) => res.redirect(301, '/quiz'));
app.get('/success.html', (req, res) => res.redirect(301, '/success'));
app.get('/admin.html', (req, res) => res.redirect(301, '/admin'));
app.get('/admin-app.js', (req, res) => res.status(404).json({ error: 'Admin panel is served by Angular.' }));
app.get(SUPPORTED_LOCALES.map(locale => `${locale.prefix}/quiz/shared/:token`.replace(/\/+/g, '/')), (req, res) => {
  const locale = localeFromPath(req.path);
  sendAngularPage(req, res, PAGE_ROUTES.quiz[locale]);
});


if (HAS_ANGULAR_BUILD) {
  app.use(express.static(ANGULAR_BROWSER_DIR, STATIC_OPTIONS));
}

app.use(express.static(path.join(__dirname, 'public'), STATIC_OPTIONS));

app.get(ANGULAR_ROUTE_PATHS, (req, res) => {
  const routePath = req.path;
  const statusCode = routePath.endsWith('/404') || routePath === '/404' ? 404 : 200;
  sendAngularPage(req, res, routePath, statusCode);
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found.' });
  }

  const locale = localeFromPath(req.path);
  sendAngularPage(req, res, PAGE_ROUTES.notFound[locale] || PAGE_ROUTES.notFound.en, 404);
});

app.use((err, req, res, next) => {
  const status = Number(err.status || err.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const isApi = req.path.startsWith('/api/');
  console.error('[Server]', req.method, req.originalUrl, safeStatus, err.type || err.code || 'ERROR', err.message);

  if (IS_PRODUCTION) {
    if (isApi) {
      const canExpose = safeStatus < 500 || err.expose === true;
      return res.status(safeStatus).json({
        error: canExpose ? err.message : 'Server error while processing API request.',
        type: err.type || 'SERVER_ERROR'
      });
    }
    return res.status(safeStatus).json({ error: 'Internal server error.' });
  }
  return res.status(safeStatus).json({ error: err.message, type: err.type });
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
      if (isAllowedCorsOrigin(origin) || !IS_PRODUCTION) return callback(null, true);
      callback(corsBlockedError(origin));
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
