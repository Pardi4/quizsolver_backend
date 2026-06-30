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
const parserRoutes = require('./routes/parser');

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
const BLOG_POSTS_FILE = path.join(__dirname, '..', 'frontend', 'src', 'app', 'blog-posts.json');
const ADMIN_CONFIG_FILE = path.join(__dirname, '..', 'frontend', 'src', 'app', 'admin-config.json');
const ADMIN_PANEL_ROUTE_PATH = readAdminPanelRoutePath();
const ADMIN_PANEL_URL = `/${ADMIN_PANEL_ROUTE_PATH}`;
const LEGACY_ADMIN_PATHS = ['/admin', '/admin/', '/admin.html', '/admin-app.js'];

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
  quizizz: 'quizizz-solver',
  blog: 'blog',
  blogCategory: 'blog/category/:category',
  blogPost: 'blog/:slug'
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

const ANGULAR_CANONICAL_ROUTE_PATHS = Array.from(new Set(
  [
    ...Object.values(PAGE_ROUTES).flatMap(route => Object.values(route)),
    ADMIN_PANEL_URL
  ]
));
const ANGULAR_TRAILING_SLASH_PATHS = ANGULAR_CANONICAL_ROUTE_PATHS
  .filter(route => route !== '/' && !route.endsWith('/'))
  .map(route => `${route}/`);
const ANGULAR_ROUTE_PATHS = Array.from(new Set(
  [
    ...Object.values(PAGE_ROUTES).flatMap(route => Object.values(route).flatMap(pageRoute => (
      pageRoute === '/' ? ['/'] : [pageRoute, `${pageRoute}/`]
    ))),
    ADMIN_PANEL_URL,
    `${ADMIN_PANEL_URL}/`
  ]
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
  'privacy',
  'blog'
];

const STATIC_OPTIONS = {
  index: false,
  redirect: false,
  etag: true,
  maxAge: IS_PRODUCTION ? '30d' : 0,
  setHeaders: (res, filePath) => {
    const normalizedFilePath = String(filePath || '').replace(/\\/g, '/');
    if (normalizedFilePath.includes(`/browser/${ADMIN_PANEL_ROUTE_PATH}/`)) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      return;
    }
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    if (/[\\\/](?:favicon|logo|logo-96|logo-512|logo-wordmark|og-image)\.(?:ico|svg|png|webp|avif)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    }
  }
};

app.set('trust proxy', 1);
connectDB();

function normalizeAdminRoutePath(value) {
  const routePath = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  return /^[a-z0-9][a-z0-9-]{8,80}$/i.test(routePath) ? routePath : 'qs-console-851-c4f9';
}

function readAdminPanelRoutePath() {
  try {
    const config = JSON.parse(fs.readFileSync(ADMIN_CONFIG_FILE, 'utf8'));
    return normalizeAdminRoutePath(config.panelPath);
  } catch {
    return normalizeAdminRoutePath('');
  }
}

function normalizeRequestPath(routePath = '') {
  const normalized = String(routePath || '/').split('?')[0].replace(/\/+$/, '');
  return normalized || '/';
}

function isLegacyAdminPath(routePath = '') {
  const normalized = normalizeRequestPath(routePath);
  return normalized === '/admin' || normalized === '/admin.html' || normalized === '/admin-app.js';
}

function isAdminPanelPath(routePath = '') {
  return normalizeRequestPath(routePath) === ADMIN_PANEL_URL;
}

function routeMatchesPage(routePath = '', pageKey = '') {
  const routes = PAGE_ROUTES[pageKey] ? Object.values(PAGE_ROUTES[pageKey]) : [];
  return routes.includes(normalizeRequestPath(routePath));
}

function redirectAdminPanelTrailingSlash(req, res, next) {
  if (req.path !== `${ADMIN_PANEL_URL}/`) return next();
  const queryIndex = req.originalUrl.indexOf('?');
  const query = queryIndex === -1 ? '' : req.originalUrl.slice(queryIndex);
  return res.redirect(301, `${ADMIN_PANEL_URL}${query}`);
}

