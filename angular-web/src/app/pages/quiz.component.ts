import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../api.service';
import { SeoService } from '../seo.service';
import { Locale, pageData } from '../site-content';
import { ShellComponent } from './shell.component';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, ShellComponent],
  template: `
    <qs-shell [locale]="locale" pageKey="quiz">
      <main class="container" style="min-height: 80vh;">
        <ng-container *ngIf="sharedToken; else privateQuiz">
          <section class="section">
            <div class="section-header">
              <p class="eyebrow">{{ text.sharedBadge }}</p>
              <h1 class="section-title">{{ sharedQuiz()?.title || text.sharedTitle }}</h1>
              <p class="section-subtitle">{{ text.sharedSubtitle }}</p>
            </div>

            <div class="shared-layout" *ngIf="sharedQuestions().length; else sharedLoading">
              <section class="shared-grid">
                <article class="shared-card" *ngFor="let question of sharedQuestions(); let i = index">
                  <p class="eyebrow">{{ i + 1 }} / {{ sharedQuestions().length }}</p>
                  <img class="question-image" *ngIf="imageSrc(question)" [src]="imageSrc(question)" alt="">
                  <h3>{{ question.questionText }}</h3>
                  <div class="answer-panel" *ngIf="question.options?.length; else sharedTextAnswer">
                    <label class="answer-choice" *ngFor="let option of question.options; let optionIndex = index" [class.active]="isSharedChosen(question.id, optionIndex)">
                      <input [type]="question.questionType === 'checkbox' ? 'checkbox' : 'radio'" [name]="'shared-' + question.id" [checked]="isSharedChosen(question.id, optionIndex)" (change)="chooseShared(question, optionIndex)">
                      <span>{{ option }}</span>
                    </label>
                  </div>
                  <ng-template #sharedTextAnswer>
                    <input class="form-input" [value]="sharedAnswers()[question.id] || ''" (input)="setSharedText(question.id, $any($event.target).value)" [placeholder]="text.typeAnswer">
                  </ng-template>
                </article>
              </section>

              <aside class="shared-card">
                <h2>{{ text.submitShared }}</h2>
                <p>{{ text.submitSharedText }}</p>
                <input class="form-input" [(ngModel)]="sharedDisplayName" [placeholder]="text.displayName">
                <button class="btn-primary btn-block" type="button" (click)="submitShared()" [disabled]="sharedSubmitting()">{{ sharedSubmitting() ? text.loading : text.checkAnswers }}</button>
                <div class="score-box" *ngIf="sharedResult() as result">
                  <strong>{{ result.score }} / {{ result.totalQuestions }}</strong>
                  <p>{{ text.correctAnswers }}</p>
                </div>
              </aside>
            </div>

            <ng-template #sharedLoading>
              <div class="empty-panel">
                <p>{{ sharedError() || text.loading }}</p>
              </div>
            </ng-template>
          </section>
        </ng-container>

        <ng-template #privateQuiz>
          <section class="section">
            <div class="section-header">
              <p class="eyebrow">{{ text.badge }}</p>
              <h1 class="section-title">{{ text.title }}</h1>
              <p class="section-subtitle">{{ text.subtitle }}</p>
            </div>

            <section *ngIf="!api.token()" class="login-panel" style="max-width: 520px;">
              <h2>{{ text.loginTitle }}</h2>
              <p>{{ text.loginSubtitle }}</p>
              <form (ngSubmit)="login()">
                <div class="form-group">
                  <input class="form-input" type="email" name="email" [(ngModel)]="email" placeholder="Email" autocomplete="email" required>
                </div>
                <div class="form-group">
                  <input class="form-input" type="password" name="password" [(ngModel)]="password" [placeholder]="text.password" autocomplete="current-password" required>
                </div>
                <button class="btn-primary btn-block" type="submit">{{ text.signIn }}</button>
              </form>
              <div class="form-error" *ngIf="error()">{{ error() }}</div>
            </section>

            <section *ngIf="api.token() && !practice().length">
              <div class="quiz-toolbar">
                <div>
                  <h2>{{ text.historyTitle }}</h2>
                  <p class="section-subtitle">{{ notes().length }} {{ text.historyCount }}</p>
                </div>
                <div class="filter-row">
                  <input class="form-input" type="search" [(ngModel)]="search" (ngModelChange)="loadNotes()" [placeholder]="text.searchPlaceholder">
                  <select class="form-select" [(ngModel)]="status" (ngModelChange)="loadNotes()">
                    <option value="">{{ text.filterAll }}</option>
                    <option value="favorite">{{ text.filterFavorite }}</option>
                    <option value="new">{{ text.filterNew }}</option>
                    <option value="learning">{{ text.filterLearning }}</option>
                    <option value="mastered">{{ text.filterMastered }}</option>
                  </select>
                  <button class="btn-outline" type="button" (click)="selectVisible()">{{ text.selectVisible }}</button>
                  <button class="btn-primary" type="button" (click)="startPractice()">{{ text.startPractice }}</button>
                </div>
              </div>

              <div class="empty-panel" *ngIf="!loading() && !notes().length">
                <h3>{{ text.emptyTitle }}</h3>
                <p>{{ text.emptyText }}</p>
              </div>

              <div class="notes-grid">
                <article class="note-card" *ngFor="let note of notes()">
                  <div class="note-head">
                    <label class="pill">
                      <input type="checkbox" [checked]="selected().has(note.id)" (change)="toggleSelected(note.id)">
                      {{ text.selected }}
                    </label>
                    <button class="btn-outline btn-sm" type="button" (click)="updateNote(note, { favorite: !note.favorite })">{{ note.favorite ? text.favorited : text.favorite }}</button>
                  </div>
                  <img class="question-image" *ngIf="imageSrc(note)" [src]="imageSrc(note)" alt="">
                  <h3>{{ note.questionText }}</h3>
                  <div class="note-meta">
                    <span>{{ note.platform || 'quiz' }}</span>
                    <span>{{ note.status || 'new' }}</span>
                  </div>
                  <div class="answer-panel">
                    <strong>{{ text.answer }}</strong>
                    <p>{{ note.answerText }}</p>
                  </div>
                  <div class="explanation-panel">
                    <strong>{{ text.explanation }}</strong>
                    <p>{{ note.explanation || text.noExplanation }}</p>
                  </div>
                  <label>
                    <span class="eyebrow">{{ text.personalNote }}</span>
                    <textarea [(ngModel)]="note.personalNote" [placeholder]="text.notePlaceholder"></textarea>
                  </label>
                  <div class="note-actions">
                    <select class="form-select" [(ngModel)]="note.status" (ngModelChange)="updateNote(note, { status: note.status })">
                      <option value="new">{{ text.new }}</option>
                      <option value="learning">{{ text.learning }}</option>
                      <option value="mastered">{{ text.mastered }}</option>
                    </select>
                    <button class="btn-primary" type="button" (click)="updateNote(note, { personalNote: note.personalNote || '' })">{{ text.saveNote }}</button>
                  </div>
                </article>
              </div>
            </section>

            <section *ngIf="practice().length" class="practice-card">
              <div class="practice-top">
                <button class="btn-outline" type="button" (click)="backToNotes()">{{ text.backToNotes }}</button>
                <strong>{{ currentIndex() + 1 }} / {{ practice().length }}</strong>
              </div>

              <article *ngIf="!finished() && currentQuestion() as question">
                <p class="eyebrow">{{ question.platform || 'QuizSolver' }}</p>
                <img class="question-image" *ngIf="imageSrc(question)" [src]="imageSrc(question)" alt="">
                <h2>{{ question.questionText }}</h2>

                <div class="answer-panel" *ngIf="question.options?.length; else practiceTextAnswer">
                  <label class="answer-choice" *ngFor="let option of question.options; let i = index" [class.active]="isChosen(i)">
                    <input [type]="question.questionType === 'checkbox' ? 'checkbox' : 'radio'" name="answer" [checked]="isChosen(i)" (change)="chooseAnswer(i, question.questionType)">
                    <span>{{ option }}</span>
                  </label>
                </div>
                <ng-template #practiceTextAnswer>
                  <input class="form-input" [(ngModel)]="typedAnswer" [placeholder]="text.typeAnswer">
                </ng-template>

                <div class="result-panel" [class.correct]="isCorrect()" [class.incorrect]="!isCorrect()" *ngIf="checked()">
                  <strong>{{ isCorrect() ? text.correct : text.incorrect }}</strong>
                  <p>{{ question.explanation || text.noExplanation }}</p>
                </div>

                <div class="section-actions">
                  <button class="btn-primary" type="button" *ngIf="!checked()" (click)="checkAnswer(question)">{{ text.checkAnswer }}</button>
                  <button class="btn-outline" type="button" *ngIf="checked()" (click)="nextQuestion()">{{ text.nextQuestion }}</button>
                </div>
              </article>

              <div class="empty-panel" *ngIf="finished()">
                <h2>{{ text.resultTitle }}</h2>
                <p>{{ score() }} / {{ practice().length }} {{ text.correctAnswers }}</p>
                <button class="btn-primary" type="button" (click)="restartPractice()">{{ text.restartPractice }}</button>
              </div>
            </section>
          </section>
        </ng-template>
      </main>
    </qs-shell>
  `
})
export class QuizComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);
  protected readonly api = inject(ApiService);

  protected locale: Locale = 'en';
  protected text = QUIZ_TEXT.en;
  protected email = '';
  protected password = '';
  protected search = '';
  protected status = '';
  protected typedAnswer = '';
  protected sharedToken = '';
  protected sharedDisplayName = '';

  protected readonly notes = signal<any[]>([]);
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly practice = signal<any[]>([]);
  protected readonly currentIndex = signal(0);
  protected readonly chosen = signal<Set<number>>(new Set());
  protected readonly checked = signal(false);
  protected readonly correct = signal(false);
  protected readonly score = signal(0);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly finished = signal(false);
  protected readonly currentQuestion = computed(() => this.practice()[this.currentIndex()] || null);

  protected readonly sharedQuiz = signal<any>(null);
  protected readonly sharedQuestions = signal<any[]>([]);
  protected readonly sharedAnswers = signal<Record<string, any>>({});
  protected readonly sharedResult = signal<any>(null);
  protected readonly sharedSubmitting = signal(false);
  protected readonly sharedError = signal('');

  async ngOnInit(): Promise<void> {
    this.locale = (this.route.snapshot.data['locale'] || 'en') as Locale;
    this.text = QUIZ_TEXT[this.locale];
    this.seo.applyPage('quiz', this.locale, { robots: 'index, follow' });
    this.sharedToken = this.route.snapshot.paramMap.get('token') || '';

    if (this.sharedToken) {
      await this.loadSharedQuiz();
      return;
    }

    await this.api.restoreSession();
    await this.loadNotes();
  }

  protected imageSrc(item: any): string {
    return item?.questionImageBase64 || item?.questionImageUrl || '';
  }

  protected async login(): Promise<void> {
    const result = await this.api.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: this.email, password: this.password, rememberMe: true })
    });
    if (result.success && result.token) {
      this.api.setSession(result.token, result.user);
      await this.loadNotes();
      return;
    }
    this.error.set(result.error || this.text.loginError);
  }

  protected async loadNotes(): Promise<void> {
    if (!this.api.token()) return;
    this.loading.set(true);
    const params = new URLSearchParams();
    if (this.search.trim()) params.set('search', this.search.trim());
    if (this.status === 'favorite') params.set('favorite', 'true');
    else if (this.status) params.set('status', this.status);
    const result = await this.api.request(`/api/quiz/study-notes${params.size ? `?${params}` : ''}`);
    this.loading.set(false);
    if (result.success && Array.isArray(result.notes)) this.notes.set(result.notes);
  }

  protected toggleSelected(id: string): void {
    const next = new Set(this.selected());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selected.set(next);
  }

  protected selectVisible(): void {
    this.selected.set(new Set(this.notes().map((note) => note.id)));
  }

  protected async updateNote(note: any, patch: any): Promise<void> {
    Object.assign(note, patch);
    this.notes.set([...this.notes()]);
    await this.api.request(`/api/quiz/study-notes/${note.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
  }

  protected async startPractice(): Promise<void> {
    const noteIds = Array.from(this.selected());
    if (!noteIds.length) {
      this.error.set(this.text.selectAtLeastOne);
      return;
    }
    const result = await this.api.request('/api/quiz/practice', {
      method: 'POST',
      body: JSON.stringify({ noteIds })
    });
    if (result.success && Array.isArray(result.questions)) {
      this.practice.set(result.questions);
      this.currentIndex.set(0);
      this.score.set(0);
      this.checked.set(false);
      this.finished.set(false);
      this.chosen.set(new Set());
      this.typedAnswer = '';
    }
  }

  protected chooseAnswer(index: number, type: string): void {
    const next = type === 'checkbox' ? new Set(this.chosen()) : new Set<number>();
    if (type === 'checkbox' && next.has(index)) next.delete(index);
    else next.add(index);
    this.chosen.set(next);
  }

  protected isChosen(index: number): boolean {
    return this.chosen().has(index);
  }

  protected checkAnswer(question: any): void {
    const value = question.questionType === 'text'
      ? this.typedAnswer.trim().toLowerCase()
      : Array.from(this.chosen()).sort((a, b) => a - b);
    const answer = question.questionType === 'text'
      ? String(question.answerText || question.answer || '').trim().toLowerCase()
      : Array.isArray(question.answer) ? [...question.answer].sort((a, b) => a - b) : [question.answer];
    const ok = JSON.stringify(value) === JSON.stringify(answer);
    this.correct.set(ok);
    this.checked.set(true);
    if (ok) this.score.set(this.score() + 1);
  }

  protected isCorrect(): boolean {
    return this.correct();
  }

  protected nextQuestion(): void {
    if (this.currentIndex() + 1 >= this.practice().length) {
      this.finished.set(true);
      return;
    }
    this.currentIndex.set(this.currentIndex() + 1);
    this.chosen.set(new Set());
    this.typedAnswer = '';
    this.checked.set(false);
    this.correct.set(false);
  }

  protected backToNotes(): void {
    this.practice.set([]);
    this.finished.set(false);
  }

  protected restartPractice(): void {
    this.currentIndex.set(0);
    this.score.set(0);
    this.chosen.set(new Set());
    this.checked.set(false);
    this.correct.set(false);
    this.finished.set(false);
  }

  protected async loadSharedQuiz(): Promise<void> {
    try {
      const response = await fetch(`/api/quiz/shared/${encodeURIComponent(this.sharedToken)}`);
      const data = await response.json();
      if (!data.success) {
        this.sharedError.set(data.error || this.text.sharedError);
        return;
      }
      this.sharedQuiz.set(data.quiz);
      this.sharedQuestions.set(data.questions || []);
    } catch {
      this.sharedError.set(this.text.sharedError);
    }
  }

  protected isSharedChosen(questionId: string, optionIndex: number): boolean {
    const value = this.sharedAnswers()[questionId];
    return Array.isArray(value) ? value.includes(optionIndex) : value === optionIndex;
  }

  protected chooseShared(question: any, optionIndex: number): void {
    const next = { ...this.sharedAnswers() };
    if (question.questionType === 'checkbox') {
      const values = Array.isArray(next[question.id]) ? [...next[question.id]] : [];
      const existing = values.indexOf(optionIndex);
      if (existing >= 0) values.splice(existing, 1);
      else values.push(optionIndex);
      next[question.id] = values;
    } else {
      next[question.id] = optionIndex;
    }
    this.sharedAnswers.set(next);
  }

  protected setSharedText(questionId: string, value: string): void {
    this.sharedAnswers.set({ ...this.sharedAnswers(), [questionId]: value });
  }

  protected async submitShared(): Promise<void> {
    this.sharedSubmitting.set(true);
    try {
      const orderedAnswers = this.sharedQuestions().map((question) => {
        const value = this.sharedAnswers()[question.id];
        return value === undefined ? (question.questionType === 'checkbox' ? [] : '') : value;
      });
      const response = await fetch(`/api/quiz/shared/${encodeURIComponent(this.sharedToken)}/attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: this.sharedDisplayName || this.text.anonymous,
          answers: orderedAnswers
        })
      });
      const data = await response.json();
      if (data.success) this.sharedResult.set(data);
      else this.sharedError.set(data.error || this.text.sharedError);
    } catch {
      this.sharedError.set(this.text.sharedError);
    }
    this.sharedSubmitting.set(false);
  }
}

