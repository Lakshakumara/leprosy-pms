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

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([dhis2AuthInterceptor])),

    // provideAnimationsAsync() removed - PrimeNG v21 migrated to native CSS
    // animations, and its own migration guide confirms this provider is
    // safe to remove entirely (no replacement needed here).

    // Replaces the old APP_INITIALIZER + factory + deps pattern (deprecated
    // since v19). provideAppInitializer() runs inside an injection context
    // automatically, so inject() works directly instead of a deps array.
    //
    // Restores auth session AND org scope from localStorage synchronously
    // before the router activates any route - both are network-free reads,
    // so this works fully offline. This is what lets a returning user open
    // the PWA with no connectivity and land straight in the app instead of
    // being bounced to the login page.
    //
    // If the device happens to be online at startup, a background refresh
    // of the org scope is kicked off afterwards (fire-and-forget) to pick
    // up any change to the user's facility/district assignment - but this
    // never blocks app startup and silently falls back to the cached scope
    // if it fails (offline, server hiccup, etc).
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
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};




/*
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
import { OrgScopeService } from './core/services/org-scope.service';


function initAuth(auth: AuthService, orgScope: OrgScopeService): () => void {
  return () => {
    auth.restoreSession();
    orgScope.restoreFromCache();

    if (navigator.onLine && auth.isLoggedIn()) {
      orgScope.refreshFromServer().catch((err) => {
        console.warn('[appConfig] Background org scope refresh failed - using cached scope.', err);
      });
    }
  };
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
      deps: [AuthService, OrgScopeService],
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
};*/