import { ApplicationConfig, provideZoneChangeDetection, isDevMode, inject, provideAppInitializer } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

import { routes } from './app.routes';
import { dhis2AuthInterceptor } from './core/services/dhis2-auth.interceptor';
import { AuthService } from './core/services/auth.service';
import { OrgScopeService } from './core/services/org-scope.service';
import { CryptoService } from './core/services/crypto.service'; // <-- ADD
import { MessageService, ConfirmationService } from 'primeng/api';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([dhis2AuthInterceptor])),

    // 1st initializer - crypto (MUST be first)
    provideAppInitializer(() => {
      const crypto = inject(CryptoService);
      return crypto.ensureReady(); // waits for key, works offline
    }),

    // 2nd initializer - your existing auth restore
    provideAppInitializer(() => {
      const auth = inject(AuthService);
      const orgScope = inject(OrgScopeService);
      auth.restoreSession();
      orgScope.restoreFromCache();
      if (navigator.onLine && auth.isLoggedIn()) {
        orgScope.refreshFromServer().catch(err => console.warn(err));
      }
    }),

    providePrimeNG({
      theme: { preset: Aura, options: { darkModeSelector: false, cssLayer: { name: 'primeng', order: 'primeng' } } }
    }),
    ConfirmationService,
    MessageService,
    provideServiceWorker('ngsw-worker.js', {
      enabled:!isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};