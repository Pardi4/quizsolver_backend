import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, Input, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../api.service';
import { CHROME_WEB_STORE_URL, Locale, PageKey, contentFor, pathFor } from '../site-content';

@Component({
  selector: 'qs-shell',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="site-shell" [attr.data-locale]="locale">
      <nav class="navbar" aria-label="Main navigation">
        <div class="container nav-container">
          <a class="nav-brand" [href]="pathFor('home')" aria-label="QuizSolver home">
            <span class="nav-logo-icon" aria-hidden="true">QS</span>
            <span>QuizSolver</span>
          </a>

          <div class="nav-links">
            <a class="nav-link" [href]="homeHash('how-it-works')">{{ copy.nav.how }}</a>
            <a class="nav-link" [href]="homeHash('features')">{{ copy.nav.features }}</a>
            <a class="nav-link" [href]="homeHash('credits')">{{ copy.nav.pricing }}</a>
            <a class="nav-link" [href]="pathFor('quiz')" [class.active]="pageKey === 'quiz'">{{ locale === 'pl' ? 'Historia i quiz' : 'History quiz' }}</a>
          </div>

          <div class="nav-actions">
            <div class="nav-lang-switch" aria-label="Language">
              <a class="lang-option" [class.active]="locale === 'en'" [href]="alternatePath('en')">EN</a>
              <a class="lang-option" [class.active]="locale === 'pl'" [href]="alternatePath('pl')">PL</a>
            </div>

            <ng-container *ngIf="!api.currentUser(); else userMenu">
              <button class="btn-ghost btn-sm" type="button" (click)="openModal('login')">{{ copy.nav.login }}</button>
              <button class="btn-primary btn-sm" type="button" (click)="openModal('register')">{{ copy.nav.signup }}</button>
            </ng-container>

            <ng-template #userMenu>
              <button class="btn-outline btn-sm" type="button" (click)="goToDashboard('credits')">
                {{ api.currentUser()?.role === 'admin' ? '∞' : (api.currentUser()?.credits || 0) }} {{ copy.common.credits }}
              </button>
              <div class="user-menu">
                <button class="avatar-btn" type="button" (click)="dropdownOpen.set(!dropdownOpen())" aria-label="Account menu">
                  {{ userInitial(api.currentUser()) }}
                </button>
                <div class="dropdown" *ngIf="dropdownOpen()">
                  <div class="dropdown-user">
                    <strong>{{ api.currentUser()?.displayName || 'User' }}</strong>
                    <span>{{ api.currentUser()?.email }}</span>
                  </div>
                  <button class="btn-ghost btn-block" type="button" (click)="goToDashboard()">{{ copy.common.dashboard }}</button>
                  <button class="btn-ghost btn-block" type="button" (click)="goToDashboard('credits')">{{ copy.common.buyCredits }}</button>
                  <button class="btn-ghost btn-block" type="button" (click)="logout()">{{ copy.common.logout }}</button>
                </div>
              </div>
            </ng-template>
          </div>

          <button class="hamburger" type="button" (click)="mobileMenuOpen.set(!mobileMenuOpen())" [attr.aria-label]="copy.nav.toggle">
            <span></span><span></span><span></span>
          </button>
        </div>

        <div class="mobile-menu" *ngIf="mobileMenuOpen()">
          <div class="container mobile-menu-inner">
            <a class="nav-link" [href]="homeHash('how-it-works')">{{ copy.nav.how }}</a>
            <a class="nav-link" [href]="homeHash('features')">{{ copy.nav.features }}</a>
            <a class="nav-link" [href]="homeHash('credits')">{{ copy.nav.pricing }}</a>
            <a class="nav-link" [href]="pathFor('quiz')">{{ locale === 'pl' ? 'Historia i quiz' : 'History quiz' }}</a>
            <div class="mobile-actions" *ngIf="!api.currentUser()">
              <button class="btn-outline" type="button" (click)="openModal('login')">{{ copy.nav.login }}</button>
              <button class="btn-primary" type="button" (click)="openModal('register')">{{ copy.nav.signup }}</button>
            </div>
          </div>
        </div>
      </nav>

      <ng-content></ng-content>

      <section class="section compact" *ngIf="pageKey !== 'dashboard' && pageKey !== 'quiz' && pageKey !== 'success'">
        <div class="container referral-band">
          <div class="split-section">
            <div>
              <p class="eyebrow">{{ locale === 'pl' ? 'Gotowy do instalacji?' : 'Ready to install?' }}</p>
              <h2 class="section-title">{{ locale === 'pl' ? 'Dodaj QuizSolver do Chrome i zacznij od pierwszego quizu.' : 'Add QuizSolver to Chrome and start with your first quiz.' }}</h2>
              <p class="section-subtitle">{{ locale === 'pl' ? 'Rozszerzenie, historia pytań, notatki i quiz z historii działają na jednym koncie.' : 'The extension, question history, notes, and history quiz all work from one account.' }}</p>
            </div>
            <div class="section-actions">
              <a class="btn-primary btn-lg" [href]="storeUrl" target="_blank" rel="noopener">{{ locale === 'pl' ? 'Otwórz Chrome Web Store' : 'Open Chrome Web Store' }}</a>
              <button class="btn-outline btn-lg" type="button" (click)="openModal('register')">{{ copy.common.createAccount }}</button>
            </div>
          </div>
        </div>
      </section>

      <footer class="footer">
        <div class="container footer-grid">
          <div>
            <a class="nav-brand" [href]="pathFor('home')">
              <span class="nav-logo-icon" aria-hidden="true">QS</span>
              <span>QuizSolver</span>
            </a>
            <p class="footer-desc">{{ locale === 'pl' ? 'Rozszerzenie Chrome do sugestii odpowiedzi, wyjaśnień, notatek i powtórek z historii pytań.' : 'Chrome extension for answer suggestions, explanations, notes, and practice from question history.' }}</p>
          </div>
          <div>
            <h4 class="footer-title">{{ copy.footer.product }}</h4>
            <div class="footer-links">
              <a [href]="homeHash('features')">{{ copy.nav.features }}</a>
              <a [href]="pathFor('quiz')">{{ locale === 'pl' ? 'Historia i quiz' : 'History quiz' }}</a>
              <a [href]="pathFor('dashboard')">{{ copy.common.dashboard }}</a>
            </div>
          </div>
          <div>
            <h4 class="footer-title">{{ copy.footer.seoPages }}</h4>
            <div class="footer-links">
              <a [href]="pathFor('testportal')">Testportal</a>
              <a [href]="pathFor('moodle')">Moodle</a>
              <a [href]="pathFor('googleForms')">Google Forms</a>
              <a [href]="pathFor('quizSolverAi')">AI quiz solver</a>
            </div>
          </div>
          <div>
            <h4 class="footer-title">{{ copy.footer.legal }}</h4>
            <div class="footer-links">
              <a [href]="pathFor('privacy')">{{ copy.footer.privacy }}</a>
              <span>support&#64;getquizsolver.com</span>
            </div>
          </div>
        </div>
        <div class="container footer-bottom">{{ copy.footer.rights }}</div>
      </footer>

      <div class="modal-overlay" *ngIf="activeModal()" (click)="closeModal()">
        <section class="modal-content" (click)="$event.stopPropagation()">
          <button class="modal-close" type="button" (click)="activeModal.set(null)" [attr.aria-label]="copy.common.close">×</button>

          <ng-container *ngIf="activeModal() === 'login'">
            <header class="modal-header">
              <h2>{{ copy.auth.loginTitle }}</h2>
              <p>{{ copy.auth.loginSubtitle }}</p>
            </header>
            <form (ngSubmit)="login()">
              <div class="form-group">
                <input class="form-input" type="email" name="email" [(ngModel)]="loginEmail" [placeholder]="copy.common.email" autocomplete="email" required>
              </div>
              <div class="form-group">
                <input class="form-input" type="password" name="password" [(ngModel)]="loginPassword" [placeholder]="copy.common.password" autocomplete="current-password" required>
              </div>
              <label class="check-row">
                <input type="checkbox" name="remember" [(ngModel)]="rememberMe">
                <span>{{ copy.common.rememberMe }}</span>
              </label>
              <div class="form-error" *ngIf="authError()">{{ authError() }}</div>
              <button class="btn-primary btn-block" type="submit" [disabled]="authLoading()">{{ authLoading() ? copy.common.loading : copy.common.signIn }}</button>
              <div class="form-switch">
                {{ copy.auth.showRegister }}
                <button type="button" (click)="openModal('register')">{{ copy.auth.showRegisterLink }}</button>
              </div>
            </form>
          </ng-container>

          <ng-container *ngIf="activeModal() === 'register'">
            <header class="modal-header">
              <h2>{{ copy.auth.registerTitle }}</h2>
              <p>{{ locale === 'pl' ? 'Kod polecenia jest opcjonalny. Osoba polecająca dostaje 5% kupionych przez Ciebie kredytów jako bonus.' : 'Referral code is optional. The referrer receives 5% of the credits you buy as a bonus.' }}</p>
            </header>
            <form (ngSubmit)="register()">
              <div class="form-group">
                <input class="form-input" type="text" name="name" [(ngModel)]="registerName" [placeholder]="copy.common.displayName" autocomplete="name" required>
              </div>
              <div class="form-group">
                <input class="form-input" type="email" name="email" [(ngModel)]="registerEmail" [placeholder]="copy.common.email" autocomplete="email" required>
              </div>
              <div class="form-group">
                <input class="form-input" type="password" name="password" [(ngModel)]="registerPassword" [placeholder]="copy.common.password" autocomplete="new-password" required>
              </div>
              <div class="form-group">
                <input class="form-input" type="text" name="referralCode" [(ngModel)]="referralCode" [placeholder]="copy.common.referralCode">
              </div>
              <div class="form-error" *ngIf="authError()">{{ authError() }}</div>
              <button class="btn-primary btn-block" type="submit" [disabled]="authLoading()">{{ authLoading() ? copy.common.loading : copy.common.createAccount }}</button>
              <div class="form-switch">
                {{ copy.auth.showLogin }}
                <button type="button" (click)="openModal('login')">{{ copy.auth.showLoginLink }}</button>
              </div>
            </form>
          </ng-container>
        </section>
      </div>
    </div>
  `
})
export class ShellComponent implements OnInit {
  @Input() locale: Locale = 'en';
  @Input() pageKey: PageKey = 'home';

  protected readonly storeUrl = CHROME_WEB_STORE_URL;
  protected readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  protected mobileMenuOpen = signal(false);
  protected dropdownOpen = signal(false);
  protected activeModal = signal<'login' | 'register' | null>(null);
  protected authLoading = signal(false);
  protected authError = signal('');

  protected loginEmail = '';
  protected loginPassword = '';
  protected rememberMe = true;
  protected registerName = '';
  protected registerEmail = '';
  protected registerPassword = '';
  protected referralCode = '';

  get copy(): any {
    return contentFor(this.locale);
  }

  async ngOnInit(): Promise<void> {
    await this.api.restoreSession();

    if (!isPlatformBrowser(this.platformId)) return;

    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref && !this.referralCode) this.referralCode = ref.trim();

    if (this.pageKey === 'home' && window.location.pathname === '/' && navigator.language.startsWith('pl') && !sessionStorage.getItem('lang_redirected')) {
      sessionStorage.setItem('lang_redirected', 'true');
      await this.router.navigate(['/pl']);
    }
  }

  protected pathFor(key: PageKey): string {
    return pathFor(key, this.locale);
  }

  protected alternatePath(targetLocale: Locale): string {
    return pathFor(this.pageKey, targetLocale);
  }

  protected homeHash(hash: string): string {
    return `${pathFor('home', this.locale)}#${hash}`;
  }

  protected userInitial(user: any): string {
    return (user?.displayName || user?.email || '?').charAt(0).toUpperCase();
  }

  protected openModal(type: 'login' | 'register'): void {
    this.authError.set('');
    this.mobileMenuOpen.set(false);
    this.activeModal.set(type);
  }

  protected closeModal(): void {
    this.activeModal.set(null);
  }

  protected async goToDashboard(hash?: string): Promise<void> {
    this.dropdownOpen.set(false);
    const url = pathFor('dashboard', this.locale);
    await this.router.navigateByUrl(hash ? `${url}#${hash}` : url);
  }

  protected logout(): void {
    this.api.clearSession();
    this.dropdownOpen.set(false);
    this.router.navigateByUrl(pathFor('home', this.locale));
  }

  protected async login(): Promise<void> {
    this.authError.set('');
    this.authLoading.set(true);
    const result = await this.api.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: this.loginEmail, password: this.loginPassword, rememberMe: this.rememberMe })
    });
    this.authLoading.set(false);

    if (result.success && result.token) {
      this.api.setSession(result.token, result.user);
      this.closeModal();
      if (this.pageKey === 'home') await this.goToDashboard();
      return;
    }

    this.authError.set(result.error || (this.locale === 'pl' ? 'Logowanie nie powiodło się.' : 'Login failed.'));
  }

  protected async register(): Promise<void> {
    this.authError.set('');
    this.authLoading.set(true);
    const result = await this.api.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: this.registerEmail,
        password: this.registerPassword,
        displayName: this.registerName,
        referralCode: this.referralCode || undefined
      })
    });
    this.authLoading.set(false);

    if (result.success && result.token) {
      this.api.setSession(result.token, result.user);
      this.closeModal();
      await this.goToDashboard();
      return;
    }

    this.authError.set(result.error || (this.locale === 'pl' ? 'Rejestracja nie powiodła się.' : 'Registration failed.'));
  }
}
