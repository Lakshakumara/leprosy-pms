import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';

import { ToastModule } from 'primeng/toast';
import { DialogModule } from 'primeng/dialog';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';

import { PatientService } from './core/services/patient.service';
import { AuthService } from './core/services/auth.service';
import { MobileHeaderService } from './core/services/mobile-header.service';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ToastModule,
    DialogModule,
    MenuModule,
    TooltipModule
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  protected readonly auth = inject(AuthService);
  protected readonly patients = inject(PatientService);
  protected readonly mobileHeader = inject(MobileHeaderService);
  private readonly router = inject(Router);

  readonly showAbout = signal(false);
  readonly appBuildDate = '2026-07-31';

  // Format PrimeNG Menu items for mobile header overflow
  readonly overflowItems = computed<MenuItem[]>(() => {
    return this.mobileHeader.visibleOverflow().map(item => ({
      label: item.label,
      icon: item.icon,
      command: () => item.command(),
      disabled: item.disabled
    }));
  });

  // Determines if login view is active
  readonly isLoginRoute = computed(() => {
    return this.router.url.includes('/login');
  });

  syncNow(): void {
    this.patients.pullFromServer();
  }

  logout(): void {
    this.auth.logout();
  }
}



/*import { Component, computed, inject, model, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { filter, map } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import { PatientService } from './core/services/patient.service';
import { AuthService } from './core/services/auth.service';
import { ToastModule } from 'primeng/toast';
import { MobileHeaderService } from './core/services/mobile-header.service';
import { MenuModule } from 'primeng/menu';

import { MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule, ToastModule, DialogModule,  MenuModule, ButtonModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  protected readonly patients = inject(PatientService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly mobileHeader = inject(MobileHeaderService);

   protected readonly overflowItems = computed<MenuItem[]>(() => {
    const cfg = this.mobileHeader.config();
    if (!cfg.overflow?.length) return [];
    return cfg.overflow.map(o => ({
      label: o.label,
      icon: o.icon,
      disabled: o.disabled,
      command: () => o.command()
    }));
  });

  protected readonly showAbout = signal(false);

  protected readonly appBuildDate = '2026';

  protected readonly isLoginRoute = toSignal(
  this.router.events.pipe(
    filter(e => e instanceof NavigationEnd),
    map(e => (e as NavigationEnd).urlAfterRedirects.startsWith('/login'))
  ),
  { initialValue: this.router.url.startsWith('/login') } // FIX: not always true
);

  protected syncNow(): void {
    void this.patients.pullFromServer();
  }

  protected logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}*/