import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, Inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type AdminTab = 'users' | 'purchases' | 'bugs' | 'cache' | 'leaderboard' | 'system';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <main class="admin-page">
      <section class="admin-login" *ngIf="!isAuthed(); else adminPanel">
        <div class="admin-login-card">
          <a class="admin-brand" href="/" aria-label="QuizSolver home">
            <span>QS</span>
            <strong>QuizSolver Admin</strong>
          </a>
          <h1>Admin console</h1>
          <p>Operational control for credits, users, cache and platform health.</p>
          <form (ngSubmit)="login()">
            <label>
              <span>Email</span>
              <input class="form-input" type="email" name="email" [(ngModel)]="email" autocomplete="email">
            </label>
            <label>
              <span>Password</span>
              <input class="form-input" type="password" name="password" [(ngModel)]="password" autocomplete="current-password">
            </label>
            <div class="form-error" *ngIf="error()">{{ error() }}</div>
            <button class="btn-primary btn-block" type="submit" [disabled]="loading()">{{ loading() ? 'Signing in...' : 'Sign in' }}</button>
          </form>
        </div>
      </section>

      <ng-template #adminPanel>
        <section class="admin-shell">
          <aside class="admin-sidebar">
            <a class="admin-brand" href="/">
              <span>QS</span>
              <strong>Admin</strong>
            </a>
            <nav class="admin-tabs" aria-label="Admin sections">
              <button type="button" *ngFor="let tab of tabs" [class.active]="activeTab() === tab.id" (click)="activeTab.set(tab.id)">
                <span>{{ tab.short }}</span>{{ tab.label }}
              </button>
            </nav>
            <div class="admin-sidebar-foot">
              <button class="btn-outline btn-block" type="button" (click)="refresh()">Refresh</button>
              <button class="btn-ghost btn-block" type="button" (click)="logout()">Logout</button>
            </div>
          </aside>

          <section class="admin-main">
            <header class="admin-header">
              <div>
                <p class="eyebrow">Live operations</p>
                <h1>QuizSolver control room</h1>
                <p>Keep user access, credits, cache and system health visible in one place.</p>
              </div>
              <div class="admin-header-actions">
                <a class="btn-outline" href="/dashboard">Dashboard</a>
                <a class="btn-primary" href="/">Public site</a>
              </div>
            </header>

            <div class="admin-alert" *ngIf="error()">{{ error() }}</div>

            <section class="admin-stats">
              <article *ngFor="let card of statsCards()">
                <span>{{ card.label }}</span>
                <strong [class.revenue]="card.revenue">{{ card.value }}</strong>
              </article>
            </section>

            <section class="admin-panel" *ngIf="activeTab() === 'users'">
              <div class="panel-head">
                <div>
                  <p class="eyebrow">Users</p>
                  <h2>Accounts and credits</h2>
                </div>
                <form class="admin-search" (ngSubmit)="loadUsers(1)">
                  <input class="form-input" type="search" name="search" [(ngModel)]="userSearch" placeholder="Search email or name">
                  <button class="btn-primary" type="submit">Search</button>
                </form>
              </div>

              <div class="table-scroll">
                <table class="admin-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Role</th>
                      <th>Credits</th>
                      <th>Questions</th>
                      <th>Streak</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let user of users()">
                      <td>
                        <strong>{{ user.email }}</strong>
                        <span>{{ user.displayName || 'No display name' }}</span>
                      </td>
                      <td>{{ user.role }}</td>
                      <td>{{ user.role === 'admin' ? 'unlimited' : user.credits }}</td>
                      <td>{{ user.stats?.totalQuestionsSolved || 0 }}</td>
                      <td>{{ user.streak?.current || 0 }}</td>
                      <td><span class="status-pill" [class.danger]="user.isBanned">{{ user.isBanned ? 'Banned' : 'Active' }}</span></td>
                      <td>
                        <div class="row-actions">
                          <button type="button" (click)="quickGrant(user.id, 50)">+50</button>
                          <button type="button" (click)="quickGrant(user.id, 100)">+100</button>
                          <button type="button" (click)="quickGrant(user.id, 200)">+200</button>
                          <button type="button" (click)="user.isBanned ? unbanUser(user.id) : banUser(user.id)">{{ user.isBanned ? 'Unban' : 'Ban' }}</button>
                          <button type="button" (click)="toggleLeaderboard(user.id, !user.excludeFromLeaderboard)">{{ user.excludeFromLeaderboard ? 'Show LB' : 'Hide LB' }}</button>
                          <button type="button" class="danger" *ngIf="user.role !== 'admin'" (click)="deleteUser(user.id, user.email)">Delete</button>
                        </div>
                      </td>
                    </tr>
                    <tr *ngIf="!users().length">
                      <td colspan="7" class="empty-cell">No users found.</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="pagination" *ngIf="pagination().pages > 1">
                <button type="button" *ngFor="let page of pageNumbers()" [class.active]="page === pagination().page" (click)="loadUsers(page)">
                  {{ page }}
                </button>
              </div>
            </section>

            <section class="admin-panel" *ngIf="activeTab() === 'purchases'">
              <div class="panel-head">
                <div>
                  <p class="eyebrow">Revenue</p>
                  <h2>Purchases and grants</h2>
                </div>
              </div>
              <div class="table-scroll">
                <table class="admin-table">
                  <thead><tr><th>User</th><th>Pack</th><th>Credits</th><th>Price</th><th>Provider</th><th>Reason</th><th>Date</th></tr></thead>
                  <tbody>
                    <tr *ngFor="let purchase of purchases()">
                      <td>{{ purchase.user || 'Unknown' }}</td>
                      <td>{{ purchase.pack }}</td>
                      <td>{{ purchase.credits }}</td>
                      <td>{{ purchase.priceUsd ? formatMoney(purchase.priceUsd) : '-' }}</td>
                      <td>{{ purchase.provider }}</td>
                      <td>{{ purchase.reason || '-' }}</td>
                      <td>{{ formatDate(purchase.date) }}</td>
                    </tr>
                    <tr *ngIf="!purchases().length"><td colspan="7" class="empty-cell">No purchases yet.</td></tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section class="admin-panel" *ngIf="activeTab() === 'bugs'">
              <div class="panel-head">
                <div>
                  <p class="eyebrow">Reports</p>
                  <h2>Bug reports</h2>
                </div>
              </div>
              <div class="bug-list">
                <article *ngFor="let bug of bugs()">
                  <div>
                    <strong>{{ bug.user || 'Unknown user' }}</strong>
                    <span>{{ formatDate(bug.date) }}</span>
                  </div>
                  <a [href]="bug.url" target="_blank" rel="noopener">{{ bug.url }}</a>
                  <p *ngIf="bug.description">{{ bug.description }}</p>
                </article>
                <p class="empty-panel" *ngIf="!bugs().length">No bug reports.</p>
              </div>
            </section>

            <section class="admin-panel" *ngIf="activeTab() === 'cache'">
              <div class="panel-head">
                <div>
                  <p class="eyebrow">AI cache</p>
                  <h2>Cached answers</h2>
                </div>
                <button class="btn-outline danger-outline" type="button" (click)="clearCache()">Clear cache</button>
              </div>
              <div class="cache-summary">
                <strong>{{ cache().totalCached || 0 }}</strong>
                <span>Total cached answers</span>
              </div>
              <div class="cache-list">
                <article *ngFor="let hit of cache().topHits || []">
                  <p>{{ hit.questionText }}</p>
                  <span>{{ hit.questionType }} | {{ hit.hitCount }} hits</span>
                </article>
                <p class="empty-panel" *ngIf="!(cache().topHits || []).length">No cache hits yet.</p>
              </div>
            </section>

            <section class="admin-panel" *ngIf="activeTab() === 'leaderboard'">
              <div class="panel-head">
                <div>
                  <p class="eyebrow">Community</p>
                  <h2>Leaderboard</h2>
                </div>
              </div>
              <div class="leaderboard-admin">
                <article *ngFor="let entry of leaderboard()">
                  <strong>#{{ entry.rank }}</strong>
                  <span>{{ entry.name }}</span>
                  <span>{{ entry.questionsSolved }} questions</span>
                  <span>{{ entry.streak }} streak</span>
                </article>
                <p class="empty-panel" *ngIf="!leaderboard().length">No leaderboard data.</p>
              </div>
            </section>

            <section class="admin-panel" *ngIf="activeTab() === 'system'">
              <div class="panel-head">
                <div>
                  <p class="eyebrow">System</p>
                  <h2>Health check</h2>
                </div>
              </div>
              <div class="health-grid">
                <article *ngFor="let item of healthCards()">
                  <span>{{ item.label }}</span>
                  <strong [class.ok]="item.ok">{{ item.value }}</strong>
                </article>
              </div>
            </section>
          </section>
        </section>
      </ng-template>
    </main>
  `
})
export class AdminComponent implements OnInit {
  protected readonly tabs: Array<{ id: AdminTab; label: string; short: string }> = [
    { id: 'users', label: 'Users', short: 'US' },
    { id: 'purchases', label: 'Purchases', short: 'PY' },
    { id: 'bugs', label: 'Bugs', short: 'BG' },
    { id: 'cache', label: 'Cache', short: 'CA' },
    { id: 'leaderboard', label: 'Leaderboard', short: 'LB' },
    { id: 'system', label: 'System', short: 'SY' }
  ];

  protected readonly activeTab = signal<AdminTab>('users');
  protected readonly isAuthed = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly stats = signal<any>({});
  protected readonly users = signal<any[]>([]);
  protected readonly purchases = signal<any[]>([]);
  protected readonly bugs = signal<any[]>([]);
  protected readonly cache = signal<any>({});
  protected readonly leaderboard = signal<any[]>([]);
  protected readonly health = signal<any>({});
  protected readonly pagination = signal<any>({ page: 1, pages: 1, total: 0 });

  protected email = '';
  protected password = '';
  protected userSearch = '';

  private token = '';
  private readonly isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  async ngOnInit(): Promise<void> {
    if (!this.isBrowser) return;
    this.token = localStorage.getItem('qs_admin_token') || '';
    if (!this.token) return;

    const me = await this.api('/api/auth/me');
    if (me.success && me.user?.role === 'admin') {
      this.isAuthed.set(true);
      await this.refresh();
      return;
    }

    this.logout();
  }

  protected async login(): Promise<void> {
    this.error.set('');
    if (!this.email || !this.password) {
      this.error.set('Email and password are required.');
      return;
    }

    this.loading.set(true);
    const result = await this.api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: this.email, password: this.password, rememberMe: true })
    }, false);
    this.loading.set(false);

    if (!result.success || !result.token) {
      this.error.set(result.error || 'Login failed.');
      return;
    }

    if (result.user?.role !== 'admin') {
      this.error.set('Admin access required.');
      return;
    }

    this.token = result.token;
    localStorage.setItem('qs_admin_token', this.token);
    this.isAuthed.set(true);
    await this.refresh();
  }

  protected logout(): void {
    if (this.token) void this.api('/api/auth/logout', { method: 'POST' });
    this.token = '';
    this.isAuthed.set(false);
    if (this.isBrowser) localStorage.removeItem('qs_admin_token');
  }

  protected async refresh(): Promise<void> {
    this.error.set('');
    await Promise.all([
      this.loadStats(),
      this.loadUsers(this.pagination().page || 1),
      this.loadPurchases(),
      this.loadBugs(),
      this.loadCache(),
      this.loadLeaderboard(),
      this.loadHealth()
    ]);
  }

  protected async loadUsers(page = 1): Promise<void> {
    const params = new URLSearchParams({ page: String(page), limit: '25' });
    if (this.userSearch.trim()) params.set('search', this.userSearch.trim());
    const result = await this.api(`/api/admin/users?${params.toString()}`);
    if (result.success) {
      this.users.set(result.users || []);
      this.pagination.set(result.pagination || { page, pages: 1, total: 0 });
    }
  }

  protected async quickGrant(userId: string, amount: number): Promise<void> {
    const result = await this.api(`/api/admin/users/${userId}/quick-grant`, {
      method: 'POST',
      body: JSON.stringify({ amount })
    });
    if (result.success) {
      await Promise.all([this.loadUsers(this.pagination().page), this.loadStats()]);
      return;
    }
    this.error.set(result.error || 'Could not grant credits.');
  }

  protected async banUser(userId: string): Promise<void> {
    if (!this.confirm('Ban this user?')) return;
    const result = await this.api(`/api/admin/users/${userId}/ban`, { method: 'POST' });
    if (result.success) {
      await this.loadUsers(this.pagination().page);
      return;
    }
    this.error.set(result.error || 'Could not ban user.');
  }

  protected async unbanUser(userId: string): Promise<void> {
    const result = await this.api(`/api/admin/users/${userId}/unban`, { method: 'POST' });
    if (result.success) {
      await this.loadUsers(this.pagination().page);
      return;
    }
    this.error.set(result.error || 'Could not unban user.');
  }

  protected async toggleLeaderboard(userId: string, exclude: boolean): Promise<void> {
    const result = await this.api(`/api/admin/users/${userId}/leaderboard`, {
      method: 'PATCH',
      body: JSON.stringify({ exclude })
    });
    if (result.success) {
      await Promise.all([this.loadUsers(this.pagination().page), this.loadLeaderboard()]);
      return;
    }
    this.error.set(result.error || 'Could not update leaderboard setting.');
  }

  protected async deleteUser(userId: string, email: string): Promise<void> {
    if (!this.confirm(`Delete ${email}? This cannot be undone.`)) return;
    const result = await this.api(`/api/admin/users/${userId}`, { method: 'DELETE' });
    if (result.success) {
      await Promise.all([this.loadUsers(this.pagination().page), this.loadStats()]);
      return;
    }
    this.error.set(result.error || 'Could not delete user.');
  }

  protected async clearCache(): Promise<void> {
    if (!this.confirm('Clear all cached answers?')) return;
    const result = await this.api('/api/admin/cache/clear', { method: 'DELETE' });
    if (result.success) {
      await Promise.all([this.loadCache(), this.loadStats()]);
      return;
    }
    this.error.set(result.error || 'Could not clear cache.');
  }

  protected statsCards(): Array<{ label: string; value: string; revenue?: boolean }> {
    const s = this.stats();
    return [
      { label: 'Users', value: this.formatNumber(s.totalUsers) },
      { label: 'Questions', value: this.formatNumber(s.totalQuestions) },
      { label: 'Cached answers', value: this.formatNumber(s.cachedAnswers) },
      { label: 'Revenue', value: this.formatMoney(s.totalRevenue || 0), revenue: true },
      { label: 'Month revenue', value: this.formatMoney(s.monthRevenue || 0), revenue: true },
      { label: 'Purchases today', value: this.formatNumber(s.todayPurchases) },
      { label: 'Bug reports', value: this.formatNumber(s.totalBugReports) },
      { label: 'Banned', value: this.formatNumber(s.bannedUsers) }
    ];
  }

  protected healthCards(): Array<{ label: string; value: string; ok?: boolean }> {
    const h = this.health();
    const uptime = Number(h.uptime || 0);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    return [
      { label: 'Database', value: h.database || 'unknown', ok: h.database === 'connected' },
      { label: 'Uptime', value: `${hours}h ${minutes}m` },
      { label: 'Memory RSS', value: h.memory?.rss || '-' },
      { label: 'Heap used', value: h.memory?.heapUsed || '-' },
      { label: 'Node', value: h.nodeVersion || '-' },
      { label: 'Environment', value: h.env || '-' }
    ];
  }

  protected pageNumbers(): number[] {
    const pages = Number(this.pagination().pages || 1);
    return Array.from({ length: pages }, (_, index) => index + 1);
  }

  protected formatNumber(value: unknown): string {
    const number = Number(value || 0);
    return new Intl.NumberFormat('en-US').format(number);
  }

  protected formatMoney(value: unknown): string {
    const number = Number(value || 0);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(number);
  }

  protected formatDate(value: unknown): string {
    if (!value) return '-';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  private async loadStats(): Promise<void> {
    const result = await this.api('/api/admin/stats');
    if (result.success) this.stats.set(result.stats || {});
  }

  private async loadPurchases(): Promise<void> {
    const result = await this.api('/api/admin/purchases');
    if (result.success) this.purchases.set(result.purchases || []);
  }

  private async loadBugs(): Promise<void> {
    const result = await this.api('/api/admin/bug-reports');
    if (result.success) this.bugs.set(result.reports || []);
  }

  private async loadCache(): Promise<void> {
    const result = await this.api('/api/admin/cache/stats');
    if (result.success) this.cache.set(result);
  }

  private async loadLeaderboard(): Promise<void> {
    const result = await this.api('/api/admin/leaderboard');
    if (result.success) this.leaderboard.set(result.leaderboard || []);
  }

  private async loadHealth(): Promise<void> {
    const result = await this.api('/api/admin/system/health');
    if (result.success) this.health.set(result.health || {});
  }

  private confirm(message: string): boolean {
    if (!this.isBrowser) return false;
    return window.confirm(message);
  }

  private async api(endpoint: string, options: RequestInit = {}, withToken = true): Promise<any> {
    if (!this.isBrowser) return { success: false, error: 'Browser unavailable.' };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {})
    };
    if (withToken && this.token) headers.Authorization = `Bearer ${this.token}`;

    try {
      const response = await fetch(endpoint, { ...options, headers });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        this.token = '';
        this.isAuthed.set(false);
        localStorage.removeItem('qs_admin_token');
        return { success: false, error: data.error || 'Session expired.' };
      }
      if (!response.ok) return { success: false, error: data.error || `HTTP ${response.status}` };
      return data;
    } catch {
      return { success: false, error: 'Network error.' };
    }
  }
}
