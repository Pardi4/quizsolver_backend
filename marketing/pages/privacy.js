const {
  ASSET_VERSION,
  content,
  escapeHtml,
  pathFor
} = require('../config');
const { renderAuth, renderFooter, renderNav } = require('../partials');
const { renderUtilityHead } = require('../seo');

function renderPrivacySections(sections) {
  return sections.map(section => `
    <article class="privacy-card glass-card">
      <h2>${escapeHtml(section.title)}</h2>
      ${Array.isArray(section.items)
        ? `<ul>${section.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : `<p>${escapeHtml(section.text)}</p>`}
    </article>`).join('');
}

function renderPrivacyPage({ locale, nonce }) {
  const c = content(locale);
  const p = c.privacyPage;
  const privacyPath = pathFor('privacy', locale);
  const dashboardPath = pathFor('dashboard', locale);

  return `<!DOCTYPE html>
<html lang="${c.htmlLang}">
<head>
${renderUtilityHead({
  locale,
  nonce,
  pageKey: 'privacy',
  title: p.metaTitle,
  description: p.metaDescription,
  keywords: p.keywords,
  canonicalPath: privacyPath,
  robots: 'index, follow',
  ogType: 'article'
})}
</head>
<body class="marketing-body utility-page-body privacy-page-body" data-locale="${locale}" data-home-path="${pathFor('home', locale)}" data-dashboard-path="${dashboardPath}" data-page="privacy">
  <div id="particles-bg" aria-hidden="true"></div>
  ${renderNav('privacy', locale)}
  <main id="main-content" class="utility-page privacy-page">
    <section class="utility-hero" aria-labelledby="privacy-title">
      <div class="section-container utility-hero-grid">
        <div>
          <span class="section-badge">${escapeHtml(p.badge)}</span>
          <h1 class="hero-title" id="privacy-title">${escapeHtml(p.title)}</h1>
          <p class="hero-subtitle">${escapeHtml(p.subtitle)}</p>
          <div class="utility-meta">
            <span>${escapeHtml(p.effective)}</span>
            <span id="contact">${escapeHtml(p.contactLabel)}: ${escapeHtml(p.contactValue)}</span>
          </div>
        </div>
        <aside class="utility-callout glass-card">
          <h2>${escapeHtml(c.common.brand)}</h2>
          <p>${escapeHtml(c.footer.description)}</p>
        </aside>
      </div>
    </section>
    <section class="privacy-content" aria-label="${escapeHtml(p.badge)}">
      <div class="section-container privacy-layout">
        ${renderPrivacySections(p.sections)}
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
  renderPrivacyPage
};
