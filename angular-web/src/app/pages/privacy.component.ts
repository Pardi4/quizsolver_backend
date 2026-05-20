import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SeoService } from '../seo.service';
import { Locale, contentFor, pageData } from '../site-content';
import { ShellComponent } from './shell.component';

@Component({
  standalone: true,
  imports: [CommonModule, ShellComponent],
  template: `
    <qs-shell [locale]="locale" pageKey="privacy">
      <main class="utility-page privacy-page" id="main-content">
        <section class="utility-hero">
          <div class="section-container utility-hero-grid">
            <div>
              <span class="section-badge">{{ data.badge }}</span>
              <h1 class="hero-title">{{ data.title }}</h1>
              <p class="hero-subtitle">{{ data.subtitle }}</p>
              <div class="utility-meta">
                <span>{{ data.effective }}</span>
                <span id="contact">{{ data.contactLabel }}: {{ data.contactValue }}</span>
              </div>
            </div>
            <aside class="utility-callout">
              <h2>{{ c.common.brand }}</h2>
              <p>{{ c.footer.description }}</p>
            </aside>
          </div>
        </section>
        <section class="privacy-content">
          <div class="section-container privacy-layout">
            <article class="privacy-card" *ngFor="let section of data.sections">
              <h2>{{ section.title }}</h2>
              <p *ngIf="section.text">{{ section.text }}</p>
              <ul *ngIf="section.items">
                <li *ngFor="let item of section.items">{{ item }}</li>
              </ul>
            </article>
          </div>
        </section>
      </main>
    </qs-shell>
  `
})
export class PrivacyComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);

  protected locale: Locale = 'en';
  protected c = contentFor('en');
  protected data = pageData('privacy', 'en');

  ngOnInit(): void {
    this.locale = (this.route.snapshot.data['locale'] || 'en') as Locale;
    this.c = contentFor(this.locale);
    this.data = pageData('privacy', this.locale);
    this.seo.applyPage('privacy', this.locale);
  }
}
