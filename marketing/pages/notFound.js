const {
  ASSET_VERSION,
  CHROME_WEB_STORE_URL,
  content,
  escapeHtml,
  pathFor
} = require('../config');
const { renderAuth, renderFooter, renderNav } = require('../partials');
const { renderRelatedPages } = require('../sections');
const { renderUtilityHead } = require('../seo');

function renderNotFoundPage({ locale, nonce }) {
  const c = content(locale);
  const page = c.notFoundPage;
  const home = pathFor('home', locale);
  const notFoundPath = pathFor('notFound', locale);

  return `<!DOCTYPE html>
<html lang="${c.htmlLang}">
<head>
${renderUtilityHead({
  locale,
  nonce,
  pageKey: 'notFound',
  title: page.metaTitle,
  description: page.metaDescription,
  canonicalPath: notFoundPath,
  robots: 'noindex, follow'
})}
</head>
<body class="marketing-body utility-page-body not-found-page-body" data-locale="${locale}" data-home-path="${home}" data-dashboard-path="${pathFor('dashboard', locale)}" data-page="notFound">
  <div id="particles-bg" aria-hidden="true"></div>
  ${renderNav('notFound', locale)}
  <main id="main-content" class="utility-page not-found-page">
    <section class="utility-hero not-found-hero" aria-labelledby="not-found-title">
      <div class="section-container utility-hero-grid">
        <div>
          <span class="section-badge">${escapeHtml(page.badge)}</span>
          <h1 class="hero-title" id="not-found-title">${escapeHtml(page.title)}</h1>
          <p class="hero-subtitle">${escapeHtml(page.subtitle)}</p>
          <div class="hero-buttons">
            <a class="btn-primary btn-lg" href="${home}">${escapeHtml(page.homeCta)}</a>
            <a class="btn-outline btn-lg" href="${home}#platform-guides">${escapeHtml(page.guidesCta)}</a>
            <a class="btn-primary btn-lg btn-store" href="${CHROME_WEB_STORE_URL}" target="_blank" rel="noopener">${escapeHtml(page.storeCta)}</a>
          </div>
        </div>
        <aside class="not-found-code glass-card" aria-hidden="true">
          <span>404</span>
          <p>QuizSolver</p>
        </aside>
      </div>
    </section>
    ${renderRelatedPages(locale, '', true)}
  </main>
  ${renderFooter(locale)}
  ${renderAuth(locale)}
  <script src="/marketing.js?v=${ASSET_VERSION}" defer></script>
</body>
</html>`;
}

module.exports = {
  renderNotFoundPage
};
