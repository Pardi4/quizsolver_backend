const {
  CHROME_WEB_STORE_URL,
  content,
  escapeAttr,
  escapeHtml,
  pathFor,
  platformEntries
} = require('./config');

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

function renderQuickStart(locale) {
  const h = content(locale).home.how;
  return `
  <section class="quick-start" aria-label="${escapeAttr(h.title)}">
    <div class="section-container quick-start-grid">
      ${h.steps.map((step, index) => `
        <article class="quick-start-card glass-card">
          <span>${index + 1}</span>
          <div>
            <h2>${escapeHtml(step.title)}</h2>
            <p>${escapeHtml(step.text)}</p>
          </div>
        </article>`).join('')}
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

function renderInstallCta(locale) {
  const c = content(locale);
  return `
  <section class="install-cta" aria-labelledby="install-title">
    <div class="section-container">
      <div class="install-panel glass-card">
        <div>
          <span class="section-badge">${escapeHtml(c.common.installExtension)}</span>
          <h2 id="install-title">${escapeHtml(c.installCta.title)}</h2>
          <p>${escapeHtml(c.installCta.subtitle)}</p>
        </div>
        <a class="btn-primary btn-lg btn-store" href="${CHROME_WEB_STORE_URL}" target="_blank" rel="noopener">
          <span>${escapeHtml(c.installCta.button)}</span>
          <span class="btn-arrow" aria-hidden="true">-&gt;</span>
        </a>
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

function renderRelatedPages(locale, currentPageKey = '', compact = false) {
  const c = content(locale);
  const entries = platformEntries(locale).filter(entry => entry.pageKey !== currentPageKey);
  return `
  <section class="related-seo ${compact ? 'related-seo-compact' : ''}" id="platform-guides" aria-labelledby="related-title">
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

function renderDashboard(locale, options = {}) {
  const d = content(locale).home.dashboard;
  const common = content(locale).common;
  const hiddenClass = options.hidden === false ? '' : ' hidden';
  return `
  <section class="dashboard-section${hiddenClass}" id="dashboard" aria-labelledby="dashboard-title">
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
      <div class="dash-history glass-card" id="purchase-history">
        <h3>${escapeHtml(d.purchaseHistory)}</h3>
        <div id="dash-history-list">
          <p class="dash-empty">${escapeHtml(d.noPurchases)}</p>
        </div>
      </div>
    </div>
  </section>`;
}

function renderDashboardLogin(locale) {
  const c = content(locale);
  return `
  <section class="dashboard-auth-card glass-card" id="dashboard-login-card" aria-labelledby="dashboard-login-title">
    <div>
      <span class="section-badge">${escapeHtml(c.common.dashboard)}</span>
      <h2 id="dashboard-login-title">${escapeHtml(c.dashboardPage.loginTitle)}</h2>
      <p>${escapeHtml(c.dashboardPage.loginText)}</p>
    </div>
    <button class="btn-primary btn-lg" id="dashboard-login-btn">${escapeHtml(c.dashboardPage.loginButton)}</button>
  </section>`;
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

module.exports = {
  renderDashboard,
  renderDashboardLogin,
  renderFaq,
  renderFeatures,
  renderHowItWorks,
  renderInstallCta,
  renderKeywordSections,
  renderLeaderboard,
  renderPlatforms,
  renderPricing,
  renderQuickStart,
  renderRelatedPages,
  renderStudyWorkflow
};
