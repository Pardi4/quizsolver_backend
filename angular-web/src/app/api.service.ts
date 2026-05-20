import { isPlatformBrowser } from '@angular/common';
import { Inject, Injectable, PLATFORM_ID, signal } from '@angular/core';

export interface ApiResult {
  success?: boolean;
  error?: string;
  token?: string;
  user?: any;
  credits?: number;
  checkoutUrl?: string;
  auth?: boolean;
  [key: string]: any;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly currentUser = signal<any | null>(null);
  readonly token = signal<string | null>(null);
  readonly isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      this.token.set(localStorage.getItem('qs_token'));
    }
  }

  async request(endpoint: string, options: RequestInit = {}): Promise<ApiResult> {
    if (!this.isBrowser) return { success: false };
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token() ? { Authorization: `Bearer ${this.token()}` } : {}),
      ...(options.headers || {})
    };

    try {
      const response = await fetch(endpoint, { ...options, headers });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        this.clearSession();
        return { success: false, auth: true, error: data.error || 'Session expired.' };
      }
      if (!response.ok) return { success: false, error: data.error || `Error: ${response.status}` };
      return data;
    } catch {
      return { success: false, error: 'Network error.' };
    }
  }

  async restoreSession(): Promise<void> {
    if (!this.token()) return;
    const result = await this.request('/api/auth/me');
    if (result.success && result.user) this.currentUser.set(result.user);
    else this.clearSession();
  }

  setSession(token: string, user: any): void {
    this.token.set(token);
    this.currentUser.set(user);
    if (this.isBrowser) localStorage.setItem('qs_token', token);
  }

  clearSession(): void {
    this.token.set(null);
    this.currentUser.set(null);
    if (this.isBrowser) localStorage.removeItem('qs_token');
  }
}
