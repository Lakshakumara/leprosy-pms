import { ApplicationConfig, provideZoneChangeDetection, isDevMode, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideServiceWorker } from '@angular/service-worker';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';

import { routes } from './app.routes';
import { dhis2AuthInterceptor } from './core/services/dhis2-auth.interceptor';
import { AuthService } from './core/services/auth.service';

/**
 * Restore the auth session from localStorage synchronously before the router
 * activates any route. This ensures the auth guard sees the correct state on
 * the very first navigation (e.g., deep-linking to /dashboard while logged in).
 */
function initAuth(auth: AuthService): () => void {
  return () => auth.restoreSession();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([dhis2AuthInterceptor])),
    provideAnimationsAsync(),
    {
      provide: APP_INITIALIZER,
      useFactory: initAuth,
      deps: [AuthService],
      multi: true,
    },
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: false, // clinical UI: fixed light theme for legibility
          cssLayer: { name: 'primeng', order: 'primeng' }
        }
      }
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};
