const {
  ASSET_VERSION,
  content,
  escapeAttr,
  escapeHtml,
  pathFor
} = require('../config');
const { renderAuth, renderFooter, renderNav } = require('../partials');
const { renderUtilityHead } = require('../seo');

function renderQuizPage({ locale, nonce }) {
  const c = content(locale);
  const q = c.quizPage;
  const quizPath = pathFor('quiz', locale);
  const dashboardPath = pathFor('dashboard', locale);

  return `<!DOCTYPE html>
<html lang="${c.htmlLang}">
<head>
${renderUtilityHead({
  locale,
  nonce,
  pageKey: 'quiz',
  title: q.metaTitle,
  description: q.metaDescription,
  canonicalPath: quizPath,
  robots: 'noindex, nofollow'
})}
</head>
<body class="marketing-body utility-page-body quiz-page-body" data-locale="${locale}" data-home-path="${pathFor('home', locale)}" data-dashboard-path="${dashboardPath}" data-page="quiz">
  <div id="particles-bg" aria-hidden="true"></div>
  ${renderNav('quiz', locale)}
  <main id="main-content" class="quiz-page utility-page">
    <header class="quiz-hero utility-hero-narrow">
      <span class="section-badge" data-i18n="badge">${escapeHtml(q.badge)}</span>
      <h1 data-i18n="title">${escapeHtml(q.title)}</h1>
      <p data-i18n="subtitle">${escapeHtml(q.subtitle)}</p>
    </header>

    <section class="quiz-auth-card glass-card hidden" id="auth-card">
      <h2 data-i18n="loginTitle">${escapeHtml(q.loginTitle)}</h2>
      <p data-i18n="loginSubtitle">${escapeHtml(q.loginSubtitle)}</p>
      <div class="quiz-auth-grid">
        <input class="form-input" id="quiz-email" type="email" placeholder="${escapeAttr(c.common.email)}" autocomplete="email">
        <input class="form-input" id="quiz-password" type="password" placeholder="${escapeAttr(c.common.password)}" autocomplete="current-password">
        <button class="btn-primary" id="quiz-login-btn" data-i18n="loginButton">${escapeHtml(c.common.signIn)}</button>
      </div>
      <div class="form-error hidden" id="quiz-login-error"></div>
    </section>

    <section class="quiz-shell hidden" id="notes-shell">
      <div class="quiz-toolbar glass-card">
        <div>
          <h2 data-i18n="historyTitle">${escapeHtml(q.historyTitle)}</h2>
          <p><span id="notes-count">0</span> <span data-i18n="historyCount">${escapeHtml(q.historyCount)}</span></p>
        </div>
        <div class="quiz-toolbar-actions">
          <input class="form-input" id="notes-search" type="search" data-i18n-placeholder="searchPlaceholder" placeholder="Search notes">
          <select class="form-input" id="notes-filter">
            <option value="" data-i18n="filterAll">All</option>
            <option value="favorite" data-i18n="filterFavorite">Favorites</option>
            <option value="new" data-i18n="filterNew">New</option>
            <option value="learning" data-i18n="filterLearning">Learning</option>
            <option value="mastered" data-i18n="filterMastered">Mastered</option>
          </select>
          <button class="btn-outline" id="select-visible-btn" data-i18n="selectVisible">Select visible</button>
          <button class="btn-primary" id="start-practice-btn" data-i18n="startPractice">Start practice</button>
        </div>
      </div>

      <div class="quiz-empty glass-card hidden" id="notes-empty">
        <h3 data-i18n="emptyTitle">No notes yet</h3>
        <p data-i18n="emptyText">Solve questions with Study Notes enabled, then come back here to practice from your history.</p>
      </div>

      <div class="notes-grid" id="notes-grid"></div>
    </section>

    <section class="practice-shell glass-card hidden" id="practice-shell">
      <div class="practice-header">
        <button class="btn-outline btn-sm" id="back-to-notes-btn" data-i18n="backToNotes">Back to notes</button>
        <div class="practice-progress">
          <span id="practice-index">1</span>/<span id="practice-total">1</span>
        </div>
      </div>

      <article class="practice-card" id="practice-card">
        <div class="practice-meta" id="practice-meta"></div>
        <h2 id="practice-question"></h2>
        <div class="practice-options" id="practice-options"></div>
        <div class="practice-feedback hidden" id="practice-feedback"></div>
        <div class="practice-actions">
          <button class="btn-primary" id="check-answer-btn" data-i18n="checkAnswer">Check answer</button>
          <button class="btn-outline hidden" id="next-question-btn" data-i18n="nextQuestion">Next question</button>
        </div>
      </article>

      <div class="practice-result hidden" id="practice-result">
        <h2 data-i18n="resultTitle">Practice complete</h2>
        <p><span id="practice-score">0</span>/<span id="practice-score-total">0</span> <span data-i18n="correctAnswers">correct answers</span></p>
        <button class="btn-primary" id="restart-practice-btn" data-i18n="restartPractice">Practice again</button>
      </div>
    </section>
  </main>
  ${renderFooter(locale)}
  ${renderAuth(locale)}
  <script src="/marketing.js?v=${ASSET_VERSION}" defer></script>
  <script src="/quiz-app.js?v=${ASSET_VERSION}" defer></script>
</body>
</html>`;
}

module.exports = {
  renderQuizPage
};
