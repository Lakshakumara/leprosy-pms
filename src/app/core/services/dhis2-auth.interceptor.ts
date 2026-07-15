import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';

/**
 * Attaches DHIS2 credentials to outgoing requests aimed at the configured
 * DHIS2 base URL. Prefers a Personal Access Token; falls back to Basic auth
 * for local development against instances without PAT support.
 */
export const dhis2AuthInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.dhis2.baseUrl)) {
    return next(req);
  }

  const { apiToken, username, password } = environment.dhis2;

  if (apiToken) {
    return next(req.clone({ setHeaders: { Authorization: `ApiToken ${apiToken}` } }));
  }

  if (username && password) {
    const encoded = btoa(`${username}:${password}`);
    return next(req.clone({ setHeaders: { Authorization: `Basic ${encoded}` } }));
  }

  return next(req);
};
