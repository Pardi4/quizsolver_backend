(() => {
  const API = window.location.origin;
  let currentUser = null;
  let authToken = localStorage.getItem('qs_token') || null;
  let lang = 'en';

  const i18n = {
    en: {
      meta_title: 'QuizSolver - AI Quiz Assistant | Testportal Quiz Solver',
      meta_description: 'QuizSolver is an AI-powered browser extension for quiz practice, answer explanations, and supported quiz platforms including Testportal, Google Forms, Microsoft Forms, Moodle, Canvas, Blackboard, Quizlet, Socrative, Kahoot, and Quizizz.',
      meta_keywords: 'testportal quiz solver, Testportal solver, quiz solver, AI quiz solver, quiz solver extension, Google Forms solver, Microsoft Forms solver, Moodle quiz solver, Canvas quiz helper, online test solver, answer explanation AI, quiz answer assistant, getquizsolver',
      meta_og_title: 'QuizSolver - AI Quiz Assistant',
      meta_og_description: 'AI-powered quiz assistant with answer explanations, browser extension support, and compatibility with Testportal, Google Forms, Microsoft Forms, Moodle, Canvas, and more.',
      nav_features: 'Features',
      nav_platforms: 'Platforms',
      nav_pricing: 'Pricing',
      nav_mobile: 'Mobile',
      nav_study: 'Study Notes',
      nav_leaderboard: 'Leaderboard',
      nav_login: 'Log in',
      nav_signup: 'Sign up',
      nav_toggle: 'Toggle menu',
      dropdown_dashboard: 'Dashboard',
      dropdown_buy: 'Buy Credits',
      dropdown_history: 'History',
      dropdown_logout: 'Log out',
      hero_badge: 'AI-powered quiz assistance',
      hero_title_line1: 'QuizSolver',
      hero_title_line2: 'AI quiz assistant',
      hero_subtitle: 'Practice faster with an AI browser extension that detects quiz questions, suggests answers, and explains the reasoning in seconds.',
      hero_cta: 'Get Started Free',
      hero_secondary: 'See How It Works',
      stat_users: 'Active Users',
      stat_questions: 'Questions Solved',
      stat_accuracy: 'Accuracy',
      mock_badge: 'Question 3/10',
      mock_question: 'What is the capital of France?',
      mock_option_1: 'Berlin',
      mock_option_2: 'Madrid',
      mock_option_3: 'Paris',
      mock_option_4: 'Rome',
      mock_status: 'Solved in 0.8s',
      features_badge: 'Features',
      features_title: 'Everything You Need',
      features_subtitle: 'Tools for faster practice, review, and answer checking.',
      feature_ai_title: 'AI-Powered Answers',
      feature_ai_text: 'The model analyzes question text, options, and supported images to suggest concise answers.',
      feature_image_title: 'Image Recognition',
      feature_image_text: 'Visual questions can be sent with context, so diagrams and screenshots are easier to review.',
      feature_cache_title: 'Smart Caching',
      feature_cache_text: 'Repeated questions are matched from cache for faster responses and lower credit use.',
      feature_types_title: 'All Question Types',
      feature_types_text: 'Single choice, multiple choice, and short text answers are handled in one workflow.',
      feature_hint_title: 'Hint Mode',
      feature_hint_text: 'Highlight the suggested answer instead of clicking it, useful for learning and checking.',
      feature_explain_title: 'Explanation Mode',
      feature_explain_text: 'Ask for a short explanation after solving to understand why an answer fits.',
      platforms_badge: 'Compatibility',
      platforms_title: 'Works on Major Quiz Platforms',
      platforms_subtitle: 'Known platforms load automatically, and optional permissions let you enable trusted pages one by one.',
      pricing_badge: 'Pricing',
      pricing_title: 'Simple, Transparent Pricing',
      pricing_subtitle: 'Start free with 10 credits/month. Buy more only when you need them.',
      starter_credits: '100 credits',
      starter_feature_1: '100 quiz questions',
      popular_credits: '500 credits',
      popular_feature_1: '500 quiz questions',
      pro_credits: '2000 credits',
      pro_feature_1: '2000 quiz questions',
      pricing_feature_types: 'All question types',
      pricing_feature_image: 'Image recognition',
      pricing_feature_cache: 'Smart caching',
      pricing_feature_priority: 'Priority support',
      pricing_feature_explain: 'Explanation mode',
      badge_popular: 'Most Popular',
      badge_best: 'Best Value',
      buy_starter: 'Buy Starter',
      buy_popular: 'Buy Popular',
      buy_pro: 'Buy Pro',
      mobile_badge: 'Mobile',
      mobile_title: 'Use on Your Phone',
      mobile_subtitle: 'Install the extension on mobile browsers that support Chromium extensions.',
      mobile_step1_title: 'Download a compatible browser',
      mobile_step1_text_a: 'Install',
      mobile_step1_text_b: 'on Android or',
      mobile_step1_text_c: 'on iOS.',
      mobile_step2_title: 'Enable Developer Mode',
      mobile_step2_text: 'Open the browser extension settings and turn Developer mode on.',
      mobile_step3_title: 'Load the Extension',
      mobile_step3_text: 'Download the extension package, extract it, and load it as an unpacked extension.',
      mobile_step4_title: 'Start Practicing',
      mobile_step4_text: 'Log in with your QuizSolver account, open a quiz page, and choose your preferred mode.',
      leaderboard_badge: 'Leaderboard',
      leaderboard_title: 'Top Solvers',
      leaderboard_subtitle: 'The most active QuizSolver users this month.',
      leaderboard_user: 'User',
      leaderboard_questions: 'Questions',
      leaderboard_streak: 'Streak',
      loading: 'Loading...',
      dashboard_badge: 'Dashboard',
      dashboard_title: 'Your Account',
      dashboard_credits: 'Credits',
      dashboard_questions: 'Questions Solved',
      dashboard_streak: 'Day Streak',
      dashboard_referral: 'Referral Code',
      dashboard_copy: 'Copy Link',
      dashboard_history: 'Purchase History',
      dashboard_no_purchases: 'No purchases yet.',
      footer_desc: 'AI-powered quiz practice and answer explanations.',
      footer_product: 'Product',
      footer_mobile_install: 'Mobile Install',
      footer_legal: 'Legal',
      footer_privacy: 'Privacy Policy',
      footer_support: 'Support',
      footer_contact: 'Contact Us',
      footer_rights: '© 2026 QuizSolver. All rights reserved.',
      modal_close: 'Close',
      login_title: 'Welcome Back',
      login_subtitle: 'Sign in to your account',
      email_placeholder: 'Email',
      password_placeholder: 'Password',
      remember_me: 'Remember me',
      login_button: 'Sign In',
      login_switch_text: "Don't have an account?",
      login_switch_link: 'Sign up',
      register_title: 'Create Account',
      register_subtitle: 'Start practicing for free',
      display_name_placeholder: 'Display name',
      register_password_placeholder: 'Password (min 8 chars)',
      confirm_password_placeholder: 'Confirm password',
      referral_placeholder: 'Referral code (optional)',
      register_button: 'Create Account',
      register_switch_text: 'Already have an account?',
      register_switch_link: 'Sign in',
      session_expired: 'Session expired.',
      network_error: 'Network error.',
      logged_out: 'Logged out.',
      fill_fields: 'Please fill in all fields.',
      email_password_required: 'Email and password are required.',
      password_short: 'Password must be at least 8 characters.',
      password_mismatch: 'Passwords do not match.',
      login_failed: 'Login failed.',
      register_failed: 'Registration failed.',
      welcome_back: 'Welcome back!',
      account_created: 'Account created! You got 10 free credits.',
      login_first: 'Please log in first to buy credits.',
      redirecting: 'Redirecting...',
      checkout_error: 'Error creating checkout.',
      referral_copied: 'Referral link copied!',
      copy_failed: 'Copy failed.',
      no_leaderboard: 'No data yet.',
      leaderboard_error: 'Could not load leaderboard.',
      credits_unit: 'credits'
    },
    pl: {
      meta_title: 'QuizSolver - asystent AI do quizów | Testportal quiz solver',
      meta_description: 'QuizSolver to rozszerzenie przeglądarki z AI do ćwiczenia quizów, wyjaśniania odpowiedzi i pracy na platformach takich jak Testportal, Google Forms, Microsoft Forms, Moodle, Canvas, Blackboard, Quizlet, Socrative, Kahoot i Quizizz.',
      meta_keywords: 'testportal quiz solver, Testportal solver, rozwiązywanie quizów AI, quiz solver, rozszerzenie do quizów, Google Forms solver, Microsoft Forms solver, Moodle quiz solver, asystent odpowiedzi AI, wyjaśnianie odpowiedzi AI, getquizsolver',
      meta_og_title: 'QuizSolver - asystent AI do quizów',
      meta_og_description: 'Asystent AI do quizów z wyjaśnieniami odpowiedzi, rozszerzeniem przeglądarki i obsługą Testportal, Google Forms, Microsoft Forms, Moodle, Canvas i innych platform.',
      nav_features: 'Funkcje',
      nav_platforms: 'Platformy',
      nav_pricing: 'Cennik',
      nav_mobile: 'Mobile',
      nav_study: 'Notatki',
      nav_leaderboard: 'Ranking',
      nav_login: 'Logowanie',
      nav_signup: 'Rejestracja',
      nav_toggle: 'Przełącz menu',
      dropdown_dashboard: 'Panel',
      dropdown_buy: 'Kup kredyty',
      dropdown_history: 'Historia',
      dropdown_logout: 'Wyloguj',
      hero_badge: 'Asystent AI do quizów',
      hero_title_line1: 'QuizSolver',
      hero_title_line2: 'asystent AI do quizów',
      hero_subtitle: 'Ćwicz szybciej z rozszerzeniem przeglądarki, które wykrywa pytania, sugeruje odpowiedzi i wyjaśnia tok rozumowania w kilka sekund.',
      hero_cta: 'Zacznij za darmo',
      hero_secondary: 'Zobacz jak działa',
      stat_users: 'Aktywnych użytkowników',
      stat_questions: 'Rozwiązanych pytań',
      stat_accuracy: 'Trafność',
      mock_badge: 'Pytanie 3/10',
      mock_question: 'Jaka jest stolica Francji?',
      mock_option_1: 'Berlin',
      mock_option_2: 'Madryt',
      mock_option_3: 'Paryż',
      mock_option_4: 'Rzym',
      mock_status: 'Rozwiązano w 0,8 s',
      features_badge: 'Funkcje',
      features_title: 'Wszystko, czego potrzebujesz',
      features_subtitle: 'Narzędzia do szybszego ćwiczenia, sprawdzania i powtarzania odpowiedzi.',
      feature_ai_title: 'Odpowiedzi z AI',
      feature_ai_text: 'Model analizuje treść pytania, odpowiedzi i obsługiwane obrazy, aby sugerować krótkie odpowiedzi.',
      feature_image_title: 'Rozpoznawanie obrazów',
      feature_image_text: 'Pytania wizualne mogą być wysyłane z kontekstem, dzięki czemu diagramy i zrzuty ekranu łatwiej przejrzeć.',
      feature_cache_title: 'Inteligentny cache',
      feature_cache_text: 'Powtarzające się pytania są dopasowywane z pamięci podręcznej, co przyspiesza odpowiedzi i zmniejsza zużycie kredytów.',
      feature_types_title: 'Typy pytań',
      feature_types_text: 'Pojedynczy wybór, wielokrotny wybór i krótkie odpowiedzi tekstowe działają w jednym przepływie.',
      feature_hint_title: 'Tryb podpowiedzi',
      feature_hint_text: 'Podświetl sugerowaną odpowiedź zamiast ją klikać, co pomaga w nauce i sprawdzaniu.',
      feature_explain_title: 'Wyjaśnianie odpowiedzi',
      feature_explain_text: 'Po rozwiązaniu możesz poprosić o krótkie wyjaśnienie, żeby zrozumieć, dlaczego odpowiedź pasuje.',
      platforms_badge: 'Kompatybilność',
      platforms_title: 'Działa na głównych platformach quizowych',
      platforms_subtitle: 'Znane platformy uruchamiają się automatycznie, a opcjonalne uprawnienia pozwalają włączać zaufane strony pojedynczo.',
      pricing_badge: 'Cennik',
      pricing_title: 'Prosty i przejrzysty cennik',
      pricing_subtitle: 'Zacznij za darmo z 10 kredytami miesięcznie. Dokupuj tylko wtedy, gdy potrzebujesz.',
      starter_credits: '100 kredytów',
      starter_feature_1: '100 pytań quizowych',
      popular_credits: '500 kredytów',
      popular_feature_1: '500 pytań quizowych',
      pro_credits: '2000 kredytów',
      pro_feature_1: '2000 pytań quizowych',
      pricing_feature_types: 'Wszystkie typy pytań',
      pricing_feature_image: 'Rozpoznawanie obrazów',
      pricing_feature_cache: 'Inteligentny cache',
      pricing_feature_priority: 'Priorytetowe wsparcie',
      pricing_feature_explain: 'Tryb wyjaśnień',
      badge_popular: 'Najpopularniejsze',
      badge_best: 'Najlepsza oferta',
      buy_starter: 'Kup Starter',
      buy_popular: 'Kup Popular',
      buy_pro: 'Kup Pro',
      mobile_badge: 'Mobile',
      mobile_title: 'Używaj na telefonie',
      mobile_subtitle: 'Zainstaluj rozszerzenie w przeglądarkach mobilnych obsługujących rozszerzenia Chromium.',
      mobile_step1_title: 'Pobierz zgodną przeglądarkę',
      mobile_step1_text_a: 'Zainstaluj',
      mobile_step1_text_b: 'na Androidzie albo',
      mobile_step1_text_c: 'na iOS.',
      mobile_step2_title: 'Włącz tryb dewelopera',
      mobile_step2_text: 'Otwórz ustawienia rozszerzeń w przeglądarce i włącz tryb dewelopera.',
      mobile_step3_title: 'Wczytaj rozszerzenie',
      mobile_step3_text: 'Pobierz paczkę rozszerzenia, rozpakuj ją i wczytaj jako rozszerzenie bez pakowania.',
      mobile_step4_title: 'Zacznij ćwiczyć',
      mobile_step4_text: 'Zaloguj się na konto QuizSolver, otwórz stronę z quizem i wybierz preferowany tryb.',
      leaderboard_badge: 'Ranking',
      leaderboard_title: 'Najaktywniejsi użytkownicy',
      leaderboard_subtitle: 'Najbardziej aktywni użytkownicy QuizSolver w tym miesiącu.',
      leaderboard_user: 'Użytkownik',
      leaderboard_questions: 'Pytania',
      leaderboard_streak: 'Seria',
      loading: 'Ładowanie...',
      dashboard_badge: 'Panel',
      dashboard_title: 'Twoje konto',
      dashboard_credits: 'Kredyty',
      dashboard_questions: 'Rozwiązane pytania',
      dashboard_streak: 'Dni serii',
      dashboard_referral: 'Kod polecający',
      dashboard_copy: 'Kopiuj link',
      dashboard_history: 'Historia zakupów',
      dashboard_no_purchases: 'Brak zakupów.',
      footer_desc: 'Ćwiczenie quizów z AI i wyjaśnianie odpowiedzi.',
      footer_product: 'Produkt',
      footer_mobile_install: 'Instalacja mobile',
      footer_legal: 'Prawne',
      footer_privacy: 'Polityka prywatności',
      footer_support: 'Wsparcie',
      footer_contact: 'Kontakt',
      footer_rights: '© 2026 QuizSolver. Wszelkie prawa zastrzeżone.',
      modal_close: 'Zamknij',
      login_title: 'Witaj ponownie',
      login_subtitle: 'Zaloguj się na swoje konto',
      email_placeholder: 'Email',
      password_placeholder: 'Hasło',
      remember_me: 'Zapamiętaj mnie',
      login_button: 'Zaloguj się',
      login_switch_text: 'Nie masz konta?',
      login_switch_link: 'Zarejestruj się',
      register_title: 'Utwórz konto',
      register_subtitle: 'Zacznij ćwiczyć za darmo',
      display_name_placeholder: 'Nazwa wyświetlana',
      register_password_placeholder: 'Hasło (min. 8 znaków)',
      confirm_password_placeholder: 'Potwierdź hasło',
      referral_placeholder: 'Kod polecający (opcjonalnie)',
      register_button: 'Utwórz konto',
      register_switch_text: 'Masz już konto?',
      register_switch_link: 'Zaloguj się',
      session_expired: 'Sesja wygasła.',
      network_error: 'Błąd sieci.',
      logged_out: 'Wylogowano.',
      fill_fields: 'Wypełnij wszystkie pola.',
      email_password_required: 'Email i hasło są wymagane.',
      password_short: 'Hasło musi mieć co najmniej 8 znaków.',
      password_mismatch: 'Hasła nie są takie same.',
      login_failed: 'Logowanie nie powiodło się.',
      register_failed: 'Rejestracja nie powiodła się.',
      welcome_back: 'Witaj ponownie!',
      account_created: 'Konto utworzone! Otrzymujesz 10 darmowych kredytów.',
      login_first: 'Zaloguj się, aby kupić kredyty.',
      redirecting: 'Przekierowuję...',
      checkout_error: 'Nie udało się utworzyć płatności.',
      referral_copied: 'Link polecający skopiowany!',
      copy_failed: 'Nie udało się skopiować.',
      no_leaderboard: 'Brak danych.',
      leaderboard_error: 'Nie udało się wczytać rankingu.',
      credits_unit: 'kredytów'
    }
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const buyKeyByPack = { starter: 'buy_starter', popular: 'buy_popular', pro: 'buy_pro' };

  function normalizeLang(value) {
    return value && value.toLowerCase().startsWith('pl') ? 'pl' : 'en';
  }

  function t(key) {
    return i18n[lang]?.[key] || i18n.en[key] || key;
  }

  function updateMeta(selector, value) {
    const el = document.querySelector(selector);
    if (el) el.setAttribute('content', value);
  }

  function applyI18n() {
    document.documentElement.lang = lang;
    document.title = t('meta_title');
    updateMeta('meta[name="description"]', t('meta_description'));
    updateMeta('meta[name="keywords"]', t('meta_keywords'));
    updateMeta('meta[property="og:title"]', t('meta_og_title'));
    updateMeta('meta[property="og:description"]', t('meta_og_description'));
    updateMeta('meta[name="twitter:title"]', t('meta_og_title'));
    updateMeta('meta[name="twitter:description"]', t('meta_og_description'));
    updateMeta('meta[property="og:locale"]', lang === 'pl' ? 'pl_PL' : 'en_US');

    $$('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    $$('[data-i18n-placeholder]').forEach(el => {
      el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
    });
    $$('[data-i18n-aria-label]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
    });
    $$('[data-i18n-title]').forEach(el => {
      el.setAttribute('title', t(el.dataset.i18nTitle));
    });

    $$('[data-lang]').forEach(btn => {
      const active = btn.dataset.lang === lang;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function setLanguage(nextLang) {
    lang = normalizeLang(nextLang);
    localStorage.setItem('qs_lang', lang);
    applyI18n();
  }

  function initLanguage() {
    const urlLang = new URLSearchParams(window.location.search).get('lang');
    lang = normalizeLang(urlLang || localStorage.getItem('qs_lang') || navigator.language || 'en');
    localStorage.setItem('qs_lang', lang);
    applyI18n();
  }

  function api(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...options.headers };
    return fetch(`${API}${endpoint}`, { ...options, headers }).then(async (r) => {
      const data = await r.json();
      if (r.status === 401) {
        logout(false);
        return { success: false, error: t('session_expired') };
      }
      return data;
    }).catch(() => ({ success: false, error: t('network_error') }));
  }

  function showToast(msg, duration = 3000) {
    const toast = $('#toast');
    $('#toast-message').textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toast._tid);
    toast._tid = setTimeout(() => toast.classList.add('hidden'), duration);
  }

  function setLoading(btn, on) {
    const text = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.btn-loader');
    if (text) text.classList.toggle('hidden', on);
    if (loader) loader.classList.toggle('hidden', !on);
    btn.disabled = on;
  }

  function showError(id, msg) {
    const el = $(`#${id}`);
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function hideError(id) {
    const el = $(`#${id}`);
    el.textContent = '';
    el.classList.add('hidden');
  }

  function openModal(form) {
    $('#auth-modal-overlay').classList.remove('hidden');
    $('#login-form').classList.toggle('hidden', form !== 'login');
    $('#register-form').classList.toggle('hidden', form !== 'register');
    hideError('modal-login-error');
    hideError('modal-register-error');
  }

  function closeModal() {
    $('#auth-modal-overlay').classList.add('hidden');
  }

  function setAuthUI() {
    if (currentUser) {
      $('#nav-guest').classList.add('hidden');
      $('#nav-user').classList.remove('hidden');
      const name = currentUser.displayName || currentUser.email.split('@')[0];
      $('#nav-avatar').textContent = name[0].toUpperCase();
      $('#dropdown-name').textContent = name;
      $('#dropdown-email').textContent = currentUser.email;
      const credits = currentUser.role === 'admin' ? '∞' : (currentUser.credits || 0);
      $('#nav-credits-count').textContent = credits;
    } else {
      $('#nav-guest').classList.remove('hidden');
      $('#nav-user').classList.add('hidden');
    }
  }

  function updateDashboard() {
    if (!currentUser) return;
    const credits = currentUser.role === 'admin' ? '∞' : (currentUser.credits || 0);
    $('#dash-credits').textContent = credits;
    $('#dash-questions').textContent = currentUser.stats?.totalQuestionsSolved || 0;
    $('#dash-streak').textContent = currentUser.streak?.current || 0;
    $('#dash-referral').textContent = currentUser.referralCode || '---';
  }

  async function loadHistory() {
    const res = await api('/api/credits/history');
    const list = $('#dash-history-list');
    if (res.success && res.purchases && res.purchases.length > 0) {
      list.innerHTML = res.purchases.map(p => `<div class="dash-history-item"><span>${escapeHtml(p.pack)} (${p.credits} ${t('credits_unit')})</span><span>${new Date(p.createdAt).toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-US')}</span></div>`).join('');
    } else {
      list.innerHTML = `<p class="dash-empty">${t('dashboard_no_purchases')}</p>`;
    }
  }

  async function loadLeaderboard() {
    try {
      const res = await api('/api/leaderboard');
      const container = $('#leaderboard-rows');
      if (res.success && res.leaderboard && res.leaderboard.length > 0) {
        container.innerHTML = res.leaderboard.map(entry => {
          const rankClass = entry.rank === 1 ? 'gold' : entry.rank === 2 ? 'silver' : entry.rank === 3 ? 'bronze' : '';
          return `<div class="leaderboard-row"><span class="leaderboard-rank ${rankClass}">${entry.rank}</span><span>${escapeHtml(entry.name)}</span><span>${entry.questionsSolved}</span><span>${entry.streak}</span></div>`;
        }).join('');
      } else {
        container.innerHTML = `<div class="leaderboard-loading">${t('no_leaderboard')}</div>`;
      }
    } catch {
      $('#leaderboard-rows').innerHTML = `<div class="leaderboard-loading">${t('leaderboard_error')}</div>`;
    }
  }

  async function checkAuth() {
    if (!authToken) {
      setAuthUI();
      return;
    }
    const res = await api('/api/auth/me');
    if (res.success) {
      currentUser = res.user;
      setAuthUI();
      updateDashboard();
    } else {
      authToken = null;
      localStorage.removeItem('qs_token');
      currentUser = null;
      setAuthUI();
    }
  }

  function login(email, password, remember) {
    return api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, rememberMe: remember })
    });
  }

  function register(email, password, displayName, referralCode) {
    return api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName, referralCode })
    });
  }

  function logout(showMessage = true) {
    if (authToken) api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    authToken = null;
    currentUser = null;
    localStorage.removeItem('qs_token');
    setAuthUI();
    $('#dashboard').classList.add('hidden');
    if (showMessage) showToast(t('logged_out'));
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  initLanguage();

  $$('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
  });

  $('#nav-login-btn').addEventListener('click', () => openModal('login'));
  $('#nav-register-btn').addEventListener('click', () => openModal('register'));
  $('#modal-close-btn').addEventListener('click', closeModal);
  $('#auth-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  $('#show-register-form').addEventListener('click', (e) => {
    e.preventDefault();
    openModal('register');
  });
  $('#show-login-form').addEventListener('click', (e) => {
    e.preventDefault();
    openModal('login');
  });

  $('#modal-login-btn').addEventListener('click', async () => {
    const email = $('#modal-login-email').value.trim();
    const password = $('#modal-login-password').value;
    const remember = $('#modal-remember-me').checked;
    hideError('modal-login-error');
    if (!email || !password) return showError('modal-login-error', t('fill_fields'));

    const btn = $('#modal-login-btn');
    setLoading(btn, true);
    const res = await login(email, password, remember);
    setLoading(btn, false);

    if (res.success && res.token) {
      authToken = res.token;
      localStorage.setItem('qs_token', res.token);
      currentUser = res.user;
      setAuthUI();
      updateDashboard();
      closeModal();
      showToast(t('welcome_back'));
    } else {
      showError('modal-login-error', res.error || t('login_failed'));
    }
  });

  $('#modal-register-btn').addEventListener('click', async () => {
    const name = $('#modal-register-name').value.trim();
    const email = $('#modal-register-email').value.trim();
    const password = $('#modal-register-password').value;
    const confirm = $('#modal-register-confirm').value;
    const referral = $('#modal-register-referral').value.trim();
    hideError('modal-register-error');
    if (!email || !password) return showError('modal-register-error', t('email_password_required'));
    if (password.length < 8) return showError('modal-register-error', t('password_short'));
    if (password !== confirm) return showError('modal-register-error', t('password_mismatch'));

    const btn = $('#modal-register-btn');
    setLoading(btn, true);
    const res = await register(email, password, name, referral);
    setLoading(btn, false);

    if (res.success && res.token) {
      authToken = res.token;
      localStorage.setItem('qs_token', res.token);
      currentUser = res.user;
      setAuthUI();
      updateDashboard();
      closeModal();
      showToast(t('account_created'));
    } else {
      showError('modal-register-error', res.error || t('register_failed'));
    }
  });

  $('#nav-avatar-wrap').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#nav-dropdown').classList.toggle('show');
  });
  document.addEventListener('click', () => {
    $('#nav-dropdown').classList.remove('show');
  });

  $('#dropdown-logout-btn').addEventListener('click', () => logout());

  $('#dropdown-dashboard-btn').addEventListener('click', () => {
    $('#dashboard').classList.remove('hidden');
    loadHistory();
    $('#dashboard').scrollIntoView({ behavior: 'smooth' });
  });

  $('#dropdown-buy-btn').addEventListener('click', () => {
    $('#pricing').scrollIntoView({ behavior: 'smooth' });
  });

  $('#dropdown-history-btn').addEventListener('click', () => {
    $('#dashboard').classList.remove('hidden');
    loadHistory();
    $('#dashboard').scrollIntoView({ behavior: 'smooth' });
  });

  $$('.buy-pack-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pack = btn.dataset.pack;
      if (!currentUser) {
        openModal('login');
        showToast(t('login_first'));
        return;
      }

      btn.disabled = true;
      btn.textContent = t('redirecting');
      const res = await api('/api/credits/buy', {
        method: 'POST',
        body: JSON.stringify({ pack })
      });

      if (res.success && res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
      } else {
        btn.disabled = false;
        btn.textContent = t(buyKeyByPack[pack] || 'buy_starter');
        showToast(res.error || t('checkout_error'), 4000);
      }
    });
  });

  $('#copy-referral-btn')?.addEventListener('click', () => {
    if (!currentUser?.referralCode) return;
    const link = `${window.location.origin}?ref=${currentUser.referralCode}`;
    navigator.clipboard
      .writeText(link)
      .then(() => showToast(t('referral_copied')))
      .catch(() => showToast(t('copy_failed')));
  });

  $('#nav-hamburger').addEventListener('click', () => {
    $('#nav-links').classList.toggle('show');
  });

  ['modal-login-email', 'modal-login-password'].forEach(id => {
    $(`#${id}`).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#modal-login-btn').click();
    });
  });

  ['modal-register-email', 'modal-register-password', 'modal-register-confirm'].forEach(id => {
    $(`#${id}`).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#modal-register-btn').click();
    });
  });

  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref');
  if (refCode) {
    openModal('register');
    const refInput = $('#modal-register-referral');
    if (refInput) refInput.value = refCode;
  }

  checkAuth();
  loadLeaderboard();

  $$('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      $('#nav-links').classList.remove('show');
    });
  });
})();
