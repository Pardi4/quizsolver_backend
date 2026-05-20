import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../api.service';
import { SeoService } from '../seo.service';
import { Locale, pageData } from '../site-content';
import { ShellComponent } from './shell.component';

@Component({
  standalone: true,
  imports: [CommonModule, ShellComponent],
  template: `
    <qs-shell [locale]="locale" pageKey="dashboard">
      <main class="container" style="min-height: 80vh;">
        <section *ngIf="!api.currentUser(); else dashboardContent" class="section">
          <div class="login-panel" style="max-width: 620px; margin: 0 auto; text-align: center;">
            <p class="eyebrow">{{ copy.dashboard }}</p>
            <h1 class="section-title">{{ data.loginTitle }}</h1>
            <p class="section-subtitle">{{ data.loginText }}</p>
            <button class="btn-primary btn-lg" type="button" onclick="document.querySelector('.nav-actions .btn-ghost')?.click()">{{ data.loginButton }}</button>
          </div>
        </section>

        <ng-template #dashboardContent>
          <header class="dashboard-header">
            <p class="eyebrow">{{ copy.dashboard }}</p>
            <h1>{{ locale === 'pl' ? 'Cześć,' : 'Hi,' }} {{ api.currentUser()?.displayName || 'User' }}</h1>
            <p>{{ locale === 'pl' ? 'Kredyty, historia zakupów i kod polecający w jednym miejscu.' : 'Credits, purchase history, and your referral code in one place.' }}</p>
          </header>

          <section class="stats-grid">
            <article class="stat-card">
              <div class="stat-value">{{ api.currentUser()?.role === 'admin' ? '∞' : (api.currentUser()?.credits || 0) }}</div>
              <div class="stat-label">{{ copy.credits }}</div>
            </article>
            <article class="stat-card">
              <div class="stat-value">{{ api.currentUser()?.stats?.totalQuestionsSolved || 0 }}</div>
              <div class="stat-label">{{ locale === 'pl' ? 'Rozwiązane pytania' : 'Questions solved' }}</div>
            </article>
            <article class="stat-card">
              <div class="stat-value">{{ referral().referralCredits || 0 }}</div>
              <div class="stat-label">{{ locale === 'pl' ? 'Bonus z poleceń' : 'Referral bonus' }}</div>
            </article>
          </section>

          <section class="section compact" style="padding-top: 24px;">
            <div class="referral-widget">
              <div class="referral-layout">
                <div>
                  <p class="eyebrow">{{ locale === 'pl' ? 'Reference code' : 'Referral code' }}</p>
                  <h2 class="section-title">{{ locale === 'pl' ? 'Polecaj i odbieraj 5% kupionych kredytów' : 'Refer users and earn 5% of bought credits' }}</h2>
                  <p class="section-subtitle">{{ locale === 'pl' ? 'Gdy ktoś zarejestruje się z Twojego linku i kupi kredyty, dostajesz bonus równy 5% tej liczby kredytów. Kupujący nic nie traci.' : 'When someone signs up from your link and buys credits, you receive a bonus equal to 5% of those credits. The buyer keeps the full purchase.' }}</p>
                  <div class="referral-link-box">
                    <code>{{ referral().referralLink || 'Loading...' }}</code>
                    <button class="btn-outline btn-sm" type="button" (click)="copyReferral()">{{ copied ? (locale === 'pl' ? 'Skopiowano' : 'Copied') : (locale === 'pl' ? 'Kopiuj' : 'Copy') }}</button>
                  </div>
                </div>
                <div class="mini-stats">
                  <div>
                    <strong>{{ referral().referredUsers || 0 }}</strong>
                    <span>{{ locale === 'pl' ? 'Rejestracje' : 'Signups' }}</span>
                  </div>
                  <div>
                    <strong>{{ referral().referralPurchases || 0 }}</strong>
                    <span>{{ locale === 'pl' ? 'Zakupy' : 'Purchases' }}</span>
                  </div>
                  <div>
                    <strong>{{ referral().referralCredits || 0 }}</strong>
                    <span>{{ locale === 'pl' ? 'Kredyty bonusowe' : 'Bonus credits' }}</span>
                  </div>
                  <div>
                    <strong>5%</strong>
                    <span>{{ locale === 'pl' ? 'Od zakupu' : 'Of purchase' }}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="section compact" id="credits">
            <div class="section-header">
              <p class="eyebrow">{{ copy.credits }}</p>
              <h2 class="section-title">{{ locale === 'pl' ? 'Doładuj konto' : 'Top up your account' }}</h2>
              <p class="section-subtitle">{{ locale === 'pl' ? 'Wybierz jednorazowy pakiet kredytów.' : 'Choose a one-time credit pack.' }}</p>
            </div>
            <div class="pricing-grid">
              <article class="price-card" *ngFor="let pack of packs" [class.highlight]="pack.id === 'popular'">
                <p class="eyebrow" *ngIf="pack.id === 'popular'">{{ locale === 'pl' ? 'Popularne' : 'Popular' }}</p>
                <h3>{{ pack.name[locale] }}</h3>
                <div class="price">{{ pack.price }}</div>
                <p>{{ pack.caption[locale] }}</p>
                <button class="btn-primary btn-block" type="button" (click)="buyPack(pack.id)">{{ pack.button[locale] }}</button>
              </article>
            </div>
          </section>

          <section class="section compact">
            <div class="section-header">
              <p class="eyebrow">{{ locale === 'pl' ? 'Historia' : 'History' }}</p>
              <h2 class="section-title">{{ locale === 'pl' ? 'Zakupy i bonusy' : 'Purchases and bonuses' }}</h2>
            </div>
            <div class="purchase-list" *ngIf="purchases().length; else noPurchases">
              <div class="purchase-row" *ngFor="let purchase of purchases()">
                <div>
                  <strong>{{ purchase.pack }}</strong>
                  <p style="margin: 4px 0 0; color: var(--muted);">{{ purchase.credits }} {{ copy.credits }}</p>
                </div>
                <strong>{{ purchase.priceUsd ? ('$' + purchase.priceUsd) : (purchase.paymentProvider === 'referral' ? 'bonus' : '') }}</strong>
              </div>
            </div>
            <ng-template #noPurchases>
              <div class="empty-panel">
                <p>{{ locale === 'pl' ? 'Nie ma jeszcze zakupów.' : 'No purchases yet.' }}</p>
              </div>
            </ng-template>
          </section>
        </ng-template>
      </main>
    </qs-shell>
  `
})
export class DashboardComponent implements OnInit {
  protected readonly route = inject(ActivatedRoute);
  protected readonly seo = inject(SeoService);
  protected readonly api = inject(ApiService);
  protected readonly purchases = signal<any[]>([]);
  protected readonly referral = signal<any>({});

