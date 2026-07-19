import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DeviceStorageService } from './device-storage.service';
import { STORAGE_KEYS } from '../util/util';

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

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly storage = inject(DeviceStorageService);
  private readonly base = environment.dhis2.baseUrl;

  readonly currentUser = signal<Dhis2UserInfo | null>(null);
  readonly checkedSession = signal(false);
  readonly authMode = signal<AuthMode>(null);
  readonly isLoggedIn = computed(() => this.currentUser() !== null);

  getSavedBasicCreds(): SavedBasicCreds | null {
    return this.storage.getJSON<SavedBasicCreds>(STORAGE_KEYS.BASIC_CREDS);
  }

  getSavedApiToken(): string | null {
    return this.storage.getString(STORAGE_KEYS.API_TOKEN);
  }

  restoreSession(): void {
    try {
      const mode = this.storage.getString(STORAGE_KEYS.AUTH_MODE) as AuthMode;
      if (!mode) return;

      if (mode === 'token' && !this.storage.getString(STORAGE_KEYS.API_TOKEN)) return;
      if (mode === 'basic') {
        const creds = this.getSavedBasicCreds();
        if (!creds || !creds.password) return;
      }

      const user = this.storage.getJSON<Dhis2UserInfo>(STORAGE_KEYS.USER_DATA);
      if (user) {
        console.log('current user', user)
        this.currentUser.set(user);
        this.authMode.set(mode);
      }
    } catch {
      this.clearSession();
    } finally {
      this.checkedSession.set(true);
    }
  }

  async loginWithToken(token: string): Promise<Dhis2UserInfo> {
    this.storage.setString(STORAGE_KEYS.API_TOKEN, token.trim());
    this.storage.setString(STORAGE_KEYS.AUTH_MODE, 'token');

    try {
      const user = await this.fetchCurrentUser();
      this.currentUser.set(user);
      this.authMode.set('token');
      return user;
    } catch (err) {
      this.clearSession();
      throw err;
    }
  }

  async loginWithPassword(username: string, password: string, remember: boolean): Promise<Dhis2UserInfo> {
    this.storage.setJSON<SavedBasicCreds>(STORAGE_KEYS.BASIC_CREDS, { username: username.trim(), password });
    this.storage.setString(STORAGE_KEYS.AUTH_MODE, 'basic');

    try {
      const user = await this.fetchCurrentUser();
      this.currentUser.set(user);
      this.authMode.set('basic');

      if (!remember) {
        this.storage.setJSON<SavedBasicCreds>(STORAGE_KEYS.BASIC_CREDS, { username: username.trim(), password: '' });
      }
      return user;
    } catch (err) {
      this.clearSession();
      throw err;
    }
  }

  logout(): void {
    this.clearSession();
  }

  private async fetchCurrentUser(): Promise<Dhis2UserInfo> {
    const user = await firstValueFrom(
      this.http.get<Dhis2UserInfo>(`${this.base}/me`, {
        params: { fields: 'id,username,firstName,surname,displayName,organisationUnits[id,name,level]' }
      })
    );
    this.storage.setJSON(STORAGE_KEYS.USER_DATA, user);
    return user;
  }

  private clearSession(): void {
    this.storage.remove(STORAGE_KEYS.AUTH_MODE);
    this.storage.remove(STORAGE_KEYS.API_TOKEN);
    this.storage.remove(STORAGE_KEYS.BASIC_CREDS);
    this.storage.remove(STORAGE_KEYS.USER_DATA);
    this.currentUser.set(null);
    this.authMode.set(null);
    this.checkedSession.set(true);
  }
}