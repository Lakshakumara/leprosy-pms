import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

// ── Storage keys ──────────────────────────────────────────────────────────────
const KEY_AUTH_MODE   = 'lpms_auth_mode';   // 'token' | 'basic'
const KEY_API_TOKEN   = 'lpms_api_token';   // stored when user logs in with PAT
const KEY_BASIC_CREDS = 'lpms_basic_creds'; // { username, password } stored if remember-me
const KEY_USER_DATA   = 'lpms_user';        // Dhis2User JSON after /me call

export type AuthMode = 'token' | 'basic' | null;

export interface Dhis2UserInfo {
  id: string;
  username: string;
  firstName: string;
  surname: string;
  displayName?: string;
  organisationUnits?: { id: string; name: string; level?: number }[];
}

export interface SavedBasicCreds {
  username: string;
  password: string;
}

/**
 * Handles authentication against a real DHIS2 instance.
 *
 * Supports two login modes:
 *  1. API Token  (d2pat_…) — stored permanently; never prompts again after first use.
 *  2. Username + Password  — optionally stored with "Remember me"; auto-fills next visit.
 *
 * After a successful login, the user's /me profile is fetched and cached in localStorage
 * so the sidebar can show the user's name and the app can scope data to their org units.
 *
 * The HTTP interceptor (`dhis2-auth.interceptor.ts`) reads credentials from this service
 * (via localStorage) at request time — no more hardcoded environment values.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.dhis2.baseUrl;

  readonly currentUser = signal<Dhis2UserInfo | null>(null);
  readonly checkedSession = signal(false);
  readonly authMode = signal<AuthMode>(null);

  readonly isLoggedIn = computed(() => this.currentUser() !== null);

  // ── Saved credentials helpers (used by LoginComponent to pre-fill fields) ──

  getSavedBasicCreds(): SavedBasicCreds | null {
    try {
      const raw = localStorage.getItem(KEY_BASIC_CREDS);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  getSavedApiToken(): string | null {
    return localStorage.getItem(KEY_API_TOKEN);
  }

  // ── Session restore (called by APP_INITIALIZER before routing) ────────────

  /**
   * Reads localStorage on startup to see if there's a saved auth session.
   * If found, restores the user object from cache (no HTTP call needed here —
   * the user data was already fetched and stored at login time).
   */
  restoreSession(): void {
    try {
      const mode = localStorage.getItem(KEY_AUTH_MODE) as AuthMode;
      if (!mode) return;

      // Check we actually have credentials for the reported mode
      if (mode === 'token' && !localStorage.getItem(KEY_API_TOKEN)) return;
      if (mode === 'basic' && !localStorage.getItem(KEY_BASIC_CREDS)) return;

      // Restore cached user profile
      const raw = localStorage.getItem(KEY_USER_DATA);
      if (raw) {
        const user: Dhis2UserInfo = JSON.parse(raw);
        this.currentUser.set(user);
        this.authMode.set(mode);
      }
    } catch {
      this.clearSession();
    } finally {
      this.checkedSession.set(true);
    }
  }

  // ── Login methods ─────────────────────────────────────────────────────────

  /**
   * Login with a DHIS2 Personal Access Token.
   * Token is stored permanently — next visit auto-redirects without login.
   */
  async loginWithToken(token: string): Promise<Dhis2UserInfo> {
    // Save token first so the interceptor picks it up for the /me call
    localStorage.setItem(KEY_API_TOKEN, token.trim());
    localStorage.setItem(KEY_AUTH_MODE, 'token');

    try {
      const user = await this.fetchCurrentUser();
      this.currentUser.set(user);
      this.authMode.set('token');
      return user;
    } catch (err) {
      // Invalid token — roll back
      this.clearSession();
      throw err;
    }
  }

  /**
   * Login with DHIS2 username + password (Basic auth).
   * If `remember` is true, credentials are stored in localStorage
   * and will be auto-loaded on next visit.
   */
  async loginWithPassword(
    username: string,
    password: string,
    remember: boolean
  ): Promise<Dhis2UserInfo> {
    // Store temporarily so the interceptor can attach them to the /me call
    const creds: SavedBasicCreds = { username: username.trim(), password };
    localStorage.setItem(KEY_BASIC_CREDS, JSON.stringify(creds));
    localStorage.setItem(KEY_AUTH_MODE, 'basic');

    try {
      const user = await this.fetchCurrentUser();
      this.currentUser.set(user);
      this.authMode.set('basic');
console.log('user',user)
localStorage.setItem(KEY_BASIC_CREDS, JSON.stringify({ username: username.trim(), password: '' }));
      
      if (!remember) {
        // Remove stored password after successful login (keep username for UX)
        localStorage.setItem(KEY_BASIC_CREDS, JSON.stringify({ username: username.trim(), password: '' }));
      }
      return user;
    } catch (err) {
      // Bad credentials — clean up
      this.clearSession();
      throw err;
    }
  }

  /** Clears all auth state from memory and localStorage. */
  logout(): void {
    this.clearSession();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Calls DHIS2 /me to get the current user's profile.
   * The interceptor attaches the correct auth header based on what's in localStorage.
   */
  private async fetchCurrentUser(): Promise<Dhis2UserInfo> {
    const user = await firstValueFrom(
      this.http.get<Dhis2UserInfo>(`${this.base}/me`, {
        params: {
          fields: 'id,username,firstName,surname,displayName,organisationUnits[id,name,level]'
        }
      })
    );
    // Cache user profile for session restore
    localStorage.setItem(KEY_USER_DATA, JSON.stringify(user));
    return user;
  }

  private clearSession(): void {
    localStorage.removeItem(KEY_AUTH_MODE);
    localStorage.removeItem(KEY_API_TOKEN);
    localStorage.removeItem(KEY_BASIC_CREDS);
    //localStorage.removeItem(KEY_USER_DATA);
    this.currentUser.set(null);
    this.authMode.set(null);
    this.checkedSession.set(true);
  }
}