function cleanPublicPageUrl(req) {
  if (req.path.startsWith('/api/') || req.path === '/api') return req.originalUrl;
  if (req.path === '/extension-auth/callback') return req.originalUrl;
  if (isLegacyAdminPath(req.path)) return req.originalUrl;

  const queryIndex = req.originalUrl.indexOf('?');
  const rawPath = queryIndex === -1 ? req.originalUrl : req.originalUrl.slice(0, queryIndex);
  const rawQuery = queryIndex === -1 ? '' : req.originalUrl.slice(queryIndex + 1);
  const cleanPath = rawPath !== '/' ? rawPath.replace(/\/+$/, '') || '/' : '/';
  const params = new URLSearchParams(rawQuery);
  const preserveAuthError = params.has('auth') && params.has('error');

  if (preserveAuthError && !params.has('q') && cleanPath === rawPath) {
    return req.originalUrl;
  }

  (preserveAuthError ? ['q'] : ['auth', 'error', 'q']).forEach(key => params.delete(key));
  const cleanQuery = params.toString();
  return `${cleanPath}${cleanQuery ? `?${cleanQuery}` : ''}`;
}

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
  if (!isPublicHost) return next();

  const cleanUrl = cleanPublicPageUrl(req);
  if (
    hostname === `www.${apexHost}`
    || (isPublicHost && forwardedProto && forwardedProto !== 'https')
    || cleanUrl !== req.originalUrl
  ) {
    return res.redirect(301, `https://${apexHost}${cleanUrl}`);
  }

  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
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

  const privateRoute = isAdminPanelPath(routePath) || isLegacyAdminPath(routePath);
  const privatePage = ['dashboard', 'success', 'notFound'].some(pageKey => routeMatchesPage(routePath, pageKey));
  const noStore = privateRoute || privatePage;
  const noindex = privateRoute || privatePage;

  res.status(statusCode);
  if (noindex) res.set('X-Robots-Tag', 'noindex, nofollow');
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
  if (route.includes('/blog/category/')) return '0.75';
  if (route.includes('/blog/')) return '0.7';
  if (route.includes('privacy')) return '0.4';
  return '0.8';
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function blogPosts() {
  try {
    const raw = fs.readFileSync(BLOG_POSTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(post => post && post.slug && post.locale) : [];
  } catch (error) {
    console.warn('[Sitemap] Could not read blog posts:', error.message);
    return [];
  }
}

function blogCategories(posts) {
  return [...new Set(posts.map(post => post.category).filter(Boolean))];
}

function categoryHasPosts(posts, category, locale) {
  return posts.some(post => post.category === category && post.locale === locale.code);
}

function categoryLocales(posts, category) {
  return SUPPORTED_LOCALES.filter(locale => categoryHasPosts(posts, category, locale));
}

function robotsTxt() {
  const privateRoutes = [
    ...SUPPORTED_LOCALES.map(locale => PAGE_ROUTES.dashboard[locale.code]),
    ...SUPPORTED_LOCALES.map(locale => PAGE_ROUTES.success[locale.code]),
    ...SUPPORTED_LOCALES.map(locale => PAGE_ROUTES.notFound[locale.code]),
    ...LEGACY_ADMIN_PATHS,
    '/api',
    '/api/',
    '/extension-auth/'
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
  const pageUrls = INDEXED_PAGE_KEYS
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

  const posts = blogPosts();
  const categoryUrls = blogCategories(posts)
    .flatMap(category => categoryLocales(posts, category).map(locale => ({ category, locale })))
    .map(({ category, locale }) => {
      const route = PAGE_ROUTES.blogCategory[locale.code].replace(':category', category);
      const loc = `${PUBLIC_SITE_URL}${route}`;
      const localesWithCategoryPosts = categoryLocales(posts, category);
      const defaultLocale = localesWithCategoryPosts.find(item => item.code === 'en') || localesWithCategoryPosts[0] || locale;
      const newestPost = posts
        .filter(post => post.category === category && post.locale === locale.code)
        .sort((a, b) => String(b.dateModified || b.datePublished).localeCompare(String(a.dateModified || a.datePublished)))[0];
      const alternates = localesWithCategoryPosts
        .map(item => {
          const candidateRoute = PAGE_ROUTES.blogCategory[item.code].replace(':category', category);
          return `    <xhtml:link rel="alternate" hreflang="${item.htmlLang}" href="${PUBLIC_SITE_URL}${candidateRoute}"/>`;
        })
        .join('\n');
      const defaultRoute = PAGE_ROUTES.blogCategory[defaultLocale.code].replace(':category', category);
      return [
        '  <url>',
        `    <loc>${xmlEscape(loc)}</loc>`,
        alternates,
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(`${PUBLIC_SITE_URL}${defaultRoute}`)}"/>`,
        `    <lastmod>${xmlEscape(newestPost?.dateModified || newestPost?.datePublished || lastmod)}</lastmod>`,
        '    <changefreq>weekly</changefreq>',
        `    <priority>${routePriority(route)}</priority>`,
        '  </url>'
      ].join('\n');
    })
    .join('\n');
  const blogUrls = posts
    .map(post => {
      const route = PAGE_ROUTES.blogPost[post.locale].replace(':slug', post.slug);
      const loc = `${PUBLIC_SITE_URL}${route}`;
      const alternates = posts
        .filter(candidate => candidate.translationKey && candidate.translationKey === post.translationKey)
        .map(candidate => {
          const locale = SUPPORTED_LOCALES.find(item => item.code === candidate.locale);
          if (!locale) return '';
          const candidateRoute = PAGE_ROUTES.blogPost[candidate.locale].replace(':slug', candidate.slug);
          return `    <xhtml:link rel="alternate" hreflang="${locale.htmlLang}" href="${PUBLIC_SITE_URL}${candidateRoute}"/>`;
        })
        .filter(Boolean)
        .join('\n');
      const defaultPost = posts.find(candidate => candidate.translationKey === post.translationKey && candidate.locale === 'en') || post;
      const defaultRoute = PAGE_ROUTES.blogPost[defaultPost.locale].replace(':slug', defaultPost.slug);
      return [
        '  <url>',
        `    <loc>${xmlEscape(loc)}</loc>`,
        alternates,
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(`${PUBLIC_SITE_URL}${defaultRoute}`)}"/>`,
        `    <lastmod>${xmlEscape(post.dateModified || post.datePublished || lastmod)}</lastmod>`,
        '    <changefreq>weekly</changefreq>',
        `    <priority>${routePriority(route)}</priority>`,
        '  </url>'
      ].join('\n');
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${[pageUrls, categoryUrls, blogUrls].filter(Boolean).join('\n')}\n</urlset>`;
}

function extensionAuthCallbackHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>QuizSolver extension login</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#030712;color:#f8fafc;font-family:Inter,Arial,sans-serif}
      main{width:min(420px,calc(100% - 40px));padding:30px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(15,23,42,.92);box-shadow:0 24px 70px rgba(0,0,0,.34);text-align:center}
      .mark{width:48px;height:48px;margin:0 auto 18px;border-radius:14px;background:linear-gradient(135deg,#06b6d4,#8b5cf6);display:grid;place-items:center;font-weight:900}
      h1{margin:0 0 10px;font-size:22px;line-height:1.2}
      p{margin:0;color:#cbd5e1;line-height:1.6}
    </style>
  </head>
  <body>
    <main id="qs-extension-auth">
      <div class="mark">QS</div>
      <h1>Finishing extension sign in...</h1>
      <p>You can close this tab if it does not close automatically.</p>
    </main>
  </body>
</html>`;
}

app.use('/api/webhook', webhookRoutes);
app.use(['/api/parser/event', '/api/credits/report-bug'], express.json({ limit: '6mb' }));
app.use(['/api/quiz/solve', '/api/quiz/solve-batch', '/api/quiz/solve-snapshot'], express.json({ limit: '6mb' }));
app.use(express.json({ limit: '80kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use('/api/', generalLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/quiz', quizPublicRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api/credits', creditsRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/parser', parserRoutes);

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

app.get('/extension-auth/callback', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('html').send(extensionAuthCallbackHtml());
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
app.get(LEGACY_ADMIN_PATHS, (req, res) => {
  const locale = localeFromPath(req.path);
  sendAngularPage(req, res, PAGE_ROUTES.notFound[locale] || PAGE_ROUTES.notFound.en, 404);
});
app.use(redirectAdminPanelTrailingSlash);
app.get(ADMIN_PANEL_URL, (req, res) => {
  sendAngularPage(req, res, ADMIN_PANEL_URL);
});
app.get(SUPPORTED_LOCALES.map(locale => `${locale.prefix}/quiz/shared/:token`.replace(/\/+/g, '/')), (req, res) => {
  const locale = localeFromPath(req.path);
  sendAngularPage(req, res, PAGE_ROUTES.quiz[locale]);
});

app.get(ANGULAR_TRAILING_SLASH_PATHS, (req, res, next) => {
  const queryIndex = req.originalUrl.indexOf('?');
  const pathPart = queryIndex === -1 ? req.originalUrl : req.originalUrl.slice(0, queryIndex);
  if (!pathPart.endsWith('/')) {
    return next();
  }

  const query = queryIndex === -1 ? '' : req.originalUrl.slice(queryIndex);
  res.redirect(301, `${pathPart.replace(/\/+$/, '')}${query}`);
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

  adminApp.get(LEGACY_ADMIN_PATHS, (req, res) => {
    sendAngularPage(req, res, PAGE_ROUTES.notFound.en, 404);
  });
  adminApp.use(redirectAdminPanelTrailingSlash);
  adminApp.get(ADMIN_PANEL_URL, (req, res) => {
    sendAngularPage(req, res, ADMIN_PANEL_URL);
  });
  adminApp.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
    return sendAngularPage(req, res, PAGE_ROUTES.notFound.en, 404);
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
