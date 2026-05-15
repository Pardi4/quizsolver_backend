const en = require('../i18n/en.json');
const pl = require('../i18n/pl.json');

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://getquizsolver.com').replace(/\/+$/, '');
const ASSET_VERSION = '2026-05-15';
const CHROME_WEB_STORE_URL = 'https://chromewebstore.google.com/detail/quiz-solver-pro/cjchfdnplpjkihigljnicebnhjkpndik';

const TRANSLATIONS = { en, pl };

const PLATFORM_PAGE_KEYS = [
  'quizSolverAi',
  'testportal',
  'moodle',
  'canvas',
  'googleForms',
  'microsoftForms',
  'kahoot',
  'quizizz'
];

const PAGE_ROUTES = {
  home: {
    en: '/',
    pl: '/pl/'
  },
  dashboard: {
    en: '/dashboard',
    pl: '/pl/dashboard'
  },
  quiz: {
    en: '/quiz',
    pl: '/pl/quiz'
  },
  quizSolverAi: {
    en: '/quiz-solver-ai',
    pl: '/pl/quiz-solver-ai'
  },
  testportal: {
    en: '/testportal-quiz-solver',
    pl: '/pl/testportal-quiz-solver'
  },
  moodle: {
    en: '/moodle-quiz-solver',
    pl: '/pl/moodle-quiz-solver'
  },
  canvas: {
    en: '/canvas-quiz-solver',
    pl: '/pl/canvas-quiz-solver'
  },
  googleForms: {
    en: '/google-forms-quiz-solver',
    pl: '/pl/google-forms-quiz-solver'
  },
  microsoftForms: {
    en: '/microsoft-forms-quiz-solver',
    pl: '/pl/microsoft-forms-quiz-solver'
  },
  kahoot: {
    en: '/kahoot-ai-bot',
    pl: '/pl/kahoot-ai-bot'
  },
  quizizz: {
    en: '/quizizz-solver',
    pl: '/pl/quizizz-solver'
  },
  privacy: {
    en: '/privacy',
    pl: '/pl/privacy'
  },
  notFound: {
    en: '/404',
    pl: '/pl/404'
  },
  success: {
    en: '/success',
    pl: '/pl/success'
  }
};

const MARKETING_ROUTES = [
  { path: '/', pageKey: 'home', locale: 'en' },
  { path: '/pl/', pageKey: 'home', locale: 'pl' },
  ...PLATFORM_PAGE_KEYS.flatMap(pageKey => ([
    { path: PAGE_ROUTES[pageKey].en, pageKey, locale: 'en' },
    { path: PAGE_ROUTES[pageKey].pl, pageKey, locale: 'pl' }
  ]))
];

function content(locale) {
  return TRANSLATIONS[locale] || TRANSLATIONS.en;
}

function pathFor(pageKey, locale) {
  return PAGE_ROUTES[pageKey]?.[locale] || PAGE_ROUTES.home[locale] || '/';
}

function abs(urlPath) {
  return `${SITE_URL}${urlPath}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function pageData(pageKey, locale) {
  const c = content(locale);
  if (pageKey === 'home') return c.home;
  return c.platformPages[pageKey];
}

function platformEntries(locale) {
  const c = content(locale);
  return PLATFORM_PAGE_KEYS
    .map(pageKey => ({ pageKey, data: c.platformPages[pageKey] }))
    .filter(entry => entry.data);
}

function platformLabel(pageKey, locale) {
  const data = pageData(pageKey, locale);
  return data?.shortName || data?.badge || data?.title || pageKey;
}

function localizedQuizPath(locale) {
  return pathFor('quiz', locale);
}

module.exports = {
  ASSET_VERSION,
  CHROME_WEB_STORE_URL,
  MARKETING_ROUTES,
  PAGE_ROUTES,
  PLATFORM_PAGE_KEYS,
  SITE_URL,
  abs,
  content,
  escapeAttr,
  escapeHtml,
  localizedQuizPath,
  pageData,
  pathFor,
  platformEntries,
  platformLabel,
  safeJson
};
