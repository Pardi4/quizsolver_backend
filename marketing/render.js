const en = require('../i18n/en.json');
const pl = require('../i18n/pl.json');

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://getquizsolver.com').replace(/\/+$/, '');
const ASSET_VERSION = '2026-05-14';

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
    pl: '/privacy'
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
  if (pageKey === 'home') {
    return c.home;
  }
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

function renderHead({ pageKey, locale, nonce }) {
  const c = content(locale);
  const data = pageData(pageKey, locale);
  const meta = data.meta;
  const canonical = abs(pathFor(pageKey, locale));
  const alternateEn = abs(pathFor(pageKey, 'en'));
  const alternatePl = abs(pathFor(pageKey, 'pl'));
  const jsonLd = buildJsonLd({ pageKey, locale, data, meta, canonical });

  return `
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(meta.title)}</title>
  <meta name="description" content="${escapeAttr(meta.description)}">
  <meta name="keywords" content="${escapeAttr(meta.keywords)}">
  <meta name="author" content="QuizSolver">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="#6c3dff">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="en" href="${alternateEn}">
  <link rel="alternate" hreflang="pl" href="${alternatePl}">
  <link rel="alternate" hreflang="x-default" href="${alternateEn}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="QuizSolver">
  <meta property="og:url" content="${canonical}">
  <meta property="og:title" content="${escapeAttr(meta.title)}">
  <meta property="og:description" content="${escapeAttr(meta.description)}">
  <meta property="og:image" content="${abs('/og-image.svg')}">
  <meta property="og:image:alt" content="QuizSolver AI quiz solver browser extension preview">
  <meta property="og:locale" content="${c.ogLocale}">
  <meta property="og:locale:alternate" content="${locale === 'pl' ? 'en_US' : 'pl_PL'}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(meta.title)}">
  <meta name="twitter:description" content="${escapeAttr(meta.description)}">
  <meta name="twitter:image" content="${abs('/og-image.svg')}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/site.css?v=${ASSET_VERSION}">
  <script type="application/ld+json" nonce="${escapeAttr(nonce || '')}">${safeJson(jsonLd)}</script>`;
}

function buildJsonLd({ pageKey, locale, data, meta, canonical }) {
  const homeUrl = abs('/');
  const c = content(locale);
  const graph = [
    {
      '@type': 'Organization',
      '@id': `${homeUrl}#organization`,
      name: 'QuizSolver',
      url: homeUrl,
      logo: abs('/og-image.svg'),
      contactPoint: {
        '@type': 'ContactPoint',
        email: 'support@getquizsolver.com',
        contactType: 'customer support',
        availableLanguage: ['English', 'Polish']
      }
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${homeUrl}#software`,
      name: 'QuizSolver',
      applicationCategory: 'BrowserApplication',
      operatingSystem: 'Chrome, Chromium',
      url: homeUrl,
      inLanguage: ['en', 'pl'],
      description: meta.description,
      creator: { '@id': `${homeUrl}#organization` },
      offers: [
        { '@type': 'Offer', name: 'Starter', price: '1.99', priceCurrency: 'USD' },
        { '@type': 'Offer', name: 'Popular', price: '4.99', priceCurrency: 'USD' },
        { '@type': 'Offer', name: 'Pro', price: '9.99', priceCurrency: 'USD' }
      ]
    },
    {
      '@type': 'WebSite',
      '@id': `${homeUrl}#website`,
      name: 'QuizSolver',
      url: homeUrl,
      publisher: { '@id': `${homeUrl}#organization` },
      inLanguage: ['en', 'pl']
    },
    {
      '@type': 'WebPage',
      '@id': `${canonical}#webpage`,
      url: canonical,
      name: meta.title,
      description: meta.description,
      isPartOf: { '@id': `${homeUrl}#website` },
      about: { '@id': `${homeUrl}#software` },
      inLanguage: locale
    }
  ];

  if (pageKey !== 'home') {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'QuizSolver', item: homeUrl },
        { '@type': 'ListItem', position: 2, name: data.title, item: canonical }
      ]
    });

    if (Array.isArray(data.steps) && data.steps.length) {
      graph.push({
        '@type': 'HowTo',
        '@id': `${canonical}#howto`,
        name: data.stepsTitle || data.title,
        description: data.subtitle,
        totalTime: 'PT3M',
        step: data.steps.map((step, index) => ({
          '@type': 'HowToStep',
          position: index + 1,
          text: step
        }))
      });
    }
  }

  if (pageKey === 'home' && c.home.platforms?.items?.length) {
    graph.push({
      '@type': 'ItemList',
      '@id': `${canonical}#supported-platforms`,
      name: c.home.platforms.title,
      itemListElement: c.home.platforms.items.map((name, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name
      }))
    });
  }

  if (Array.isArray(data.faq) && data.faq.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonical}#faq`,
      mainEntity: data.faq.map(item => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer
        }
      }))
    });
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph
  };
}

