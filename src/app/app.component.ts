import { Component, inject, computed } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { filter, map } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import { PatientService } from './core/services/patient.service';
import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  protected readonly patients = inject(PatientService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** True when the current route is /login — hides the app shell. */
  protected readonly isLoginRoute = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(e => (e as NavigationEnd).urlAfterRedirects.startsWith('/login'))
    ),
    { initialValue: true }
  );

  protected syncNow(): void {
    void this.patients.pullFromServer();
  }

  protected logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}