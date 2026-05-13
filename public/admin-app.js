(() => {
  const API = window.location.origin;
  let token = null;
  let currentPage = 1;

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function api(ep, opts = {}) {
    const h = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers };
    return fetch(`${API}${ep}`, { ...opts, headers: h }).then(r => r.json()).catch(() => ({ success: false, error: 'Network error.' }));
  }

  function showPanel() {
    $('#admin-login').classList.add('hidden');
    $('#admin-panel').classList.remove('hidden');
    loadAll();
  }

  async function doLogin() {
    const email = $('#admin-email').value.trim();
    const pw = $('#admin-password').value;
    const err = $('#admin-login-error');
    err.classList.add('hidden');
    if (!email || !pw) { err.textContent = 'Fill both fields.'; err.classList.remove('hidden'); return; }
    const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: pw, rememberMe: true }) });
    if (res.success && res.token) {
      if (res.user.role !== 'admin') { err.textContent = 'Admin access required.'; err.classList.remove('hidden'); return; }
      token = res.token;
      localStorage.setItem('qs_admin_token', token);
      showPanel();
    } else {
      err.textContent = res.error || 'Login failed.';
      err.classList.remove('hidden');
    }
  }

  $('#admin-login-btn').addEventListener('click', doLogin);
  $('#admin-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  const saved = localStorage.getItem('qs_admin_token');
  if (saved) {
    token = saved;
    api('/api/auth/me').then(r => {
      if (r.success && r.user?.role === 'admin') showPanel();
      else { token = null; localStorage.removeItem('qs_admin_token'); }
    });
  }

  $('#admin-logout-btn').addEventListener('click', () => {
    if (token) api('/api/auth/logout', { method: 'POST' });
    token = null;
    localStorage.removeItem('qs_admin_token');
    location.reload();
  });

  $('#refresh-btn').addEventListener('click', loadAll);

  $$('.tab').forEach(t => {
    t.addEventListener('click', () => {
      $$('.tab').forEach(x => x.classList.remove('active'));
      $$('.tab-panel').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      $(`#tab-${t.dataset.tab}`).classList.add('active');
    });
  });

  async function loadAll() {
    loadStats();
    loadUsers();
    loadPurchases();
    loadBugs();
    loadCache();
    loadLeaderboard();
    loadHealth();
  }

  async function loadStats() {
    const r = await api('/api/admin/stats');
    if (!r.success) return;
    const s = r.stats;
    $('#stats-grid').innerHTML = [
      { l: 'Total Users', v: s.totalUsers, c: '' },
      { l: 'Questions Solved', v: s.totalQuestions.toLocaleString(), c: '' },
      { l: 'Cached Answers', v: s.cachedAnswers, c: '' },
      { l: 'Total Revenue', v: `$${s.totalRevenue.toFixed(2)}`, c: 'revenue' },
      { l: 'Month Revenue', v: `$${s.monthRevenue.toFixed(2)}`, c: 'revenue' },
      { l: 'Purchases Today', v: s.todayPurchases, c: '' },
      { l: 'Bug Reports', v: s.totalBugReports, c: '' },
      { l: 'Banned Users', v: s.bannedUsers, c: '' },
      { l: 'Credits Pool', v: s.totalCreditsInSystem, c: '' },
    ].map(x => `<div class="stat-card glass-card ${x.c}"><div class="stat-val">${x.v}</div><div class="stat-lbl">${x.l}</div></div>`).join('');
  }

  async function loadUsers(page = 1, search = '') {
    currentPage = page;
    const q = search ? `&search=${encodeURIComponent(search)}` : '';
    const r = await api(`/api/admin/users?page=${page}&limit=25${q}`);
    if (!r.success) return;

    const tbody = $('#users-tbody');
    if (r.users.length === 0) { tbody.innerHTML = '<tr><td colspan="8" class="empty-msg">No users found.</td></tr>'; return; }

    tbody.innerHTML = r.users.map(u => {
      const status = u.isBanned ? '<span class="banned">BANNED</span>' : '<span style="color:var(--success)">Active</span>';
      return `<tr>
        <td class="email">${esc(u.email)}</td>
        <td>${esc(u.displayName || '-')}</td>
        <td>${u.role}</td>
        <td>${u.role === 'admin' ? '∞' : u.credits}</td>
        <td>${u.stats?.totalQuestionsSolved || 0}</td>
        <td>${u.streak?.current || 0} 🔥</td>
        <td>${status}</td>
        <td>
          <div class="quick-btns">
            <button class="quick-btn grant" data-action="grant" data-uid="${u.id}" data-amount="50">+50</button>
            <button class="quick-btn grant" data-action="grant" data-uid="${u.id}" data-amount="100">+100</button>
            <button class="quick-btn grant" data-action="grant" data-uid="${u.id}" data-amount="200">+200</button>
            <button class="quick-btn grant" data-action="grant" data-uid="${u.id}" data-amount="500">+500</button>
            ${u.isBanned
              ? `<button class="quick-btn unban" data-action="unban" data-uid="${u.id}">Unban</button>`
              : `<button class="quick-btn ban" data-action="ban" data-uid="${u.id}">Ban</button>`}
            <button class="quick-btn lb" data-action="togglelb" data-uid="${u.id}" data-exclude="${!u.excludeFromLeaderboard}">${u.excludeFromLeaderboard ? 'Show LB' : 'Hide LB'}</button>
            ${u.role !== 'admin' ? `<button class="quick-btn del" data-action="delete" data-uid="${u.id}" data-email="${esc(u.email)}">Del</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');

    const p = r.pagination;
    const pagDiv = $('#users-pagination');
    if (p.pages > 1) {
      let html = '';
      for (let i = 1; i <= p.pages; i++) {
        html += `<button class="page-btn ${i === p.page ? 'active' : ''}" data-action="page" data-page="${i}">${i}</button>`;
      }
      pagDiv.innerHTML = html;
    } else {
      pagDiv.innerHTML = '';
    }
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const uid = btn.dataset.uid;

    if (action === 'grant') {
      const amount = parseInt(btn.dataset.amount);
      btn.disabled = true;
      const r = await api(`/api/admin/users/${uid}/quick-grant`, {
        method: 'POST', body: JSON.stringify({ amount })
      });
      btn.disabled = false;
      if (r.success) { loadUsers(currentPage, $('#user-search').value.trim()); loadStats(); }
      else alert(r.error || 'Error');
    }

    if (action === 'ban') {
      if (!confirm('Ban this user?')) return;
      const r = await api(`/api/admin/users/${uid}/ban`, { method: 'POST' });
      if (r.success) loadUsers(currentPage, $('#user-search').value.trim());
      else alert(r.error || 'Error');
    }

    if (action === 'unban') {
      const r = await api(`/api/admin/users/${uid}/unban`, { method: 'POST' });
      if (r.success) loadUsers(currentPage, $('#user-search').value.trim());
      else alert(r.error || 'Error');
    }

    if (action === 'togglelb') {
      const exclude = btn.dataset.exclude === 'true';
      const r = await api(`/api/admin/users/${uid}/leaderboard`, {
        method: 'PATCH', body: JSON.stringify({ exclude })
      });
      if (r.success) loadUsers(currentPage, $('#user-search').value.trim());
      else alert(r.error || 'Error');
    }

    if (action === 'delete') {
      const email = btn.dataset.email;
      if (!confirm(`Delete ${email}? This cannot be undone!`)) return;
      const r = await api(`/api/admin/users/${uid}`, { method: 'DELETE' });
      if (r.success) { loadUsers(currentPage, $('#user-search').value.trim()); loadStats(); }
      else alert(r.error || 'Error');
    }

    if (action === 'page') {
      loadUsers(parseInt(btn.dataset.page), $('#user-search').value.trim());
    }
  });

  $('#search-btn').addEventListener('click', () => loadUsers(1, $('#user-search').value.trim()));
  $('#user-search').addEventListener('keydown', e => { if (e.key === 'Enter') loadUsers(1, e.target.value.trim()); });

  async function loadPurchases() {
    const r = await api('/api/admin/purchases');
    if (!r.success) return;
    const tbody = $('#purchases-tbody');
    if (!r.purchases || r.purchases.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">No purchases yet.</td></tr>';
      return;
    }
    tbody.innerHTML = r.purchases.map(p => `<tr>
      <td>${esc(p.user || 'Unknown')}</td>
      <td>${esc(p.pack)}</td>
      <td>${p.credits}</td>
      <td>${p.priceUsd ? '$' + p.priceUsd.toFixed(2) : '-'}</td>
      <td>${esc(p.provider)}</td>
      <td>${esc(p.reason || '-')}</td>
      <td>${new Date(p.date).toLocaleString()}</td>
    </tr>`).join('');
  }

  async function loadBugs() {
    const r = await api('/api/admin/bug-reports');
    const el = $('#bugs-list');
    if (!r.success || !r.reports || r.reports.length === 0) {
      el.innerHTML = '<div class="empty-msg">No bug reports.</div>';
      return;
    }
    el.innerHTML = r.reports.map(b => `<div class="bug-item">
      <div class="bug-meta">${esc(b.user || 'Unknown')} — ${new Date(b.date).toLocaleString()}</div>
      <div class="bug-url">${esc(b.url)}</div>
      ${b.description ? `<div class="bug-desc">${esc(b.description)}</div>` : ''}
    </div>`).join('');
  }

  async function loadCache() {
    const r = await api('/api/admin/cache/stats');
    if (!r.success) return;
    $('#cache-total').textContent = r.totalCached;
    const el = $('#cache-hits');
    if (!r.topHits || r.topHits.length === 0) {
      el.innerHTML = '<div class="empty-msg">No cached answers.</div>';
      return;
    }
    el.innerHTML = r.topHits.map(h => `<div class="cache-hit-item">
      <span>${esc(h.questionText?.substring(0, 80) || '?')}... (${h.questionType})</span>
      <span class="hit-count">${h.hitCount} hits</span>
    </div>`).join('');
  }

  $('#clear-cache-btn').addEventListener('click', async () => {
    if (!confirm('Clear ALL cached answers?')) return;
    const r = await api('/api/admin/cache/clear', { method: 'DELETE' });
    if (r.success) { loadCache(); loadStats(); alert(`Deleted ${r.deleted} entries.`); }
    else alert(r.error || 'Error');
  });

  async function loadLeaderboard() {
    const r = await api('/api/admin/leaderboard');
    const el = $('#admin-leaderboard');
    if (!r.success || !r.leaderboard || r.leaderboard.length === 0) {
      el.innerHTML = '<div class="empty-msg">No leaderboard data.</div>';
      return;
    }
    el.innerHTML = '<div style="display:grid;grid-template-columns:50px 1fr 120px 100px;padding:12px 16px;font-weight:700;font-size:.75rem;color:var(--text-muted);text-transform:uppercase"><span>#</span><span>User</span><span>Questions</span><span>Streak</span></div>' +
      r.leaderboard.map(e => {
        const cls = e.rank === 1 ? 'gold' : e.rank === 2 ? 'silver' : e.rank === 3 ? 'bronze' : '';
        return `<div style="display:grid;grid-template-columns:50px 1fr 120px 100px;padding:10px 16px;border-bottom:1px solid var(--border);font-size:.85rem"><span class="leaderboard-rank ${cls}">${e.rank}</span><span>${esc(e.name)}</span><span>${e.questionsSolved}</span><span>${e.streak} 🔥</span></div>`;
      }).join('');
  }

  async function loadHealth() {
    const r = await api('/api/admin/system/health');
    if (!r.success) return;
    const h = r.health;
    const upHrs = Math.floor(h.uptime / 3600);
    const upMins = Math.floor((h.uptime % 3600) / 60);
    $('#health-grid').innerHTML = [
      { l: 'Database', v: h.database, c: h.database === 'connected' ? 'health-ok' : 'health-warn' },
      { l: 'Uptime', v: `${upHrs}h ${upMins}m`, c: '' },
      { l: 'Memory (RSS)', v: h.memory.rss, c: '' },
      { l: 'Heap Used', v: h.memory.heapUsed, c: '' },
      { l: 'Node.js', v: h.nodeVersion, c: '' },
      { l: 'Environment', v: h.env, c: '' },
    ].map(x => `<div class="health-item glass-card"><div class="h-label">${x.l}</div><div class="h-value ${x.c}">${x.v}</div></div>`).join('');
  }
})();
