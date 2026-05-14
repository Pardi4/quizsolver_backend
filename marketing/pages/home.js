const { CHROME_WEB_STORE_URL, content, escapeHtml } = require('../config');
const {
  renderFaq,
  renderFeatures,
  renderHowItWorks,
  renderInstallCta,
  renderLeaderboard,
  renderPlatforms,
  renderPricing,
  renderQuickStart,
  renderRelatedPages,
  renderStudyWorkflow
} = require('../sections');

function renderHome(locale) {
  const h = content(locale).home;

  return `
  <main id="main-content">
    <section class="hero" id="hero" aria-labelledby="hero-title">
      <div class="hero-content">
        <div class="hero-badge">${escapeHtml(h.hero.badge)}</div>
        <h1 class="hero-title" id="hero-title">${escapeHtml(h.hero.title)}</h1>
        <p class="hero-subtitle">${escapeHtml(h.hero.subtitle)}</p>
        <div class="hero-buttons">
          <a href="${CHROME_WEB_STORE_URL}" target="_blank" rel="noopener" class="btn-primary btn-lg btn-store">
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
        <div class="hero-orbit hero-orbit-one" aria-hidden="true">AI</div>
        <div class="hero-orbit hero-orbit-two" aria-hidden="true">0.8s</div>
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

    ${renderQuickStart(locale)}
    ${renderHowItWorks(locale)}
    ${renderFeatures(locale)}
    ${renderPlatforms(locale)}
    ${renderStudyWorkflow(locale)}
    ${renderRelatedPages(locale, '', true)}
    ${renderInstallCta(locale)}
    ${renderPricing(locale)}
    ${renderFaq(locale, h.faq)}
    ${renderLeaderboard(locale)}
  </main>`;
}

module.exports = {
  renderHome
};
