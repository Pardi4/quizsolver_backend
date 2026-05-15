const {
  ASSET_VERSION,
  CHROME_WEB_STORE_URL,
  content,
  escapeHtml,
  pathFor
} = require('../config');
const { renderAuth, renderFooter, renderNav } = require('../partials');
const { renderUtilityHead } = require('../seo');

function renderSuccessPage({ locale, nonce }) {
  const c = content(locale);
  const page = c.successPage;
  const successPath = pathFor('success', locale);

  return `<!DOCTYPE html>
<html lang="${c.htmlLang}">
<head>
${renderUtilityHead({
  locale,
  nonce,
  pageKey: 'success',
  title: page.metaTitle,
  description: page.metaDescription,
  canonicalPath: successPath,
  robots: 'noindex, nofollow'
})}
</head>
<body class="marketing-body utility-page-body success-page-body" data-locale="${locale}" data-home-path="${pathFor('home', locale)}" data-dashboard-path="${pathFor('dashboard', locale)}" data-page="success">
  <div id="particles-bg" aria-hidden="true"></div>
  ${renderNav('success', locale)}
  <main id="main-content" class="utility-page success-page">
    <section class="utility-hero not-found-hero" aria-labelledby="success-title">
      <div class="section-container utility-hero-grid">
        <div>
          <span class="section-badge">${escapeHtml(page.badge)}</span>
          <h1 class="hero-title" id="success-title">${escapeHtml(page.title)}</h1>
          <p class="hero-subtitle">${escapeHtml(page.subtitle)}</p>
          <div class="hero-buttons">
            <a class="btn-primary btn-lg" href="${pathFor('dashboard', locale)}">${escapeHtml(page.dashboardCta)}</a>
            <a class="btn-outline btn-lg" href="${pathFor('home', locale)}">${escapeHtml(page.homeCta)}</a>
            <a class="btn-primary btn-lg btn-store" href="${CHROME_WEB_STORE_URL}" target="_blank" rel="noopener">${escapeHtml(page.storeCta)}</a>
          </div>
        </div>
        <aside class="not-found-code success-code glass-card" aria-hidden="true">
          <span>OK</span>
          <p>QuizSolver</p>
        </aside>
      </div>
    </section>
  </main>
  ${renderFooter(locale)}
  ${renderAuth(locale)}
  <script src="/marketing.js?v=${ASSET_VERSION}" defer></script>
</body>
</html>`;
}

module.exports = {
  renderSuccessPage
};
