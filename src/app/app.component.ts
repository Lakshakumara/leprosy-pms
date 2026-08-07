import { Component, signal, computed, inject, HostListener } from '@angular/core';
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
import { DrawerModule } from 'primeng/drawer';
import { CryptoService } from './core/services/crypto.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ToastModule,
    DialogModule,
    MenuModule,
    DrawerModule,
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

@HostListener('window:beforeunload')
lock() {
  inject(CryptoService).lock();
}


  readonly showAbout = signal(false);
  showMobileMenu = signal(false)
  closeMobileMenu() {
    this.showMobileMenu.set(false);
  }
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
    this.patients.pullFromServer(2026);
  }

  logout(): void {
    this.auth.logout();
  }
}