import { Routes } from '@angular/router';
import { AdminComponent } from './pages/admin.component';
import { DashboardComponent } from './pages/dashboard.component';
import { HomeComponent } from './pages/home.component';
import { PlatformComponent } from './pages/platform.component';
import { PrivacyComponent } from './pages/privacy.component';
import { QuizComponent } from './pages/quiz.component';
import { StatusPageComponent } from './pages/status-pages.component';

export const routes: Routes = [
  { path: '', component: HomeComponent, data: { locale: 'en' } },
  { path: 'pl', component: HomeComponent, data: { locale: 'pl' } },
  { path: 'dashboard', component: DashboardComponent, data: { locale: 'en' } },
  { path: 'admin', component: AdminComponent },
  { path: 'pl/dashboard', component: DashboardComponent, data: { locale: 'pl' } },
  { path: 'quiz', component: QuizComponent, data: { locale: 'en' } },
  { path: 'pl/quiz', component: QuizComponent, data: { locale: 'pl' } },
  { path: 'privacy', component: PrivacyComponent, data: { locale: 'en' } },
  { path: 'pl/privacy', component: PrivacyComponent, data: { locale: 'pl' } },
  { path: 'success', component: StatusPageComponent, data: { locale: 'en', pageKey: 'success' } },
  { path: 'pl/success', component: StatusPageComponent, data: { locale: 'pl', pageKey: 'success' } },
  { path: '404', component: StatusPageComponent, data: { locale: 'en', pageKey: 'notFound' } },
  { path: 'pl/404', component: StatusPageComponent, data: { locale: 'pl', pageKey: 'notFound' } },
  { path: 'quiz-solver-ai', component: PlatformComponent, data: { locale: 'en', pageKey: 'quizSolverAi' } },
  { path: 'pl/quiz-solver-ai', component: PlatformComponent, data: { locale: 'pl', pageKey: 'quizSolverAi' } },
  { path: 'testportal-quiz-solver', component: PlatformComponent, data: { locale: 'en', pageKey: 'testportal' } },
  { path: 'pl/testportal-quiz-solver', component: PlatformComponent, data: { locale: 'pl', pageKey: 'testportal' } },
  { path: 'moodle-quiz-solver', component: PlatformComponent, data: { locale: 'en', pageKey: 'moodle' } },
  { path: 'pl/moodle-quiz-solver', component: PlatformComponent, data: { locale: 'pl', pageKey: 'moodle' } },
  { path: 'canvas-quiz-solver', component: PlatformComponent, data: { locale: 'en', pageKey: 'canvas' } },
  { path: 'pl/canvas-quiz-solver', component: PlatformComponent, data: { locale: 'pl', pageKey: 'canvas' } },
  { path: 'google-forms-quiz-solver', component: PlatformComponent, data: { locale: 'en', pageKey: 'googleForms' } },
  { path: 'pl/google-forms-quiz-solver', component: PlatformComponent, data: { locale: 'pl', pageKey: 'googleForms' } },
  { path: 'microsoft-forms-quiz-solver', component: PlatformComponent, data: { locale: 'en', pageKey: 'microsoftForms' } },
  { path: 'pl/microsoft-forms-quiz-solver', component: PlatformComponent, data: { locale: 'pl', pageKey: 'microsoftForms' } },
  { path: 'blackboard-quiz-solver', component: PlatformComponent, data: { locale: 'en', pageKey: 'blackboard' } },
  { path: 'pl/blackboard-quiz-solver', component: PlatformComponent, data: { locale: 'pl', pageKey: 'blackboard' } },
  { path: 'quizlet-solver', component: PlatformComponent, data: { locale: 'en', pageKey: 'quizlet' } },
  { path: 'pl/quizlet-solver', component: PlatformComponent, data: { locale: 'pl', pageKey: 'quizlet' } },
  { path: 'socrative-quiz-solver', component: PlatformComponent, data: { locale: 'en', pageKey: 'socrative' } },
  { path: 'pl/socrative-quiz-solver', component: PlatformComponent, data: { locale: 'pl', pageKey: 'socrative' } },
  { path: 'kahoot-ai-bot', component: PlatformComponent, data: { locale: 'en', pageKey: 'kahoot' } },
  { path: 'pl/kahoot-ai-bot', component: PlatformComponent, data: { locale: 'pl', pageKey: 'kahoot' } },
  { path: 'quizizz-solver', component: PlatformComponent, data: { locale: 'en', pageKey: 'quizizz' } },
  { path: 'pl/quizizz-solver', component: PlatformComponent, data: { locale: 'pl', pageKey: 'quizizz' } },
  { path: '**', component: StatusPageComponent, data: { locale: 'en', pageKey: 'notFound' } }
];
