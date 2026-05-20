import en from '../../../i18n/en.json';
import pl from '../../../i18n/pl.json';

export type Locale = 'en' | 'pl';
export type PageKey =
  | 'home'
  | 'dashboard'
  | 'quiz'
  | 'quizSolverAi'
  | 'testportal'
  | 'moodle'
  | 'canvas'
  | 'googleForms'
  | 'microsoftForms'
  | 'blackboard'
  | 'quizlet'
  | 'socrative'
  | 'kahoot'
  | 'quizizz'
  | 'privacy'
  | 'notFound'
  | 'success';

export type SiteCopy = Record<string, any>;

export const SITE_URL = 'https://getquizsolver.com';
export const CHROME_WEB_STORE_URL =
  'https://chromewebstore.google.com/detail/quiz-solver-pro/cjchfdnplpjkihigljnicebnhjkpndik';

export const CONTENT: Record<Locale, SiteCopy> = {
  en: en as SiteCopy,
  pl: pl as SiteCopy
};

export const PLATFORM_PAGE_KEYS: PageKey[] = [
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
  'quizizz'
];

export const PAGE_ROUTES: Record<PageKey, Record<Locale, string>> = {
  home: { en: '/', pl: '/pl/' },
  dashboard: { en: '/dashboard', pl: '/pl/dashboard' },
  quiz: { en: '/quiz', pl: '/pl/quiz' },
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
  quizizz: { en: '/quizizz-solver', pl: '/pl/quizizz-solver' },
  privacy: { en: '/privacy', pl: '/pl/privacy' },
  notFound: { en: '/404', pl: '/pl/404' },
  success: { en: '/success', pl: '/pl/success' }
};

export const INDEXED_PAGE_KEYS: PageKey[] = [
  'home',
  'quiz',
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

export function contentFor(locale: Locale): SiteCopy {
  return CONTENT[locale] || CONTENT.en;
}

export function pathFor(pageKey: PageKey, locale: Locale): string {
  return PAGE_ROUTES[pageKey]?.[locale] || PAGE_ROUTES.home[locale];
}

export function abs(path: string): string {
  return `${SITE_URL}${path}`;
}

export function pageData(pageKey: PageKey, locale: Locale): any {
  const copy = contentFor(locale);
  if (pageKey === 'home') return copy['home'];
  if (pageKey === 'privacy') return copy['privacyPage'];
  if (pageKey === 'dashboard') return copy['dashboardPage'];
  if (pageKey === 'quiz') return copy['quizPage'];
  if (pageKey === 'success') return copy['successPage'];
  if (pageKey === 'notFound') return copy['notFoundPage'];
  return copy['platformPages']?.[pageKey];
}

export function platformEntries(locale: Locale): Array<{ pageKey: PageKey; data: any }> {
  const copy = contentFor(locale);
  return PLATFORM_PAGE_KEYS
    .map((pageKey) => ({ pageKey, data: copy['platformPages']?.[pageKey] }))
    .filter((entry) => !!entry.data);
}

export function routePathsForPrerender(): string[] {
  return Object.values(PAGE_ROUTES)
    .flatMap((localized) => [localized.en, localized.pl])
    .map((path) => path.replace(/^\/+/, '').replace(/\/+$/, ''))
    .map((path) => path || '');
}