function renderNav(pageKey, locale) {
  const c = content(locale);
  const home = pathFor('home', locale);
  const navLinks = [
    { href: `${home}#how-it-works`, label: c.nav.how },
    { href: `${home}#features`, label: c.nav.features },
    { href: `${home}#platforms`, label: c.nav.platforms },
    { href: `${home}#pricing`, label: c.nav.pricing },
    { href: '/quiz', label: c.nav.study },
    { href: pathFor('quizSolverAi', locale), label: platformLabel('quizSolverAi', locale), page: 'quizSolverAi' },
    { href: pathFor('testportal', locale), label: platformLabel('testportal', locale), page: 'testportal' },
    { href: pathFor('moodle', locale), label: platformLabel('moodle', locale), page: 'moodle' }
  ];

  const links = navLinks.map(link => {
    const active = link.page && link.page === pageKey ? ' aria-current="page"' : '';
    return `<a href="${escapeAttr(link.href)}" class="nav-link"${active}>${escapeHtml(link.label)}</a>`;
  }).join('');

  return `
  <nav class="navbar" id="navbar" aria-label="Primary navigation">
    <div class="nav-container">
      <a href="${pathFor('home', locale)}" class="nav-logo" aria-label="QuizSolver home">
        <span class="logo-icon" aria-hidden="true">QS</span>
        <span class="logo-text">QuizSolver</span>
      </a>
      <div class="nav-links" id="nav-links">${links}</div>
      <div class="nav-actions">
        <div class="nav-lang-switch" role="group" aria-label="Language">
          <a class="lang-btn ${locale === 'en' ? 'active' : ''}" href="${pathFor(pageKey, 'en')}" hreflang="en" aria-pressed="${locale === 'en'}">EN</a>
          <a class="lang-btn ${locale === 'pl' ? 'active' : ''}" href="${pathFor(pageKey, 'pl')}" hreflang="pl" aria-pressed="${locale === 'pl'}">PL</a>
        </div>
        <div id="nav-guest">
          <button class="btn-ghost" id="nav-login-btn">${escapeHtml(c.nav.login)}</button>
          <button class="btn-primary btn-sm" id="nav-register-btn">${escapeHtml(c.nav.signup)}</button>
        </div>
        <div id="nav-user" class="nav-user hidden">
          <div class="nav-credits" aria-label="${escapeAttr(c.common.credits)}">
            <span class="credits-icon" aria-hidden="true">C</span>
            <span id="nav-credits-count">0</span>
          </div>
          <div class="nav-avatar-wrap" id="nav-avatar-wrap">
            <div class="nav-avatar" id="nav-avatar">U</div>
            <div class="nav-dropdown" id="nav-dropdown">
              <div class="dropdown-header">
                <span id="dropdown-name">User</span>
                <span id="dropdown-email" class="dropdown-email">user@email.com</span>
              </div>
              <div class="dropdown-divider"></div>
              <button class="dropdown-item" id="dropdown-dashboard-btn">${escapeHtml(c.common.dashboard)}</button>
              <button class="dropdown-item" id="dropdown-buy-btn">${escapeHtml(c.common.buyCredits)}</button>
              <button class="dropdown-item" id="dropdown-history-btn">${escapeHtml(c.common.history)}</button>
              <div class="dropdown-divider"></div>
              <button class="dropdown-item danger" id="dropdown-logout-btn">${escapeHtml(c.common.logout)}</button>
            </div>
          </div>
        </div>
      </div>
      <button class="nav-hamburger" id="nav-hamburger" aria-label="${escapeAttr(c.nav.toggle)}">
        <span></span><span></span><span></span>
      </button>
    </div>
  </nav>`;
}

