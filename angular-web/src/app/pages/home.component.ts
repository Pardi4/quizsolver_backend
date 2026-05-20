import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SeoService } from '../seo.service';
import { CHROME_WEB_STORE_URL, Locale } from '../site-content';
import { ShellComponent } from './shell.component';

@Component({
  standalone: true,
  imports: [CommonModule, ShellComponent],
  template: `
    <qs-shell [locale]="locale" pageKey="home">
      <section class="hero">
        <div class="container hero-inner">
          <p class="eyebrow">{{ text.hero.eyebrow }}</p>
          <h1>QuizSolver</h1>
          <p class="hero-lead">{{ text.hero.lead }}</p>
          <div class="hero-actions">
            <a class="btn-primary btn-lg" [href]="storeUrl" target="_blank" rel="noopener">{{ text.hero.primary }}</a>
            <a class="btn-outline btn-lg" href="#how-it-works">{{ text.hero.secondary }}</a>
          </div>
          <ul class="hero-proof">
            <li *ngFor="let item of text.hero.proof">{{ item }}</li>
          </ul>
        </div>
      </section>

      <aside class="hero-preview" aria-label="QuizSolver product preview">
        <div class="preview-top">
          <strong>QuizSolver</strong>
          <div class="preview-dots" aria-hidden="true"><span></span><span></span><span></span></div>
        </div>
        <div class="preview-body">
          <p class="eyebrow">{{ text.preview.badge }}</p>
          <p class="preview-question">{{ text.preview.question }}</p>
          <div class="preview-option">{{ text.preview.a }} <span>A</span></div>
          <div class="preview-option active">{{ text.preview.b }} <span>{{ text.preview.answer }}</span></div>
          <div class="preview-option">{{ text.preview.c }} <span>C</span></div>
          <div class="preview-status">{{ text.preview.status }}</div>
        </div>
      </aside>

      <section class="section" id="how-it-works">
        <div class="container">
          <div class="section-header">
            <p class="eyebrow">{{ text.how.eyebrow }}</p>
            <h2 class="section-title">{{ text.how.title }}</h2>
            <p class="section-subtitle">{{ text.how.subtitle }}</p>
          </div>
          <div class="steps-grid">
            <article class="step-card" *ngFor="let step of text.how.steps; let index = index">
              <div class="step-number">{{ index + 1 }}</div>
              <h3>{{ step.title }}</h3>
              <p>{{ step.text }}</p>
            </article>
          </div>
        </div>
      </section>

      <section class="section compact" id="features">
        <div class="container">
          <div class="section-header center">
            <p class="eyebrow">{{ text.features.eyebrow }}</p>
            <h2 class="section-title">{{ text.features.title }}</h2>
            <p class="section-subtitle">{{ text.features.subtitle }}</p>
          </div>
          <div class="feature-grid">
            <article class="feature-card" *ngFor="let feature of text.features.items">
              <div class="feature-icon">{{ feature.icon }}</div>
              <h3>{{ feature.title }}</h3>
              <p>{{ feature.text }}</p>
            </article>
          </div>
        </div>
      </section>

      <section class="section compact">
        <div class="container split-section">
          <div>
            <p class="eyebrow">{{ text.platforms.eyebrow }}</p>
            <h2 class="section-title">{{ text.platforms.title }}</h2>
            <p class="section-subtitle">{{ text.platforms.subtitle }}</p>
          </div>
          <div class="platform-grid">
            <a class="platform-tile" *ngFor="let platform of text.platforms.items" [href]="platform.href">{{ platform.name }}</a>
          </div>
        </div>
      </section>

      <section class="section compact" id="credits">
        <div class="container">
          <div class="section-header">
            <p class="eyebrow">{{ text.pricing.eyebrow }}</p>
            <h2 class="section-title">{{ text.pricing.title }}</h2>
            <p class="section-subtitle">{{ text.pricing.subtitle }}</p>
          </div>
          <div class="pricing-grid">
            <article class="price-card" *ngFor="let pack of text.pricing.packs" [class.highlight]="pack.id === 'popular'">
              <p class="eyebrow" *ngIf="pack.id === 'popular'">{{ text.pricing.badge }}</p>
              <h3>{{ pack.name }}</h3>
              <div class="price">{{ pack.price }}</div>
              <p>{{ pack.caption }}</p>
              <ul>
                <li *ngFor="let item of pack.features">{{ item }}</li>
              </ul>
              <a class="btn-primary btn-block" [href]="storeUrl" target="_blank" rel="noopener">{{ pack.button }}</a>
            </article>
          </div>
        </div>
      </section>

      <section class="section compact">
        <div class="container referral-band">
          <div class="split-section">
            <div>
              <p class="eyebrow">{{ text.referral.eyebrow }}</p>
              <h2 class="section-title">{{ text.referral.title }}</h2>
              <p class="section-subtitle">{{ text.referral.text }}</p>
              <ul class="check-list">
                <li *ngFor="let item of text.referral.steps">{{ item }}</li>
              </ul>
            </div>
            <div class="referral-code-demo">
              <span>{{ text.referral.label }}</span>
              <code>https://getquizsolver.com/?ref=abc123de</code>
              <strong>{{ text.referral.bonus }}</strong>
            </div>
          </div>
        </div>
      </section>

      <section class="section compact">
        <div class="container">
          <div class="section-header center">
            <p class="eyebrow">FAQ</p>
            <h2 class="section-title">{{ text.faqTitle }}</h2>
          </div>
          <div class="faq-grid">
            <details class="faq-item" *ngFor="let item of text.faq">
              <summary>{{ item.question }}</summary>
              <p>{{ item.answer }}</p>
            </details>
          </div>
        </div>
      </section>
    </qs-shell>
  `
})
export class HomeComponent implements OnInit {
  protected locale: Locale = 'en';
  protected readonly storeUrl = CHROME_WEB_STORE_URL;
  protected text = HOME_COPY.en;

  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);

  ngOnInit(): void {
    this.locale = (this.route.snapshot.data['locale'] || 'en') as Locale;
    this.text = HOME_COPY[this.locale];
    this.seo.applyPage('home', this.locale);
  }
}

