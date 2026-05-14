const { ASSET_VERSION, MARKETING_ROUTES, content, pathFor } = require('./config');
const { renderAuth, renderFooter, renderNav } = require('./partials');
const { getRobotsTxt, getSitemapXml, renderHead } = require('./seo');
const { renderDashboardPage } = require('./pages/dashboard');
const { renderHome } = require('./pages/home');
const { renderPlatformPage } = require('./pages/platform');

function renderMarketingPage({ pageKey, locale, nonce }) {
  const c = content(locale);
  const body = pageKey === 'home' ? renderHome(locale) : renderPlatformPage(pageKey, locale);

  return `<!DOCTYPE html>
<html lang="${c.htmlLang}">
<head>
${renderHead({ pageKey, locale, nonce })}
</head>
<body class="marketing-body" data-locale="${locale}" data-home-path="${pathFor('home', locale)}" data-dashboard-path="${pathFor('dashboard', locale)}">
  <div id="particles-bg" aria-hidden="true"></div>
  ${renderNav(pageKey, locale)}
  ${body}
  ${renderFooter(locale)}
  ${renderAuth(locale)}
  <script src="/marketing.js?v=${ASSET_VERSION}" defer></script>
</body>
</html>`;
}

function getMarketingRoutes() {
  return MARKETING_ROUTES.slice();
}

module.exports = {
  getMarketingRoutes,
  getRobotsTxt,
  getSitemapXml,
  pathFor,
  renderDashboardPage,
  renderMarketingPage
};