function renderHome(locale) {
  const c = content(locale);
  const h = c.home;

  return `
  <main id="main-content">
    <section class="hero" id="hero" aria-labelledby="hero-title">
      <div class="hero-content">
        <div class="hero-badge">${escapeHtml(h.hero.badge)}</div>
        <h1 class="hero-title" id="hero-title">${escapeHtml(h.hero.title)}</h1>
        <p class="hero-subtitle">${escapeHtml(h.hero.subtitle)}</p>
        <div class="hero-buttons">
          <a href="#pricing" class="btn-primary btn-lg">
            <span>${escapeHtml(h.hero.primaryCta)}</span>
            <span class="btn-arrow" aria-hidden="true">-&gt;</span>
          </a>
          <a href="#how-it-works" class="btn-outline btn-lg">${escapeHtml(h.hero.secondaryCta)}</a>
        </div>
        <ul class="hero-proof" aria-label="QuizSolver benefits">
          ${h.hero.proof.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      </div>
      <div class="hero-visual" aria-label="QuizSolver extension preview">
        <img class="hero-preview-image" src="/og-image.svg" alt="QuizSolver AI quiz solver extension preview">
        <div class="hero-card glass-card">
          <div class="mock-question">
            <div class="mock-badge">${escapeHtml(h.hero.mockBadge)}</div>
            <p class="mock-text">${escapeHtml(h.hero.mockQuestion)}</p>
            <div class="mock-options">
              <div class="mock-option">${escapeHtml(h.hero.mockOptionA)}</div>
              <div class="mock-option correct">${escapeHtml(h.hero.mockOptionB)} <span class="check">OK</span></div>
              <div class="mock-option">${escapeHtml(h.hero.mockOptionC)}</div>
            </div>
            <div class="mock-status">
              <span class="status-dot"></span>
              <span>${escapeHtml(h.hero.mockStatus)}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    ${renderHowItWorks(locale)}
    ${renderFeatures(locale)}
    ${renderPlatforms(locale)}
    ${renderPricing(locale)}
    ${renderStudyWorkflow(locale)}
    ${renderRelatedPages(locale)}
    ${renderFaq(locale, h.faq)}
    ${renderLeaderboard(locale)}
    ${renderDashboard(locale)}
  </main>`;
}

function renderHowItWorks(locale) {
  const h = content(locale).home.how;
  return `
  <section class="how-it-works" id="how-it-works" aria-labelledby="how-title">
    <div class="section-container">
      <div class="section-header">
        <span class="section-badge">${escapeHtml(h.badge)}</span>
        <h2 class="section-title" id="how-title">${escapeHtml(h.title)}</h2>
        <p class="section-subtitle">${escapeHtml(h.subtitle)}</p>
      </div>
      <div class="steps-grid">
        ${h.steps.map((step, index) => `
          <article class="step-card glass-card">
            <div class="step-index">${index + 1}</div>
            <h3>${escapeHtml(step.title)}</h3>
            <p>${escapeHtml(step.text)}</p>
          </article>`).join('')}
      </div>
    </div>
  </section>`;
}

function renderFeatures(locale) {
  const f = content(locale).home.features;
  return `
  <section class="features" id="features" aria-labelledby="features-title">
    <div class="section-container">
      <div class="section-header">
        <span class="section-badge">${escapeHtml(f.badge)}</span>
        <h2 class="section-title" id="features-title">${escapeHtml(f.title)}</h2>
        <p class="section-subtitle">${escapeHtml(f.subtitle)}</p>
      </div>
      <div class="features-grid">
        ${f.items.map(item => `
          <article class="feature-card glass-card">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.text)}</p>
          </article>`).join('')}
      </div>
    </div>
  </section>`;
}

function renderPlatforms(locale) {
  const p = content(locale).home.platforms;
  const linkedPlatforms = new Map(platformEntries(locale).map(entry => [entry.data.platformName || entry.data.shortName, entry.pageKey]));

  return `
  <section class="platforms" id="platforms" aria-labelledby="platforms-title">
    <div class="section-container">
      <div class="section-header">
        <span class="section-badge">${escapeHtml(p.badge)}</span>
        <h2 class="section-title" id="platforms-title">${escapeHtml(p.title)}</h2>
        <p class="section-subtitle">${escapeHtml(p.subtitle)}</p>
      </div>
      <div class="platforms-grid" aria-label="Supported quiz platforms">
        ${p.items.map(name => {
          const href = linkedPlatforms.has(name) ? pathFor(linkedPlatforms.get(name), locale) : '';
          const label = escapeHtml(name);
          return href
            ? `<a class="platform-card glass-card" href="${href}"><span aria-hidden="true">+</span> ${label}</a>`
            : `<div class="platform-card glass-card"><span aria-hidden="true">+</span> ${label}</div>`;
        }).join('')}
      </div>
    </div>
  </section>`;
}