const HOME_COPY: Record<Locale, any> = {
  en: {
    hero: {
      eyebrow: 'AI quiz solver Chrome extension',
      lead: 'A clean extension for answer suggestions, short explanations, saved question notes, images attached to questions, and practice quizzes from your own history.',
      primary: 'Install from Chrome Web Store',
      secondary: 'See how it works',
      proof: ['Testportal, Moodle, Canvas, Forms and more', 'Notes and images saved with questions', 'Shareable quizzes from history']
    },
    preview: {
      badge: 'Detected question',
      question: 'What should I do with this saved question after solving?',
      a: 'Forget it after the test',
      b: 'Save answer, image and note',
      c: 'Search the same topic again',
      answer: 'Best',
      status: 'Ready for history quiz and sharing'
    },
    how: {
      eyebrow: 'How it works',
      title: 'One workflow, not ten scattered tools',
      subtitle: 'QuizSolver keeps the fast answer flow and the study flow connected.',
      steps: [
        { title: 'Install and sign in', text: 'Use the same account in the extension and on getquizsolver.com.' },
        { title: 'Solve or scan', text: 'Use page solving for normal quizzes or FocusScan when a question is shown as an image.' },
        { title: 'Review later', text: 'Saved questions become notes, practice quizzes, and shareable quiz links.' }
      ]
    },
    features: {
      eyebrow: 'Features that matter',
      title: 'Built around real quiz work',
      subtitle: 'No fake admin calculators in the marketing. Just the features people actually use.',
      items: [
        { icon: 'AI', title: 'Answer suggestions', text: 'Detect visible questions and get concise answer suggestions from AI.' },
        { icon: 'EX', title: 'Short explanations', text: 'Add a one-click explanation when you need to understand the answer.' },
        { icon: 'IMG', title: 'Images saved with questions', text: 'When a question includes an image, QuizSolver keeps it with the saved note when possible.' },
        { icon: 'N', title: 'Question notes', text: 'Add your own note to solved questions directly after solving or later on the website.' },
        { icon: 'Q', title: 'Quiz from history', text: 'The notes page and history quiz point to the same useful place: your saved questions.' },
        { icon: 'SH', title: 'Share quiz links', text: 'Create a public quiz from selected saved questions and share it with someone else.' },
        { icon: 'FS', title: 'FocusScan', text: 'Select a region of the page when the question is image-based or hard to parse.' },
        { icon: 'PL', title: 'Polish and English UI', text: 'Readable interface in the extension and on the website.' }
      ]
    },
    platforms: {
      eyebrow: 'Platform support',
      title: 'Designed for the pages people actually open',
      subtitle: 'QuizSolver supports common quiz layouts and platform-specific flows.',
      items: [
        { name: 'Testportal', href: '/testportal-quiz-solver' },
        { name: 'Moodle', href: '/moodle-quiz-solver' },
        { name: 'Canvas', href: '/canvas-quiz-solver' },
        { name: 'Google Forms', href: '/google-forms-quiz-solver' },
        { name: 'Microsoft Forms', href: '/microsoft-forms-quiz-solver' },
        { name: 'Blackboard', href: '/blackboard-quiz-solver' },
        { name: 'Quizlet', href: '/quizlet-solver' },
        { name: 'Socrative', href: '/socrative-quiz-solver' },
        { name: 'Kahoot', href: '/kahoot-ai-bot' },
        { name: 'Quizizz', href: '/quizizz-solver' }
      ]
    },
    pricing: {
      eyebrow: 'Credits',
      title: 'Buy credits when you actually need them',
      subtitle: 'One-time credit packs keep the product simple: answer suggestions and explanations spend credits, history stays useful afterwards.',
      badge: 'Popular',
      packs: [
        { id: 'starter', name: '100 credits', price: '$1.99', caption: 'Small top-up', button: 'Get started', features: ['One-time purchase', 'Good for quick practice', 'Works with solving and explanations'] },
        { id: 'popular', name: '500 credits', price: '$4.99', caption: 'Regular use', button: 'Choose 500 credits', features: ['Better value per credit', 'Good for saved notes', 'Balanced for weekly use'] },
        { id: 'pro', name: '2000 credits', price: '$9.99', caption: 'Large sessions', button: 'Choose 2000 credits', features: ['Lowest cost per credit', 'Best for heavy review', 'Useful for bigger classes or teams'] }
      ]
    },
    referral: {
      eyebrow: 'Reference code',
      title: 'Referral codes give the referrer 5% of bought credits',
      text: 'Every user gets a referral link. When a new user registers from that link and later buys credits, the user who referred them receives a bonus equal to 5% of that purchase in credits.',
      label: 'Example referral link',
      bonus: 'Example: 500 bought credits = 25 bonus credits for the referrer.',
      steps: ['Copy your link from the dashboard.', 'Share it with a friend.', 'They register and buy credits.', 'Your account receives the 5% credit bonus automatically.']
    },
    faqTitle: 'Useful details before installing',
    faq: [
      { question: 'Is QuizSolver only for Testportal?', answer: 'No. It supports Testportal and many common quiz layouts, including Moodle, Canvas, Google Forms, Microsoft Forms and more.' },
      { question: 'Are notes and history the same place?', answer: 'Yes. Saved notes and the quiz from history now lead to one page, so users do not have to guess where their questions are.' },
      { question: 'Can I share a quiz?', answer: 'Yes. You can create a share link from saved questions and let another person attempt the quiz.' },
      { question: 'Does the referral code take credits away from the buyer?', answer: 'No. The buyer receives the credits they bought. The referrer gets an extra 5% bonus in credits.' }
    ]
  },
  pl: {
    hero: {
      eyebrow: 'Rozszerzenie Chrome AI quiz solver',
      lead: 'Czytelne rozszerzenie do sugestii odpowiedzi, krótkich wyjaśnień, notatek przy pytaniach, obrazów zapisanych razem z pytaniem i quizów z własnej historii.',
      primary: 'Zainstaluj z Chrome Web Store',
      secondary: 'Zobacz jak działa',
      proof: ['Testportal, Moodle, Canvas, Forms i więcej', 'Notatki i obrazy zapisane przy pytaniu', 'Udostępniane quizy z historii']
    },
    preview: {
      badge: 'Wykryte pytanie',
      question: 'Co zrobić z pytaniem po rozwiązaniu?',
      a: 'Zapomnieć po teście',
      b: 'Zapisać odpowiedź, obraz i notatkę',
      c: 'Szukać tematu od nowa',
      answer: 'Najlepiej',
      status: 'Gotowe do quizu z historii i udostępnienia'
    },
    how: {
      eyebrow: 'Jak to działa',
      title: 'Jeden workflow zamiast kilku przypadkowych narzędzi',
      subtitle: 'QuizSolver łączy szybkie odpowiedzi z późniejszą nauką.',
      steps: [
        { title: 'Zainstaluj i zaloguj się', text: 'Używasz tego samego konta w rozszerzeniu i na getquizsolver.com.' },
        { title: 'Rozwiąż albo zeskanuj', text: 'Użyj rozwiązywania strony albo FocusScan, gdy pytanie jest obrazkiem.' },
        { title: 'Wróć do pytań później', text: 'Zapisane pytania stają się notatkami, quizem z historii i linkiem do udostępnienia.' }
      ]
    },
    features: {
      eyebrow: 'Sensowne funkcje',
      title: 'Zbudowane pod realne użycie przy quizach',
      subtitle: 'Bez marketingu o adminie i liczeniu kosztu. Tu są funkcje, których użytkownik faktycznie potrzebuje.',
      items: [
        { icon: 'AI', title: 'Sugestie odpowiedzi', text: 'Wykrywanie pytań na stronie i krótkie sugestie odpowiedzi od AI.' },
        { icon: 'EX', title: 'Krótkie wyjaśnienia', text: 'Jednym kliknięciem możesz dodać wyjaśnienie, jeśli chcesz zrozumieć odpowiedź.' },
        { icon: 'IMG', title: 'Obraz zapisany z pytaniem', text: 'Jeśli pytanie ma zdjęcie, QuizSolver zapisuje je przy notatce, kiedy jest to możliwe.' },
        { icon: 'N', title: 'Notatki do pytań', text: 'Dodawaj własną notatkę po rozwiązaniu albo później na stronie.' },
        { icon: 'Q', title: 'Quiz z historii', text: 'Notatki i quiz z historii prowadzą do jednego miejsca: zapisanych pytań.' },
        { icon: 'SH', title: 'Udostępnianie quizu', text: 'Z zapisanych pytań możesz stworzyć publiczny link do quizu.' },
        { icon: 'FS', title: 'FocusScan', text: 'Zaznacz fragment strony, gdy pytanie jest obrazkiem albo parser go nie widzi.' },
        { icon: 'PL', title: 'Interfejs PL i EN', text: 'Czytelny interfejs w rozszerzeniu i na stronie.' }
      ]
    },
    platforms: {
      eyebrow: 'Obsługiwane platformy',
      title: 'Pod strony, które ludzie naprawdę otwierają',
      subtitle: 'QuizSolver obsługuje popularne układy quizów i przepływy pod konkretne platformy.',
      items: [
        { name: 'Testportal', href: '/pl/testportal-quiz-solver' },
        { name: 'Moodle', href: '/pl/moodle-quiz-solver' },
        { name: 'Canvas', href: '/pl/canvas-quiz-solver' },
        { name: 'Google Forms', href: '/pl/google-forms-quiz-solver' },
        { name: 'Microsoft Forms', href: '/pl/microsoft-forms-quiz-solver' },
        { name: 'Blackboard', href: '/pl/blackboard-quiz-solver' },
        { name: 'Quizlet', href: '/pl/quizlet-solver' },
        { name: 'Socrative', href: '/pl/socrative-quiz-solver' },
        { name: 'Kahoot', href: '/pl/kahoot-ai-bot' },
        { name: 'Quizizz', href: '/pl/quizizz-solver' }
      ]
    },
    pricing: {
      eyebrow: 'Kredyty',
      title: 'Kupujesz kredyty wtedy, kiedy ich potrzebujesz',
      subtitle: 'Jednorazowe pakiety są proste: odpowiedzi i wyjaśnienia zużywają kredyty, a historia pytań zostaje przydatna później.',
      badge: 'Popularne',
      packs: [
        { id: 'starter', name: '100 kredytów', price: '$1.99', caption: 'Małe doładowanie', button: 'Zacznij', features: ['Jednorazowy zakup', 'Dobry do szybkiej powtórki', 'Działa z odpowiedziami i wyjaśnieniami'] },
        { id: 'popular', name: '500 kredytów', price: '$4.99', caption: 'Regularne użycie', button: 'Wybierz 500 kredytów', features: ['Lepsza cena za kredyt', 'Dobre do notatek', 'W sam raz do używania co tydzień'] },
        { id: 'pro', name: '2000 kredytów', price: '$9.99', caption: 'Większe sesje', button: 'Wybierz 2000 kredytów', features: ['Najniższy koszt za kredyt', 'Najlepsze do większych powtórek', 'Przydatne dla grup i klas'] }
      ]
    },
    referral: {
      eyebrow: 'Reference code',
      title: 'Kod polecenia daje polecającemu 5% kupionych kredytów',
      text: 'Każdy użytkownik ma link polecający. Gdy nowa osoba zarejestruje się z tego linku i później kupi kredyty, użytkownik polecający dostaje bonus równy 5% tego zakupu w kredytach.',
      label: 'Przykładowy link polecający',
      bonus: 'Przykład: zakup 500 kredytów = 25 kredytów bonusu dla polecającego.',
      steps: ['Skopiuj link w panelu.', 'Wyślij go znajomemu.', 'Znajomy rejestruje się i kupuje kredyty.', 'Bonus 5% trafia automatycznie na Twoje konto.']
    },
    faqTitle: 'Najważniejsze przed instalacją',
    faq: [
      { question: 'Czy QuizSolver jest tylko pod Testportal?', answer: 'Nie. Obsługuje Testportal i wiele popularnych układów quizów, między innymi Moodle, Canvas, Google Forms i Microsoft Forms.' },
      { question: 'Czy notatki i quiz z historii to jedno miejsce?', answer: 'Tak. Zapisane notatki i quiz z historii prowadzą do jednej strony, żeby nie było dwóch takich samych widoków.' },
      { question: 'Czy mogę udostępnić quiz?', answer: 'Tak. Z zapisanych pytań możesz stworzyć link i udostępnić go innej osobie.' },
      { question: 'Czy kod polecenia zabiera kredyty kupującemu?', answer: 'Nie. Kupujący dostaje kupione kredyty, a polecający otrzymuje dodatkowy bonus 5% w kredytach.' }
    ]
  }
};
