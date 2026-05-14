const {
  CHROME_WEB_STORE_URL,
  content,
  escapeHtml,
  pageData,
  pathFor
} = require('../config');
const {
  renderFaq,
  renderKeywordSections,
  renderPlatforms,
  renderRelatedPages
} = require('../sections');

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
            <a href="${CHROME_WEB_STORE_URL}" target="_blank" rel="noopener" class="btn-primary btn-lg btn-store">${escapeHtml(data.primaryCta)}</a>
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
  </main>`;
}

module.exports = {
  renderPlatformPage
};