function renderPricing(locale) {
  const p = content(locale).home.pricing;
  const common = content(locale).common;
  return `
  <section class="pricing" id="pricing" aria-labelledby="pricing-title">
    <div class="section-container">
      <div class="section-header">
        <span class="section-badge">${escapeHtml(p.badge)}</span>
        <h2 class="section-title" id="pricing-title">${escapeHtml(p.title)}</h2>
        <p class="section-subtitle">${escapeHtml(p.subtitle)}</p>
      </div>
      <div class="pricing-grid">
        ${p.packs.map(pack => `
          <article class="pricing-card glass-card ${pack.id === 'popular' ? 'featured' : ''}" data-pack="${escapeAttr(pack.id)}">
            ${pack.badge ? `<div class="pricing-badge ${pack.id === 'pro' ? 'best' : ''}">${escapeHtml(pack.badge)}</div>` : ''}
            <div class="pricing-header">
              <h3>${escapeHtml(pack.name)}</h3>
              <div class="pricing-amount">${escapeHtml(pack.price)}</div>
              <p class="pricing-credits">${escapeHtml(pack.credits)}</p>
            </div>
            <ul class="pricing-features">
              ${pack.features.map(feature => `<li>${escapeHtml(feature)}</li>`).join('')}
            </ul>
            <button class="btn-primary btn-block buy-pack-btn" data-pack="${escapeAttr(pack.id)}">${escapeHtml(common.buyCredits)}</button>
          </article>`).join('')}
      </div>
    </div>
  </section>`;
}

function renderStudyWorkflow(locale) {
  const s = content(locale).home.mobile;
  return `
  <section class="mobile-section" id="study-notes" aria-labelledby="study-title">
    <div class="section-container">
      <div class="section-header">
        <span class="section-badge">${escapeHtml(s.badge)}</span>
        <h2 class="section-title" id="study-title">${escapeHtml(s.title)}</h2>
        <p class="section-subtitle">${escapeHtml(s.subtitle)}</p>
      </div>
      <div class="tutorial-steps glass-card">
        ${s.steps.map((step, index) => `
          <article class="tutorial-step">
            <div class="step-number">${index + 1}</div>
            <div class="step-content">
              <h4>${escapeHtml(step.title)}</h4>
              <p>${escapeHtml(step.text)}</p>
            </div>
          </article>`).join('')}
      </div>
    </div>
  </section>`;
}

function renderRelatedPages(locale, currentPageKey = '') {
  const c = content(locale);
  const entries = platformEntries(locale).filter(entry => entry.pageKey !== currentPageKey);
  return `
  <section class="related-seo" id="platform-guides" aria-labelledby="related-title">
    <div class="section-container">
      <div class="section-header">
        <span class="section-badge">${escapeHtml(c.footer.seoPages)}</span>
        <h2 class="section-title" id="related-title">${escapeHtml(c.seoHub.title)}</h2>
        <p class="section-subtitle">${escapeHtml(c.seoHub.subtitle)}</p>
      </div>
      <div class="related-grid">
        ${entries.map(({ pageKey, data }) => `
          <a class="related-card glass-card" href="${pathFor(pageKey, locale)}">
            <span>${escapeHtml(data.shortName || data.platformName || data.badge)}</span>
            <strong>${escapeHtml(data.linkTitle || data.title)}</strong>
          </a>`).join('')}
      </div>
    </div>
  </section>`;
}

function renderFaq(locale, faq = []) {
  const c = content(locale);
  if (!Array.isArray(faq) || !faq.length) return '';

  return `
  <section class="faq-section" id="faq" aria-labelledby="faq-title">
    <div class="section-container">
      <div class="section-header">
        <span class="section-badge">${escapeHtml(c.seoHub.faqBadge)}</span>
        <h2 class="section-title" id="faq-title">${escapeHtml(c.seoHub.faqTitle)}</h2>
      </div>
      <div class="faq-grid">
        ${faq.map(item => `
          <article class="faq-item glass-card">
            <h3>${escapeHtml(item.question)}</h3>
            <p>${escapeHtml(item.answer)}</p>
          </article>`).join('')}
      </div>
    </div>
  </section>`;
}

