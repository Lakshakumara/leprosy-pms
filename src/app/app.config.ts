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
import { MessageService, ConfirmationService } from 'primeng/api';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([dhis2AuthInterceptor])),
    
    provideAppInitializer(() => {
      const auth = inject(AuthService);
      const orgScope = inject(OrgScopeService);

      auth.restoreSession();
      orgScope.restoreFromCache();

      if (navigator.onLine && auth.isLoggedIn()) {
        orgScope.refreshFromServer().catch((err) => {
          console.warn('[appConfig] Background org scope refresh failed - using cached scope.', err);
        });
      }
    }),

    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: false, // clinical UI: fixed light theme for legibility
          cssLayer: { name: 'primeng', order: 'primeng' }
        }
      }
    }), 
    ConfirmationService,// ← ADD THIS
    MessageService,      // ← ADD THIS
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};