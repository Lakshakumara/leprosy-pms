import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { OrgScopeService } from '../../core/services/org-scope.service';

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
  private scope = inject(OrgScopeService)

  username = '';
  password = '';
  showPassword = false;
  showErrors = false;
  loading = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    // If already logged in, skip straight to dashboard
    /*if (this.auth.isLoggedIn()) {
      this.scope.loadCurrentUserScope()
      void this.router.navigate(['/dashboard'], { replaceUrl: true });
    }*/
  }

  async submit() {
    if (!this.username || !this.password) {
      this.error.set('Please enter both username and password.');
      return;
    }

    this.showErrors = true;
    if (!this.username || !this.password) return;

    this.loading.set(true);
    this.error.set(null);

    try {
      await this.auth.loginWithPassword(this.username, this.password, true);
      void this.router.navigate(['/dashboard'], { replaceUrl: true });
    } catch (err: any) {
      this.error.set(err?.message ?? 'Login failed. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