const QUIZ_TEXT: Record<Locale, any> = {
  en: {
    badge: 'History and notes',
    title: 'Your saved questions become a quiz',
    subtitle: 'Notes and quiz from history now live on the same page. Select questions, add your own notes, and practice them later.',
    loginTitle: 'Sign in to load your history',
    loginSubtitle: 'Use the same account as the Chrome extension.',
    password: 'Password',
    signIn: 'Sign in',
    loginError: 'Could not sign in.',
    historyTitle: 'Saved questions',
    historyCount: 'questions',
    searchPlaceholder: 'Search notes',
    filterAll: 'All',
    filterFavorite: 'Favorites',
    filterNew: 'New',
    filterLearning: 'Learning',
    filterMastered: 'Mastered',
    selectVisible: 'Select visible',
    startPractice: 'Start history quiz',
    emptyTitle: 'No saved questions yet',
    emptyText: 'Solve questions with history saving enabled in the extension, then return here.',
    selected: 'Selected',
    favorited: 'Favorite',
    favorite: 'Mark favorite',
    answer: 'Answer',
    explanation: 'Explanation',
    noExplanation: 'No explanation saved yet.',
    personalNote: 'Your note',
    notePlaceholder: 'Add what you want to remember...',
    saveNote: 'Save note',
    new: 'New',
    learning: 'Learning',
    mastered: 'Mastered',
    backToNotes: 'Back to history',
    typeAnswer: 'Type your answer',
    checkAnswer: 'Check answer',
    nextQuestion: 'Next question',
    correct: 'Correct',
    incorrect: 'Not quite',
    resultTitle: 'Practice complete',
    correctAnswers: 'correct answers',
    restartPractice: 'Practice again',
    selectAtLeastOne: 'Select at least one question.',
    sharedBadge: 'Shared quiz',
    sharedTitle: 'Shared QuizSolver quiz',
    sharedSubtitle: 'Answer the shared questions and submit your attempt.',
    submitShared: 'Submit attempt',
    submitSharedText: 'Enter a display name and check your score.',
    displayName: 'Display name',
    loading: 'Loading...',
    checkAnswers: 'Check answers',
    sharedError: 'Could not load shared quiz.',
    anonymous: 'Anonymous'
  },
  pl: {
    badge: 'Historia i notatki',
    title: 'Z zapisanych pytań zrobisz quiz',
    subtitle: 'Notatki i quiz z historii są teraz jedną stroną. Wybierasz pytania, dopisujesz własne notatki i ćwiczysz później.',
    loginTitle: 'Zaloguj się, aby wczytać historię',
    loginSubtitle: 'Użyj tego samego konta co w rozszerzeniu Chrome.',
    password: 'Hasło',
    signIn: 'Zaloguj się',
    loginError: 'Nie udało się zalogować.',
    historyTitle: 'Zapisane pytania',
    historyCount: 'pytań',
    searchPlaceholder: 'Szukaj notatek',
    filterAll: 'Wszystkie',
    filterFavorite: 'Ulubione',
    filterNew: 'Nowe',
    filterLearning: 'Uczę się',
    filterMastered: 'Opanowane',
    selectVisible: 'Zaznacz widoczne',
    startPractice: 'Zacznij quiz z historii',
    emptyTitle: 'Nie ma jeszcze zapisanych pytań',
    emptyText: 'Rozwiąż pytania z włączonym zapisem historii w rozszerzeniu i wróć tutaj.',
    selected: 'Wybrane',
    favorited: 'Ulubione',
    favorite: 'Dodaj do ulubionych',
    answer: 'Odpowiedź',
    explanation: 'Wyjaśnienie',
    noExplanation: 'Brak zapisanego wyjaśnienia.',
    personalNote: 'Twoja notatka',
    notePlaceholder: 'Dodaj, co chcesz zapamiętać...',
    saveNote: 'Zapisz notatkę',
    new: 'Nowe',
    learning: 'Uczę się',
    mastered: 'Opanowane',
    backToNotes: 'Wróć do historii',
    typeAnswer: 'Wpisz odpowiedź',
    checkAnswer: 'Sprawdź odpowiedź',
    nextQuestion: 'Następne pytanie',
    correct: 'Poprawnie',
    incorrect: 'Jeszcze nie',
    resultTitle: 'Quiz zakończony',
    correctAnswers: 'poprawnych odpowiedzi',
    restartPractice: 'Ćwicz ponownie',
    selectAtLeastOne: 'Zaznacz co najmniej jedno pytanie.',
    sharedBadge: 'Udostępniony quiz',
    sharedTitle: 'Udostępniony quiz QuizSolver',
    sharedSubtitle: 'Odpowiedz na pytania i wyślij podejście.',
    submitShared: 'Wyślij podejście',
    submitSharedText: 'Wpisz nazwę i sprawdź wynik.',
    displayName: 'Nazwa',
    loading: 'Ładowanie...',
    checkAnswers: 'Sprawdź odpowiedzi',
    sharedError: 'Nie udało się wczytać quizu.',
    anonymous: 'Anonim'
  }
};
