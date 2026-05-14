const {
  ASSET_VERSION,
  CHROME_WEB_STORE_URL,
  content,
  escapeHtml,
  pathFor
} = require('../config');
const { renderAuth, renderFooter, renderNav } = require('../partials');
const { renderDashboard, renderDashboardLogin } = require('../sections');
const { renderUtilityHead } = require('../seo');

function renderDashboardPage({ locale, nonce }) {
  const c = content(locale);
  const d = c.dashboardPage;
  const dashboardPath = pathFor('dashboard', locale);

  return `<!DOCTYPE html>
<html lang="${c.htmlLang}">
<head>
${renderUtilityHead({
  locale,
  nonce,
  title: d.metaTitle,
  description: d.metaDescription,
  canonicalPath: dashboardPath,
  styles: [`/dashboard.css?v=${ASSET_VERSION}`]
})}
</head>
<body class="marketing-body dashboard-page-body" data-locale="${locale}" data-home-path="${pathFor('home', locale)}" data-dashboard-path="${dashboardPath}" data-page="dashboard">
  <div id="particles-bg" aria-hidden="true"></div>
  ${renderNav('dashboard', locale)}
  <main id="main-content" class="dashboard-page-main">
    <section class="dashboard-hero" aria-labelledby="dashboard-page-title">
      <div class="section-container dashboard-hero-grid">
        <div>
          <span class="section-badge">${escapeHtml(c.common.dashboard)}</span>
          <h1 class="hero-title" id="dashboard-page-title">${escapeHtml(d.title)}</h1>
          <p class="hero-subtitle">${escapeHtml(d.subtitle)}</p>
        </div>
        <a class="btn-primary btn-lg btn-store" href="${CHROME_WEB_STORE_URL}" target="_blank" rel="noopener">
          <span>${escapeHtml(c.common.installExtension)}</span>
          <span class="btn-arrow" aria-hidden="true">-&gt;</span>
        </a>
      </div>
    </section>
    <div class="section-container">
      ${renderDashboardLogin(locale)}
    </div>
    ${renderDashboard(locale)}
  </main>
  ${renderFooter(locale)}
  ${renderAuth(locale)}
  <script src="/marketing.js?v=${ASSET_VERSION}" defer></script>
</body>
</html>`;
}

module.exports = {
  renderDashboardPage
};