  protected locale: Locale = 'en';
  protected data = pageData('dashboard', 'en');
  protected copied = false;
  protected copy = {
    dashboard: 'Dashboard',
    credits: 'Credits'
  };

  protected readonly packs = [
    {
      id: 'starter',
      price: '$1.99',
      name: { en: '100 credits', pl: '100 kredytów' },
      caption: { en: 'Small one-time top-up', pl: 'Małe jednorazowe doładowanie' },
      button: { en: 'Buy 100 credits', pl: 'Kup 100 kredytów' }
    },
    {
      id: 'popular',
      price: '$4.99',
      name: { en: '500 credits', pl: '500 kredytów' },
      caption: { en: 'Best for regular use', pl: 'Najlepsze do regularnego użycia' },
      button: { en: 'Buy 500 credits', pl: 'Kup 500 kredytów' }
    },
    {
      id: 'pro',
      price: '$9.99',
      name: { en: '2000 credits', pl: '2000 kredytów' },
      caption: { en: 'Large sessions and sharing', pl: 'Większe sesje i udostępnianie' },
      button: { en: 'Buy 2000 credits', pl: 'Kup 2000 kredytów' }
    }
  ];

  async ngOnInit(): Promise<void> {
    this.locale = (this.route.snapshot.data['locale'] || 'en') as Locale;
    this.copy = this.locale === 'pl'
      ? { dashboard: 'Panel', credits: 'Kredyty' }
      : { dashboard: 'Dashboard', credits: 'Credits' };
    this.data = pageData('dashboard', this.locale);
    this.seo.applyPage('dashboard', this.locale);
    await this.api.restoreSession();
    await Promise.all([this.loadHistory(), this.loadReferral()]);
  }

  protected async loadHistory(): Promise<void> {
    if (!this.api.token()) return;
    const result = await this.api.request('/api/credits/history');
    if (result.success && Array.isArray(result.purchases)) this.purchases.set(result.purchases);
  }

  protected async loadReferral(): Promise<void> {
    if (!this.api.token()) return;
    const result = await this.api.request('/api/credits/referrals');
    if (result.success) this.referral.set(result);
  }

  protected async buyPack(pack: string): Promise<void> {
    const result = await this.api.request('/api/credits/buy', {
      method: 'POST',
      body: JSON.stringify({ pack })
    });
    if (result.success && result.checkoutUrl) window.location.href = result.checkoutUrl;
  }

  protected async copyReferral(): Promise<void> {
    const link = this.referral().referralLink;
    if (!link || !navigator.clipboard) return;
    await navigator.clipboard.writeText(link);
    this.copied = true;
    setTimeout(() => this.copied = false, 1800);
  }
}
