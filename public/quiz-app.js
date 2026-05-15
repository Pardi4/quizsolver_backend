(() => {
  const API = window.location.origin;
  let token = localStorage.getItem('qs_token') || null;
  let lang = document.body.dataset.locale || localStorage.getItem('qs_lang') || (navigator.language?.startsWith('pl') ? 'pl' : 'en');
  let notes = [];
  let selected = new Set();
  let practice = [];
  let currentIndex = 0;
  let score = 0;
  let checked = false;

  const copy = {
    en: {
      home: 'Home',
      studyNotes: 'Study Notes',
      privacy: 'Privacy',
      badge: 'Study Notes',
      title: 'Build a practice quiz from your saved history',
      subtitle: 'Choose questions from answers and explanations saved by QuizSolver, then practice them in a clean quiz view.',
      loginTitle: 'Sign in to load your notes',
      loginSubtitle: 'Use the same account as the extension or landing page.',
      loginButton: 'Sign in',
      historyTitle: 'Your question history',
      historyCount: 'saved questions',
      searchPlaceholder: 'Search notes',
      filterAll: 'All',
      filterFavorite: 'Favorites',
      filterNew: 'New',
      filterLearning: 'Learning',
      filterMastered: 'Mastered',
      selectVisible: 'Select visible',
      startPractice: 'Start practice',
      emptyTitle: 'No notes yet',
      emptyText: 'Solve questions with Study Notes enabled, then come back here to practice from your history.',
      backToNotes: 'Back to notes',
      checkAnswer: 'Check answer',
      nextQuestion: 'Next question',
      resultTitle: 'Practice complete',
      correctAnswers: 'correct answers',
      restartPractice: 'Practice again',
      answer: 'Answer',
      explanation: 'Explanation',
      noExplanation: 'No explanation saved yet.',
      favorite: 'Favorite',
      selected: 'Selected',
      status: 'Status',
      new: 'New',
      learning: 'Learning',
      mastered: 'Mastered',
      correct: 'Correct',
      incorrect: 'Not quite',
      selectAtLeastOne: 'Select at least one question.',
      loginError: 'Could not sign in.',
      loadError: 'Could not load notes.',
      networkError: 'Network error.',
      textPlaceholder: 'Type your answer'
    },
    pl: {
      home: 'Strona g\u0142\u00f3wna',
      studyNotes: 'Notatki',
      privacy: 'Prywatno\u015b\u0107',
      badge: 'Study Notes',
      title: 'Zbuduj quiz powt\u00f3rkowy z zapisanej historii',
      subtitle: 'Wybierz pytania z odpowiedzi i wyja\u015bnie\u0144 zapisanych przez QuizSolver, a potem prze\u0107wicz je w czystym widoku quizu.',
      loginTitle: 'Zaloguj si\u0119, aby wczyta\u0107 notatki',
      loginSubtitle: 'U\u017cyj tego samego konta co w rozszerzeniu albo na stronie.',
      loginButton: 'Zaloguj si\u0119',
      historyTitle: 'Twoja historia pyta\u0144',
      historyCount: 'zapisanych pyta\u0144',
      searchPlaceholder: 'Szukaj notatek',
      filterAll: 'Wszystkie',
      filterFavorite: 'Ulubione',
      filterNew: 'Nowe',
      filterLearning: 'W trakcie nauki',
      filterMastered: 'Opanowane',
      selectVisible: 'Zaznacz widoczne',
      startPractice: 'Zacznij quiz',
      emptyTitle: 'Nie ma jeszcze notatek',
      emptyText: 'Rozwi\u0105\u017c pytania z w\u0142\u0105czonym zapisem Study Notes, a potem wr\u00f3\u0107 tutaj, \u017ceby \u0107wiczy\u0107 z historii.',
      backToNotes: 'Wr\u00f3\u0107 do notatek',
      checkAnswer: 'Sprawd\u017a odpowied\u017a',
      nextQuestion: 'Nast\u0119pne pytanie',
      resultTitle: 'Quiz zako\u0144czony',
      correctAnswers: 'poprawnych odpowiedzi',
      restartPractice: '\u0106wicz ponownie',
      answer: 'Odpowied\u017a',
      explanation: 'Wyja\u015bnienie',
      noExplanation: 'Brak zapisanego wyja\u015bnienia.',
      favorite: 'Ulubione',
      selected: 'Wybrane',
      status: 'Status',
      new: 'Nowe',
      learning: 'Nauka',
      mastered: 'Opanowane',
      correct: 'Poprawnie',
      incorrect: 'Jeszcze nie',
      selectAtLeastOne: 'Zaznacz co najmniej jedno pytanie.',
      loginError: 'Nie uda\u0142o si\u0119 zalogowa\u0107.',
      loadError: 'Nie uda\u0142o si\u0119 wczyta\u0107 notatek.',
      networkError: 'B\u0142\u0105d sieci.',
      textPlaceholder: 'Wpisz odpowied\u017a'
    }
  };

  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);
  const t = key => copy[lang]?.[key] || copy.en[key] || key;

  function applyI18n() {
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $$('[data-lang]').forEach(btn => {
      const active = btn.dataset.lang === lang;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
  }

  function showToast(message) {
    $('#toast-message').textContent = message;
    $('#toast').classList.remove('hidden');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => $('#toast').classList.add('hidden'), 2600);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function api(endpoint, options = {}) {
    if (!token) return { success: false, auth: true };
    try {
      const res = await fetch(`${API}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(options.headers || {})
        }
      });
      const data = await res.json();
      if (res.status === 401) {
        token = null;
        localStorage.removeItem('qs_token');
        return { success: false, auth: true, error: data.error };
      }
      return data;
    } catch {
      return { success: false, error: t('networkError') };
    }
  }

  async function login() {
    const email = $('#quiz-email').value.trim();
    const password = $('#quiz-password').value;
    const error = $('#quiz-login-error');
    error.classList.add('hidden');
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, rememberMe: true })
    }).then(r => r.json()).catch(() => ({ success: false, error: t('networkError') }));

    if (res.success && res.token) {
      token = res.token;
      localStorage.setItem('qs_token', token);
      $('#auth-card').classList.add('hidden');
      $('#notes-shell').classList.remove('hidden');
      await loadNotes();
    } else {
      error.textContent = res.error || t('loginError');
      error.classList.remove('hidden');
    }
  }

  function getFilterParams() {
    const params = new URLSearchParams();
    const search = $('#notes-search').value.trim();
    const filter = $('#notes-filter').value;
    if (search) params.set('search', search);
    if (filter === 'favorite') params.set('favorite', 'true');
    if (['new', 'learning', 'mastered'].includes(filter)) params.set('status', filter);
    return params.toString();
  }

  async function loadNotes() {
    const qs = getFilterParams();
    const res = await api(`/api/quiz/study-notes${qs ? `?${qs}` : ''}`);
    if (res.auth) {
      $('#auth-card').classList.remove('hidden');
      $('#notes-shell').classList.add('hidden');
      return;
    }
    if (!res.success) {
      showToast(res.error || t('loadError'));
      return;
    }
    notes = res.notes || [];
    selected = new Set([...selected].filter(id => notes.some(note => note.id === id)));
    renderNotes();
  }

  function renderNotes() {
    $('#notes-count').textContent = notes.length;
    $('#notes-empty').classList.toggle('hidden', notes.length > 0);
    const grid = $('#notes-grid');
    grid.innerHTML = notes.map(note => {
      const statusLabel = t(note.status || 'new');
      return `
        <article class="note-card glass-card ${selected.has(note.id) ? 'is-selected' : ''}" data-id="${note.id}">
          <div class="note-card-top">
            <label class="note-check">
              <input type="checkbox" data-action="select" ${selected.has(note.id) ? 'checked' : ''}>
              <span>${t('selected')}</span>
            </label>
            <button class="note-favorite ${note.favorite ? 'active' : ''}" data-action="favorite" title="${t('favorite')}">★</button>
          </div>
          <h3>${escapeHtml(note.questionText)}</h3>
          <div class="note-meta">
            <span>${escapeHtml(note.questionType)}</span>
            <span>${escapeHtml(statusLabel)}</span>
            ${note.platform ? `<span>${escapeHtml(note.platform)}</span>` : ''}
          </div>
          <p class="note-answer"><strong>${t('answer')}:</strong> ${escapeHtml(note.answerText)}</p>
          <p class="note-explanation"><strong>${t('explanation')}:</strong> ${escapeHtml(note.explanation || t('noExplanation'))}</p>
          <select class="note-status" data-action="status">
            <option value="new" ${note.status === 'new' ? 'selected' : ''}>${t('new')}</option>
            <option value="learning" ${note.status === 'learning' ? 'selected' : ''}>${t('learning')}</option>
            <option value="mastered" ${note.status === 'mastered' ? 'selected' : ''}>${t('mastered')}</option>
          </select>
        </article>
      `;
    }).join('');
  }

  async function updateNote(id, patch) {
    const res = await api(`/api/quiz/study-notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
    if (res.success && res.note) {
      notes = notes.map(note => note.id === id ? res.note : note);
      renderNotes();
    } else {
      showToast(res.error || t('loadError'));
    }
  }

  function renderPracticeQuestion() {
    const note = practice[currentIndex];
    checked = false;
    $('#practice-result').classList.add('hidden');
    $('#practice-card').classList.remove('hidden');
    $('#practice-index').textContent = currentIndex + 1;
    $('#practice-total').textContent = practice.length;
    $('#practice-meta').textContent = `${note.questionType}${note.platform ? ` · ${note.platform}` : ''}`;
    $('#practice-question').textContent = note.questionText;
    $('#practice-feedback').classList.add('hidden');
    $('#next-question-btn').classList.add('hidden');
    $('#check-answer-btn').classList.remove('hidden');

    const container = $('#practice-options');
    if (note.questionType === 'text') {
      container.innerHTML = `<input class="form-input" id="practice-text-answer" type="text" placeholder="${t('textPlaceholder')}">`;
      return;
    }

    const inputType = note.questionType === 'checkbox' ? 'checkbox' : 'radio';
    container.innerHTML = (note.options || []).map((option, index) => `
      <label class="practice-option">
        <input type="${inputType}" name="practice-answer" value="${index}">
        <span>${escapeHtml(option)}</span>
      </label>
    `).join('');
  }

  function normalizeText(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function isCorrect(note) {
    if (note.questionType === 'text') {
      return normalizeText($('#practice-text-answer')?.value) === normalizeText(note.answerText);
    }

    const chosen = [...$$('input[name="practice-answer"]:checked')].map(input => Number(input.value)).sort((a, b) => a - b);
    if (note.questionType === 'checkbox') {
      const correct = Array.isArray(note.answer) ? [...note.answer].map(Number).sort((a, b) => a - b) : [];
      return chosen.length === correct.length && chosen.every((value, index) => value === correct[index]);
    }
    return chosen.length === 1 && chosen[0] === Number(note.answer);
  }

  function revealAnswer(note, ok) {
    const feedback = $('#practice-feedback');
    feedback.className = `practice-feedback ${ok ? 'success' : 'error'}`;
    feedback.innerHTML = `
      <strong>${ok ? t('correct') : t('incorrect')}.</strong>
      <div>${t('answer')}: ${escapeHtml(note.answerText)}</div>
      <div>${t('explanation')}: ${escapeHtml(note.explanation || t('noExplanation'))}</div>
    `;
    $('#check-answer-btn').classList.add('hidden');
    $('#next-question-btn').classList.remove('hidden');
    checked = true;
    if (ok) score += 1;
  }

  function finishPractice() {
    $('#practice-card').classList.add('hidden');
    $('#practice-result').classList.remove('hidden');
    $('#practice-score').textContent = score;
    $('#practice-score-total').textContent = practice.length;
  }

  async function startPractice() {
    if (selected.size === 0) {
      showToast(t('selectAtLeastOne'));
      return;
    }
    const res = await api('/api/quiz/practice', {
      method: 'POST',
      body: JSON.stringify({ noteIds: [...selected] })
    });
    if (!res.success) {
      showToast(res.error || t('loadError'));
      return;
    }
    practice = res.questions || [];
    currentIndex = 0;
    score = 0;
    $('#notes-shell').classList.add('hidden');
    $('#practice-shell').classList.remove('hidden');
    renderPracticeQuestion();
  }

  applyI18n();

  $$('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      lang = btn.dataset.lang;
      localStorage.setItem('qs_lang', lang);
      applyI18n();
      renderNotes();
      if (practice.length > 0 && !$('#practice-shell').classList.contains('hidden')) renderPracticeQuestion();
    });
  });

  $('#quiz-login-btn').addEventListener('click', login);
  ['quiz-email', 'quiz-password'].forEach(id => {
    $(`#${id}`).addEventListener('keydown', event => {
      if (event.key === 'Enter') login();
    });
  });

  $('#notes-search').addEventListener('input', () => {
    clearTimeout(loadNotes.searchTimer);
    loadNotes.searchTimer = setTimeout(loadNotes, 250);
  });
  $('#notes-filter').addEventListener('change', loadNotes);
  $('#select-visible-btn').addEventListener('click', () => {
    notes.forEach(note => selected.add(note.id));
    renderNotes();
  });
  $('#start-practice-btn').addEventListener('click', startPractice);

  $('#notes-grid').addEventListener('change', event => {
    const card = event.target.closest('.note-card');
    if (!card) return;
    const id = card.dataset.id;
    if (event.target.dataset.action === 'select') {
      if (event.target.checked) selected.add(id);
      else selected.delete(id);
      renderNotes();
    }
    if (event.target.dataset.action === 'status') {
      updateNote(id, { status: event.target.value });
    }
  });

  $('#notes-grid').addEventListener('click', event => {
    const favoriteBtn = event.target.closest('[data-action="favorite"]');
    if (!favoriteBtn) return;
    const card = favoriteBtn.closest('.note-card');
    const note = notes.find(item => item.id === card.dataset.id);
    if (note) updateNote(note.id, { favorite: !note.favorite });
  });

  $('#check-answer-btn').addEventListener('click', () => {
    if (checked) return;
    const note = practice[currentIndex];
    revealAnswer(note, isCorrect(note));
  });

  $('#next-question-btn').addEventListener('click', () => {
    currentIndex += 1;
    if (currentIndex >= practice.length) finishPractice();
    else renderPracticeQuestion();
  });

  $('#back-to-notes-btn').addEventListener('click', () => {
    $('#practice-shell').classList.add('hidden');
    $('#notes-shell').classList.remove('hidden');
  });

  $('#restart-practice-btn').addEventListener('click', () => {
    currentIndex = 0;
    score = 0;
    $('#practice-result').classList.add('hidden');
    renderPracticeQuestion();
  });

  if (token) {
    $('#notes-shell').classList.remove('hidden');
    loadNotes();
  } else {
    $('#auth-card').classList.remove('hidden');
  }
})();
