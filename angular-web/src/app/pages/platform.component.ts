import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SeoService } from '../seo.service';
import { Locale, PageKey, contentFor, pageData, pathFor, platformEntries } from '../site-content';
import { ShellComponent } from './shell.component';

@Component({
  standalone: true,
  imports: [CommonModule, ShellComponent],
  template: `
    <qs-shell [locale]="locale" [pageKey]="pageKey">
      <main class="seo-page" id="main-content">
        <section class="platform-hero">
          <div class="section-container platform-hero-grid">
            <div>
              <nav class="breadcrumbs" aria-label="Breadcrumb">
                <a [href]="pathFor('home')">QuizSolver</a>
                <span>/</span>
                <span>{{ data.shortName || data.platformName }}</span>
              </nav>
              <p class="eyebrow">{{ data.badge || platformLabel }}</p>
              <h1 class="hero-title">{{ data.title }}</h1>
              <p class="hero-subtitle">{{ data.subtitle }}</p>
              <div class="hero-buttons">
                <a class="btn-primary btn-lg" [href]="pathFor('home') + '#credits'">{{ locale === 'pl' ? 'Zainstaluj rozszerzenie' : 'Install extension' }}</a>
                <a class="btn-outline btn-lg" href="#platform-guides">{{ locale === 'pl' ? 'Zobacz podobne strony' : 'See related pages' }}</a>
              </div>
            </div>
            <aside class="seo-panel">
              <h2>{{ locale === 'pl' ? 'Co robi QuizSolver?' : 'What QuizSolver does' }}</h2>
              <p>{{ platformIntro }}</p>
              <ul class="clean-list">
                <li>{{ locale === 'pl' ? 'Sugestie odpowiedzi AI' : 'AI answer suggestions' }}</li>
                <li>{{ locale === 'pl' ? 'Krótkie wyjaśnienia' : 'Short explanations' }}</li>
                <li>{{ locale === 'pl' ? 'Notatki i quiz z historii' : 'Notes and history quiz' }}</li>
                <li>{{ locale === 'pl' ? 'Udostępnianie quizu z zapisanych pytań' : 'Shareable quizzes from saved questions' }}</li>
              </ul>
            </aside>
          </div>
        </section>

        <section class="section compact">
          <div class="section-container seo-columns">
            <article class="seo-panel">
              <h2>{{ data.stepsTitle || (locale === 'pl' ? 'Jak zacząć' : 'How to start') }}</h2>
              <ol class="clean-list">
                <li *ngFor="let step of data.steps">{{ step }}</li>
              </ol>
            </article>
            <article class="seo-panel">
              <h2>{{ locale === 'pl' ? 'Funkcje w tym workflow' : 'Features in this workflow' }}</h2>
              <ul class="clean-list">
                <li *ngFor="let feature of data.features">{{ feature }}</li>
              </ul>
            </article>
          </div>
          <div class="section-container ethical-note" *ngIf="data.note">
            <p>{{ data.note }}</p>
          </div>
        </section>

        <section class="section compact" *ngIf="data.keywordSections?.length">
          <div class="section-container keyword-grid">
            <article class="keyword-panel" *ngFor="let section of data.keywordSections">
              <h2>{{ section.title }}</h2>
              <p>{{ section.text }}</p>
            </article>
          </div>
        </section>

        <section class="section compact" id="platform-guides">
          <div class="section-container">
            <div class="section-header">
              <p class="eyebrow">{{ locale === 'pl' ? 'Platformy' : 'Platforms' }}</p>
              <h2 class="section-title">{{ locale === 'pl' ? 'Inne poradniki QuizSolver' : 'Other QuizSolver guides' }}</h2>
              <p class="section-subtitle">{{ locale === 'pl' ? 'Każda platforma ma osobną stronę, żeby użytkownik od razu widział właściwy kontekst.' : 'Each platform has its own page so users land in the right context immediately.' }}</p>
            </div>
            <div class="related-grid">
              <a class="related-card" *ngFor="let entry of relatedPages()" [href]="pathFor(entry.pageKey)">
                <span>{{ entry.data.shortName || entry.data.platformName }}</span>
                <strong>{{ entry.data.linkTitle || entry.data.title }}</strong>
              </a>
            </div>
          </div>
        </section>

        <section class="section compact" *ngIf="data.faq?.length">
          <div class="section-container">
            <div class="section-header">
              <p class="eyebrow">FAQ</p>
              <h2 class="section-title">{{ locale === 'pl' ? 'Pytania o ten workflow' : 'Questions about this workflow' }}</h2>
            </div>
            <div class="faq-grid">
              <details class="faq-item" *ngFor="let item of data.faq">
                <summary>{{ item.question }}</summary>
                <p>{{ item.answer }}</p>
              </details>
            </div>
          </div>
        </section>
      </main>
    </qs-shell>
  `
})
export class PlatformComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);

  protected locale: Locale = 'en';
  protected pageKey: PageKey = 'quizSolverAi';
  protected data = pageData('quizSolverAi', 'en');
  protected platformLabel = 'AI quiz solver';
  protected platformIntro = '';

  ngOnInit(): void {
    this.locale = (this.route.snapshot.data['locale'] || 'en') as Locale;
    this.pageKey = this.route.snapshot.data['pageKey'] as PageKey;
    this.data = pageData(this.pageKey, this.locale);
    this.platformLabel = this.data?.shortName || this.data?.platformName || 'AI quiz solver';
    this.platformIntro = this.locale === 'pl'
      ? `QuizSolver pomaga przy dozwolonych ćwiczeniach i powtórkach w stylu ${this.platformLabel}: wykrywa pytania, zapisuje historię i pozwala wrócić do nich później.`
      : `QuizSolver helps with permitted ${this.platformLabel} practice workflows: it detects questions, saves history, and lets you review them later.`;
    this.seo.applyPage(this.pageKey, this.locale);
  }

  protected pathFor(pageKey: PageKey): string {
    return pathFor(pageKey, this.locale);
  }

  protected relatedPages(): Array<{ pageKey: PageKey; data: any }> {
    return platformEntries(this.locale).filter((entry) => entry.pageKey !== this.pageKey);
  }
}
