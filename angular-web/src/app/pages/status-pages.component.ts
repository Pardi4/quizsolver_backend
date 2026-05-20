import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CHROME_WEB_STORE_URL, Locale, PageKey, contentFor, pageData, pathFor } from '../site-content';
import { SeoService } from '../seo.service';
import { ShellComponent } from './shell.component';

@Component({
  standalone: true,
  imports: [CommonModule, ShellComponent],
  template: `
    <qs-shell [locale]="locale" [pageKey]="pageKey">
      <main class="utility-page not-found-hero" id="main-content">
        <div class="section-container utility-hero-grid">
          <div>
            <span class="section-badge">{{ data.badge }}</span>
            <h1 class="hero-title">{{ data.title }}</h1>
            <p class="hero-subtitle">{{ data.subtitle }}</p>
            <div class="hero-buttons">
              <a class="btn-primary btn-lg" [href]="pathFor(pageKey === 'success' ? 'dashboard' : 'home')">{{ data.dashboardCta || data.homeCta }}</a>
              <a class="btn-outline btn-lg" [href]="storeUrl" target="_blank" rel="noopener">{{ data.storeCta }}</a>
            </div>
          </div>
          <aside class="not-found-code">
            <span>{{ pageKey === 'success' ? 'OK' : '404' }}</span>
            <p>{{ c.common.brand }}</p>
          </aside>
        </div>
      </main>
    </qs-shell>
  `
})
export class StatusPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);

  protected locale: Locale = 'en';
  protected pageKey: PageKey = 'success';
  protected c = contentFor('en');
  protected data = pageData('success', 'en');
  protected readonly storeUrl = CHROME_WEB_STORE_URL;

  ngOnInit(): void {
    this.locale = (this.route.snapshot.data['locale'] || 'en') as Locale;
    this.pageKey = this.route.snapshot.data['pageKey'] as PageKey;
    this.c = contentFor(this.locale);
    this.data = pageData(this.pageKey, this.locale);
    this.seo.applyPage(this.pageKey, this.locale);
  }

  protected pathFor(pageKey: PageKey): string {
    return pathFor(pageKey, this.locale);
  }
}
