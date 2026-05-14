(() => {
  const API = window.location.origin;
  const locale = document.body.dataset.locale === 'pl' ? 'pl' : 'en';
  const homePath = document.body.dataset.homePath || (locale === 'pl' ? '/pl/' : '/');
  const dashboardPath = document.body.dataset.dashboardPath || (locale === 'pl' ? '/pl/dashboard' : '/dashboard');
  const isDashboardPage = document.body.dataset.page === 'dashboard';
  let authToken = localStorage.getItem('qs_token') || null;
  let currentUser = null;
  let dashboardHistoryLoaded = false;
  let referralStatsLoaded = false;
  let currentReferralLink = '';

  const messages = {
    en: {
      fillFields: 'Fill in all required fields.',
      emailPasswordRequired: 'Email and password are required.',
      passwordShort: 'Password must be at least 8 characters.',
      passwordMismatch: 'Passwords do not match.',
      networkError: 'Network error. Try again.',
      sessionExpired: 'Session expired. Sign in again.',
      loginFailed: 'Login failed.',
      registerFailed: 'Registration failed.',
      welcomeBack: 'Welcome back.',
      accountCreated: 'Account created.',
      loggedOut: 'Logged out.',
      loginFirst: 'Sign in first to buy credits.',
      redirecting: 'Redirecting...',
      checkoutError: 'Could not open checkout.',
      noLeaderboard: 'No leaderboard data yet.',
      leaderboardError: 'Could not load leaderboard.',
      creditsUnit: 'credits',
      referralCopied: 'Referral link copied.',
      copyFailed: 'Could not copy link.',
      buyCredits: 'Buy Credits',
      noPurchases: 'No purchases yet.'
    },
    pl: {
      fillFields: 'Uzupełnij wymagane pola.',
      emailPasswordRequired: 'Email i hasło są wymagane.',
      passwordShort: 'Hasło musi mieć minimum 8 znaków.',
      passwordMismatch: 'Hasła nie są takie same.',
      networkError: 'Błąd sieci. Spróbuj ponownie.',
      sessionExpired: 'Sesja wygasła. Zaloguj się ponownie.',
      loginFailed: 'Logowanie nie powiodło się.',
      registerFailed: 'Rejestracja nie powiodła się.',
      welcomeBack: 'Witaj ponownie.',
      accountCreated: 'Konto utworzone.',
      loggedOut: 'Wylogowano.',
      loginFirst: 'Zaloguj się, żeby kupić kredyty.',
      redirecting: 'Przekierowanie...',
      checkoutError: 'Nie udało się otworzyć płatności.',
      noLeaderboard: 'Brak danych rankingu.',
      leaderboardError: 'Nie udało się załadować rankingu.',
      creditsUnit: 'kredytów',
      referralCopied: 'Link polecający skopiowany.',
      copyFailed: 'Nie udało się skopiować linku.',
      buyCredits: 'Kup kredyty',
      noPurchases: 'Brak zakupów.'
    }
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const t = (key) => messages[locale][key] || messages.en[key] || key;

  function on(selector, event, handler) {
    const el = typeof selector === 'string' ? $(selector) : selector;
    if (el) el.addEventListener(event, handler);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showToast(message, duration = 3000) {
    const toast = $('#toast');
    const label = $('#toast-message');
    if (!toast || !label) return;
    label.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.add('hidden'), duration);
  }

  function setLoading(button, isLoading) {
    if (!button) return;
    const text = button.querySelector('.btn-text');
    const loader = button.querySelector('.btn-loader');
    if (text) text.classList.toggle('hidden', isLoading);
    if (loader) loader.classList.toggle('hidden', !isLoading);
    button.disabled = isLoading;
  }

  function showError(id, message) {
    const el = $(`#${id}`);
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function hideError(id) {
    const el = $(`#${id}`);
    if (!el) return;
    el.textContent = '';
    el.classList.add('hidden');
  }

  async function api(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {})
    };

    try {
      const response = await fetch(`${API}${endpoint}`, { ...options, headers });
      const data = await response.json();
      if (response.status === 401) {
        logout(false);
        return { success: false, error: t('sessionExpired') };
      }
      return data;
    } catch {
      return { success: false, error: t('networkError') };
    }
  }

  function openModal(form) {
    const overlay = $('#auth-modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    $('#login-form')?.classList.toggle('hidden', form !== 'login');
    $('#register-form')?.classList.toggle('hidden', form !== 'register');
    hideError('modal-login-error');
    hideError('modal-register-error');
  }

  function closeModal() {
    $('#auth-modal-overlay')?.classList.add('hidden');
  }

  function setAuthUI() {
    const guest = $('#nav-guest');
    const user = $('#nav-user');
    if (!guest || !user) return;

    if (currentUser) {
      guest.classList.add('hidden');
      user.classList.remove('hidden');
      const name = currentUser.displayName || currentUser.email.split('@')[0];
      const credits = currentUser.role === 'admin' ? '∞' : (currentUser.credits || 0);
      if ($('#nav-avatar')) $('#nav-avatar').textContent = name[0].toUpperCase();
      if ($('#dropdown-name')) $('#dropdown-name').textContent = name;
      if ($('#dropdown-email')) $('#dropdown-email').textContent = currentUser.email;
      if ($('#nav-credits-count')) $('#nav-credits-count').textContent = credits;
    } else {
      guest.classList.remove('hidden');
      user.classList.add('hidden');
    }
    setDashboardPageState();
  }

  function setDashboardPageState() {
    if (!isDashboardPage) return;
    const loginCard = $('#dashboard-login-card');
    const dashboard = $('#dashboard');
    if (!loginCard || !dashboard) return;

    if (currentUser) {
      loginCard.classList.add('hidden');
      dashboard.classList.remove('hidden');
      updateDashboard();
      if (!dashboardHistoryLoaded) {
        dashboardHistoryLoaded = true;
        loadHistory();
      }
      if (!referralStatsLoaded) {
        referralStatsLoaded = true;
        loadReferralStats();
      }
      if (window.location.hash) {
        setTimeout(() => {
          const target = $(window.location.hash);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    } else {
      dashboardHistoryLoaded = false;
      referralStatsLoaded = false;
      currentReferralLink = '';
      loginCard.classList.remove('hidden');
      dashboard.classList.add('hidden');
    }
  }

  function updateDashboard() {
    if (!currentUser) return;
    const credits = currentUser.role === 'admin' ? '∞' : (currentUser.credits || 0);
    if ($('#dash-credits')) $('#dash-credits').textContent = credits;
    if ($('#dash-questions')) $('#dash-questions').textContent = currentUser.stats?.totalQuestionsSolved || 0;
    if ($('#dash-streak')) $('#dash-streak').textContent = currentUser.streak?.current || 0;
    if ($('#dash-referral-code')) $('#dash-referral-code').textContent = currentUser.referralCode || '---';
    currentReferralLink = currentUser.referralCode ? `${window.location.origin}?ref=${currentUser.referralCode}` : '';
    if ($('#dash-referral-link')) $('#dash-referral-link').textContent = currentReferralLink || '---';
  }

  async function loadReferralStats() {
    if (!authToken) return;
    const res = await api('/api/credits/referrals');
    if (!res.success) return;
    currentReferralLink = res.referralLink || currentReferralLink;
    if ($('#dash-referral-code')) $('#dash-referral-code').textContent = res.referralCode || currentUser?.referralCode || '---';
    if ($('#dash-referral-link')) $('#dash-referral-link').textContent = currentReferralLink || '---';
    if ($('#dash-referred-users')) $('#dash-referred-users').textContent = res.referredUsers || 0;
    if ($('#dash-referral-purchases')) $('#dash-referral-purchases').textContent = res.referralPurchases || 0;
    if ($('#dash-referral-credits')) $('#dash-referral-credits').textContent = res.referralCredits || 0;
  }

  async function loadHistory() {
    const list = $('#dash-history-list');
    if (!list || !authToken) return;
    const res = await api('/api/credits/history');
    if (res.success && res.purchases && res.purchases.length) {
      list.innerHTML = res.purchases.map((purchase) => (
        `<div class="dash-history-item"><span>${escapeHtml(purchase.pack)} (${purchase.credits} ${t('creditsUnit')})</span><span>${new Date(purchase.createdAt).toLocaleDateString(locale === 'pl' ? 'pl-PL' : 'en-US')}</span></div>`
      )).join('');
    } else {
      list.innerHTML = `<p class="dash-empty">${t('noPurchases')}</p>`;
    }
  }

  async function loadLeaderboard() {
    const container = $('#leaderboard-rows');
    if (!container) return;
    const res = await api('/api/leaderboard');
    if (res.success && res.leaderboard && res.leaderboard.length) {
      container.innerHTML = res.leaderboard.map((entry) => {
        const rankClass = entry.rank === 1 ? 'gold' : entry.rank === 2 ? 'silver' : entry.rank === 3 ? 'bronze' : '';
        return `<div class="leaderboard-row"><span class="leaderboard-rank ${rankClass}">${entry.rank}</span><span>${escapeHtml(entry.name)}</span><span>${entry.questionsSolved}</span><span>${entry.streak}</span></div>`;
      }).join('');
    } else {
      container.innerHTML = `<div class="leaderboard-loading">${t('noLeaderboard')}</div>`;
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
      currentUser = null;
      localStorage.removeItem('qs_token');
      setAuthUI();
    }
  }

  async function login() {
    const email = $('#modal-login-email')?.value.trim();
    const password = $('#modal-login-password')?.value;
    const remember = $('#modal-remember-me')?.checked;
    hideError('modal-login-error');
    if (!email || !password) return showError('modal-login-error', t('fillFields'));

    const button = $('#modal-login-btn');
    setLoading(button, true);
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, rememberMe: remember })
    });
    setLoading(button, false);

    if (res.success && res.token) {
      authToken = res.token;
      currentUser = res.user;
      localStorage.setItem('qs_token', res.token);
      dashboardHistoryLoaded = false;
      referralStatsLoaded = false;
      setAuthUI();
      updateDashboard();
      closeModal();
      showToast(t('welcomeBack'));
    } else {
      showError('modal-login-error', res.error || t('loginFailed'));
    }
  }

  async function register() {
    const displayName = $('#modal-register-name')?.value.trim();
    const email = $('#modal-register-email')?.value.trim();
    const password = $('#modal-register-password')?.value;
    const confirm = $('#modal-register-confirm')?.value;
    const referralCode = $('#modal-register-referral')?.value.trim();
    hideError('modal-register-error');

    if (!email || !password) return showError('modal-register-error', t('emailPasswordRequired'));
    if (password.length < 8) return showError('modal-register-error', t('passwordShort'));
    if (password !== confirm) return showError('modal-register-error', t('passwordMismatch'));

    const button = $('#modal-register-btn');
    setLoading(button, true);
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName, referralCode })
    });
    setLoading(button, false);

    if (res.success && res.token) {
      authToken = res.token;
      currentUser = res.user;
      localStorage.setItem('qs_token', res.token);
      dashboardHistoryLoaded = false;
      referralStatsLoaded = false;
      setAuthUI();
      updateDashboard();
      closeModal();
      showToast(t('accountCreated'));
    } else {
      showError('modal-register-error', res.error || t('registerFailed'));
    }
  }

  function logout(showMessage = true) {
    if (authToken) api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    authToken = null;
    currentUser = null;
    dashboardHistoryLoaded = false;
    referralStatsLoaded = false;
    currentReferralLink = '';
    localStorage.removeItem('qs_token');
    setAuthUI();
    if (showMessage) showToast(t('loggedOut'));
  }

  async function buyPack(button) {
    const pack = button.dataset.pack;
    if (!currentUser) {
      openModal('login');
      showToast(t('loginFirst'));
      return;
    }

    button.disabled = true;
    const original = button.textContent;
    button.textContent = t('redirecting');
    const res = await api('/api/credits/buy', {
      method: 'POST',
      body: JSON.stringify({ pack })
    });

    if (res.success && res.checkoutUrl) {
      window.location.href = res.checkoutUrl;
      return;
    }

    button.disabled = false;
    button.textContent = original || t('buyCredits');
    showToast(res.error || t('checkoutError'), 4000);
  }

  function goToDashboard(hash = '') {
    const targetUrl = `${dashboardPath}${hash}`;
    if (!isDashboardPage) {
      window.location.href = targetUrl;
      return;
    }

    setDashboardPageState();
    const target = hash ? $(hash) : $('#dashboard');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  on('#nav-login-btn', 'click', () => openModal('login'));
  on('#nav-register-btn', 'click', () => openModal('register'));
  on('#modal-close-btn', 'click', closeModal);
  on('#auth-modal-overlay', 'click', (event) => {
    if (event.target === event.currentTarget) closeModal();
  });
  on('#show-register-form', 'click', (event) => {
    event.preventDefault();
    openModal('register');
  });
  on('#show-login-form', 'click', (event) => {
    event.preventDefault();
    openModal('login');
  });
  on('#modal-login-btn', 'click', login);
  on('#modal-register-btn', 'click', register);
  on('#dashboard-login-btn', 'click', () => openModal('login'));
  on('#nav-avatar-wrap', 'click', (event) => {
    event.stopPropagation();
    $('#nav-dropdown')?.classList.toggle('show');
  });
  on(document, 'click', () => $('#nav-dropdown')?.classList.remove('show'));
  on('#dropdown-logout-btn', 'click', () => logout());
  on('#dropdown-dashboard-btn', 'click', () => goToDashboard());
  on('#dropdown-history-btn', 'click', () => goToDashboard('#purchase-history'));
  on('#dropdown-buy-btn', 'click', () => {
    const pricing = $('#pricing');
    if (pricing) pricing.scrollIntoView({ behavior: 'smooth' });
    else window.location.href = `${homePath}#pricing`;
  });
  on('#nav-hamburger', 'click', () => $('#nav-links')?.classList.toggle('show'));
  on('#copy-referral-btn', 'click', () => {
    if (!currentUser?.referralCode) return;
    const link = currentReferralLink || `${window.location.origin}?ref=${currentUser.referralCode}`;
    navigator.clipboard.writeText(link)
      .then(() => showToast(t('referralCopied')))
      .catch(() => showToast(t('copyFailed')));
  });

  $$('.buy-pack-btn').forEach((button) => {
    button.addEventListener('click', () => buyPack(button));
  });

  ['modal-login-email', 'modal-login-password'].forEach((id) => {
    on(`#${id}`, 'keydown', (event) => {
      if (event.key === 'Enter') login();
    });
  });

  ['modal-register-email', 'modal-register-password', 'modal-register-confirm'].forEach((id) => {
    on(`#${id}`, 'keydown', (event) => {
      if (event.key === 'Enter') register();
    });
  });

  $$('.nav-link').forEach((link) => {
    link.addEventListener('click', () => $('#nav-links')?.classList.remove('show'));
  });

  const refCode = new URLSearchParams(window.location.search).get('ref');
  if (refCode) {
    openModal('register');
    const refInput = $('#modal-register-referral');
    if (refInput) refInput.value = refCode;
  }

  checkAuth();
  loadLeaderboard();
})();