function renderLeaderboard(locale) {
  const l = content(locale).home.leaderboard;
  const common = content(locale).common;
  return `
  <section class="leaderboard-section" id="leaderboard" aria-labelledby="leaderboard-title">
    <div class="section-container">
      <div class="section-header">
        <span class="section-badge">${escapeHtml(l.badge)}</span>
        <h2 class="section-title" id="leaderboard-title">${escapeHtml(l.title)}</h2>
        <p class="section-subtitle">${escapeHtml(l.subtitle)}</p>
      </div>
      <div class="leaderboard-table glass-card">
        <div class="leaderboard-header">
          <span>#</span>
          <span>${escapeHtml(l.user)}</span>
          <span>${escapeHtml(common.questions)}</span>
          <span>${escapeHtml(common.streak)}</span>
        </div>
        <div id="leaderboard-rows">
          <div class="leaderboard-loading">${escapeHtml(common.loading)}</div>
        </div>
      </div>
    </div>
  </section>`;
}

function renderDashboard(locale) {
  const d = content(locale).home.dashboard;
  const common = content(locale).common;
  return `
  <section class="dashboard-section hidden" id="dashboard" aria-labelledby="dashboard-title">
    <div class="section-container">
      <div class="section-header">
        <span class="section-badge">${escapeHtml(d.badge)}</span>
        <h2 class="section-title" id="dashboard-title">${escapeHtml(d.title)}</h2>
      </div>
      <div class="dashboard-grid">
        <article class="dash-card glass-card">
          <div class="dash-value" id="dash-credits">0</div>
          <div class="dash-label">${escapeHtml(common.credits)}</div>
        </article>
        <article class="dash-card glass-card">
          <div class="dash-value" id="dash-questions">0</div>
          <div class="dash-label">${escapeHtml(d.questionsSolved)}</div>
        </article>
        <article class="dash-card glass-card">
          <div class="dash-value" id="dash-streak">0</div>
          <div class="dash-label">${escapeHtml(d.dayStreak)}</div>
        </article>
        <article class="dash-card glass-card">
          <div class="dash-value" id="dash-referral">---</div>
          <div class="dash-label">${escapeHtml(d.referral)}</div>
          <button class="btn-sm btn-ghost" id="copy-referral-btn">${escapeHtml(d.copy)}</button>
        </article>
      </div>
      <div class="dash-history glass-card">
        <h3>${escapeHtml(d.purchaseHistory)}</h3>
        <div id="dash-history-list">
          <p class="dash-empty">${escapeHtml(d.noPurchases)}</p>
        </div>
      </div>
    </div>
  </section>`;
}

function renderPlatformPage(pageKey, locale) {
  const c = content(locale);
  const data = pageData(pageKey, locale);
  const home = pathFor('home', locale);

  return `
  <main id="main-content" class="seo-page">
    <section class="platform-hero" aria-labelledby="platform-title">
      <div class="section-container platform-hero-grid">
        <div>
          <nav class="breadcrumbs" aria-label="Breadcrumb">
            <a href="${home}">${escapeHtml(c.common.home)}</a>
            <span>/</span>
            <span>${escapeHtml(data.badge)}</span>
          </nav>
          <span class="section-badge">${escapeHtml(data.badge)}</span>
          <h1 class="hero-title" id="platform-title">${escapeHtml(data.title)}</h1>
          <p class="hero-subtitle">${escapeHtml(data.subtitle)}</p>
          <div class="hero-buttons">
            <a href="${home}#pricing" class="btn-primary btn-lg">${escapeHtml(data.primaryCta)}</a>
            <a href="${home}#platforms" class="btn-outline btn-lg">${escapeHtml(data.secondaryCta)}</a>
          </div>
        </div>
        <aside class="seo-callout glass-card">
          <h2>${escapeHtml(data.introTitle)}</h2>
          <p>${escapeHtml(data.intro)}</p>
        </aside>
      </div>
    </section>

    <section class="seo-content" aria-labelledby="platform-steps-title">
      <div class="section-container">
        <div class="seo-columns">
          <article class="glass-card seo-panel">
            <h2 id="platform-steps-title">${escapeHtml(data.stepsTitle)}</h2>
            <ol class="clean-list">
              ${data.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
            </ol>
          </article>
          <article class="glass-card seo-panel">
            <h2>${escapeHtml(data.featureTitle)}</h2>
            <ul class="clean-list two-column-list">
              ${data.features.map(feature => `<li>${escapeHtml(feature)}</li>`).join('')}
            </ul>
          </article>
        </div>
        <div class="ethical-note glass-card">
          <p>${escapeHtml(data.note)}</p>
        </div>
      </div>
    </section>

    ${renderKeywordSections(data)}
    ${renderFaq(locale, data.faq)}
    ${renderRelatedPages(locale, pageKey)}
    ${renderPlatforms(locale)}
    ${renderDashboard(locale)}
  </main>`;
}

