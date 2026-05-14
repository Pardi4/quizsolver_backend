const {
  CHROME_WEB_STORE_URL,
  content,
  escapeAttr,
  escapeHtml,
  localizedQuizPath,
  pathFor,
  platformEntries
} = require('./config');

function renderNav(pageKey, locale) {
  const c = content(locale);
  const home = pathFor('home', locale);
  const quizPath = localizedQuizPath(locale);
  const navLinks = [
    { href: `${home}#how-it-works`, label: c.nav.how },
    { href: `${home}#platforms`, label: c.nav.platforms },
    { href: quizPath, label: c.nav.study },
    { href: `${home}#platform-guides`, label: c.footer.seoPages },
    { href: `${home}#pricing`, label: c.nav.pricing }
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
        <a class="btn-primary btn-sm nav-install" href="${CHROME_WEB_STORE_URL}" target="_blank" rel="noopener">${escapeHtml(c.common.installExtension)}</a>
        <div class="nav-lang-switch" role="group" aria-label="Language">
          <a class="lang-btn ${locale === 'en' ? 'active' : ''}" href="${pathFor(pageKey, 'en')}" hreflang="en" aria-pressed="${locale === 'en'}">EN</a>
          <a class="lang-btn ${locale === 'pl' ? 'active' : ''}" href="${pathFor(pageKey, 'pl')}" hreflang="pl" aria-pressed="${locale === 'pl'}">PL</a>
        </div>
        <div id="nav-guest">
          <button class="btn-ghost" id="nav-login-btn">${escapeHtml(c.nav.login)}</button>
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

function renderFooter(locale) {
  const c = content(locale);
  const home = pathFor('home', locale);
  const quizPath = localizedQuizPath(locale);
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
          <a href="${CHROME_WEB_STORE_URL}" target="_blank" rel="noopener">${escapeHtml(c.common.installExtension)}</a>
          <a href="${quizPath}">${escapeHtml(c.nav.study)}</a>
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

module.exports = {
  renderAuth,
  renderFooter,
  renderNav
};
