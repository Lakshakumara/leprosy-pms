import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { OrgScopeService } from '../../core/services/org-scope.service';

type LoginMode = 'password' | 'token';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private scope = inject(OrgScopeService);

  mode = signal<LoginMode>('password');

  username = '';
  password = '';
  apiToken = '';
  rememberMe = true;

  showPassword = false;
  showErrors = false;
  loading = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    // Pre-fill username if a previous "remember me" login left one behind
    const saved = this.auth.getSavedBasicCreds();
    console.log('getSavedBasicCreds', saved)
    if (saved?.username) this.username = saved.username;

    const savedToken = this.auth.getSavedApiToken();
    if (savedToken) this.apiToken = savedToken;

    // If a session was already restored from cache (offline-capable, no
    // network needed here), skip straight past the login page.
    if (this.auth.isLoggedIn()) {
      this.goToDashboard();
    }
  }

  setMode(mode: LoginMode): void {
    this.mode.set(mode);
    this.error.set(null);
    this.showErrors = false;
  }

  async submit(): Promise<void> {
    this.showErrors = true;
    this.error.set(null);

    if (this.mode() === 'password') {
      if (!this.username || !this.password) {
        this.error.set('Please enter both username and password.');
        return;
      }
    } else {
      if (!this.apiToken) {
        this.error.set('Please enter your DHIS2 access token.');
        return;
      }
    }

    this.loading.set(true);

    try {
      if (this.mode() === 'password') {
        await this.auth.loginWithPassword(this.username, this.password, this.rememberMe);
      } else {
        await this.auth.loginWithToken(this.apiToken);
      }

      // Org scope requires connectivity - login itself just succeeded, so
      // we're online right now. loadCurrentUserScope() caches the result
      // for offline use on future app opens, and falls back gracefully
      // (rather than blocking login) if this particular call hiccups.
      await this.scope.loadCurrentUserScope();

      this.goToDashboard();
    } catch (err: any) {
      console.log('login error', err)
      this.error.set('Login failed. Please check your credentials and try again.');
    } finally {
      this.loading.set(false);
    }
  }

  private goToDashboard(): void {
    void this.router.navigate(['/dashboard'], { replaceUrl: true });
  }
}