function renderKeywordSections(data) {
  if (!Array.isArray(data.keywordSections) || !data.keywordSections.length) return '';

  return `
  <section class="keyword-sections" aria-label="Detailed guide">
    <div class="section-container keyword-grid">
      ${data.keywordSections.map(section => `
        <article class="keyword-panel glass-card">
          <h2>${escapeHtml(section.title)}</h2>
          <p>${escapeHtml(section.text)}</p>
        </article>`).join('')}
    </div>
  </section>`;
}

function renderFooter(locale) {
  const c = content(locale);
  const home = pathFor('home', locale);
  const platformLinks = platformEntries(locale);
  return `
  <footer class="footer">
    <div class="section-container">
      <div class="footer-grid">
        <div class="footer-brand">
          <span class="logo-icon" aria-hidden="true">QS</span>
          <span class="logo-text">QuizSolver</span>
          <p class="footer-desc">${escapeHtml(c.footer.description)}</p>
        </div>
        <div class="footer-links">
          <h4>${escapeHtml(c.footer.product)}</h4>
          <a href="${home}#how-it-works">${escapeHtml(c.nav.how)}</a>
          <a href="${home}#features">${escapeHtml(c.nav.features)}</a>
          <a href="${home}#pricing">${escapeHtml(c.nav.pricing)}</a>
          <a href="/quiz">${escapeHtml(c.nav.study)}</a>
        </div>
        <div class="footer-links">
          <h4>${escapeHtml(c.footer.seoPages)}</h4>
          ${platformLinks.map(({ pageKey, data }) => `<a href="${pathFor(pageKey, locale)}">${escapeHtml(data.shortName || data.platformName || data.badge)}</a>`).join('')}
        </div>
        <div class="footer-links">
          <h4>${escapeHtml(c.footer.legal)}</h4>
          <a href="${pathFor('privacy', locale)}">${escapeHtml(c.footer.privacy)}</a>
          <h4 class="footer-subhead">${escapeHtml(c.footer.support)}</h4>
          <a href="mailto:support@getquizsolver.com">${escapeHtml(c.footer.contact)}</a>
        </div>
      </div>
      <div class="footer-bottom">
        <p>&copy; ${escapeHtml(c.footer.rights)}</p>
      </div>
    </div>
  </footer>`;
}

function renderAuth(locale) {
  const c = content(locale);
  return `
  <div class="modal-overlay hidden" id="auth-modal-overlay">
    <div class="modal glass-card" id="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <button class="modal-close" id="modal-close-btn" aria-label="${escapeAttr(c.common.close)}">&times;</button>

      <div id="login-form">
        <h2 class="modal-title" id="auth-modal-title">${escapeHtml(c.auth.loginTitle)}</h2>
        <p class="modal-subtitle">${escapeHtml(c.auth.loginSubtitle)}</p>
        <div class="form-group">
          <input type="email" id="modal-login-email" placeholder="${escapeAttr(c.common.email)}" class="form-input" autocomplete="email">
        </div>
        <div class="form-group">
          <input type="password" id="modal-login-password" placeholder="${escapeAttr(c.common.password)}" class="form-input" autocomplete="current-password">
        </div>
        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox" id="modal-remember-me" checked> <span>${escapeHtml(c.common.rememberMe)}</span>
          </label>
        </div>
        <div class="form-error hidden" id="modal-login-error"></div>
        <button class="btn-primary btn-block" id="modal-login-btn">
          <span class="btn-text">${escapeHtml(c.common.signIn)}</span>
          <span class="btn-loader hidden"></span>
        </button>
        <p class="form-switch">${escapeHtml(c.auth.showRegister)} <a href="#" id="show-register-form">${escapeHtml(c.auth.showRegisterLink)}</a></p>
      </div>

      <div id="register-form" class="hidden">
        <h2 class="modal-title">${escapeHtml(c.auth.registerTitle)}</h2>
        <p class="modal-subtitle">${escapeHtml(c.auth.registerSubtitle)}</p>
        <div class="form-group">
          <input type="text" id="modal-register-name" placeholder="${escapeAttr(c.common.displayName)}" class="form-input" autocomplete="name">
        </div>
        <div class="form-group">
          <input type="email" id="modal-register-email" placeholder="${escapeAttr(c.common.email)}" class="form-input" autocomplete="email">
        </div>
        <div class="form-group">
          <input type="password" id="modal-register-password" placeholder="${escapeAttr(c.common.password)}" class="form-input" autocomplete="new-password">
        </div>
        <div class="form-group">
          <input type="password" id="modal-register-confirm" placeholder="${escapeAttr(c.common.confirmPassword)}" class="form-input" autocomplete="new-password">
        </div>
        <div class="form-group">
          <input type="text" id="modal-register-referral" placeholder="${escapeAttr(c.common.referralCode)}" class="form-input">
        </div>
        <p class="modal-helper">${escapeHtml(c.auth.passwordHelp)}</p>
        <div class="form-error hidden" id="modal-register-error"></div>
        <button class="btn-primary btn-block" id="modal-register-btn">
          <span class="btn-text">${escapeHtml(c.common.createAccount)}</span>
          <span class="btn-loader hidden"></span>
        </button>
        <p class="form-switch">${escapeHtml(c.auth.showLogin)} <a href="#" id="show-login-form">${escapeHtml(c.auth.showLoginLink)}</a></p>
      </div>
    </div>
  </div>

  <div class="toast hidden" id="toast" role="status" aria-live="polite">
    <span id="toast-message"></span>
  </div>`;
}

function renderMarketingPage({ pageKey, locale, nonce }) {
  const c = content(locale);
  const body = pageKey === 'home' ? renderHome(locale) : renderPlatformPage(pageKey, locale);

  return `<!DOCTYPE html>
<html lang="${c.htmlLang}">
<head>
${renderHead({ pageKey, locale, nonce })}
</head>
<body class="marketing-body" data-locale="${locale}" data-home-path="${pathFor('home', locale)}">
  <div id="particles-bg" aria-hidden="true"></div>
  ${renderNav(pageKey, locale)}
  ${body}
  ${renderFooter(locale)}
  ${renderAuth(locale)}
  <script src="/marketing.js?v=${ASSET_VERSION}" defer></script>
</body>
</html>`;
}

function sitemapUrl(pageKey, locale, priority) {
  const loc = abs(pathFor(pageKey, locale));
  const alternateEn = abs(pathFor(pageKey, 'en'));
  const alternatePl = abs(pathFor(pageKey, 'pl'));

  return `  <url>
    <loc>${loc}</loc>
    <xhtml:link rel="alternate" hreflang="en" href="${alternateEn}" />
    <xhtml:link rel="alternate" hreflang="pl" href="${alternatePl}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${alternateEn}" />
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

function simpleSitemapUrl(urlPath, priority) {
  return `  <url>
    <loc>${abs(urlPath)}</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

function getSitemapXml() {
  const entries = [
    sitemapUrl('home', 'en', '1.0'),
    sitemapUrl('home', 'pl', '1.0'),
    ...PLATFORM_PAGE_KEYS.flatMap((pageKey, index) => {
      const priority = index <= 2 ? '0.9' : '0.85';
      return [
        sitemapUrl(pageKey, 'en', priority),
        sitemapUrl(pageKey, 'pl', priority)
      ];
    }),
    simpleSitemapUrl('/privacy', '0.3')
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>`;
}

function getRobotsTxt() {
  return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin

Sitemap: ${abs('/sitemap.xml')}
`;
}

function getMarketingRoutes() {
  return MARKETING_ROUTES.slice();
}

module.exports = {
  getMarketingRoutes,
  getRobotsTxt,
  getSitemapXml,
  pathFor,
  renderMarketingPage
};
