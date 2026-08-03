import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { inject } from '@angular/core';
import { STORAGE_KEYS } from '../util/util';
import { DeviceStorageService } from './device-storage.service';

export const dhis2AuthInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.dhis2.baseUrl)) {
    return next(req);
  }

  const storage = inject(DeviceStorageService);

  const apiToken = storage.getString(STORAGE_KEYS.API_TOKEN);

  if (apiToken) {
    return next(req.clone({ setHeaders: { Authorization: `ApiToken ${apiToken}` } }));
  }

  const creds = storage.getJSON<{ username: string; password: string }>(STORAGE_KEYS.BASIC_CREDS);
  if (creds?.username && creds?.password) {
    const encoded = btoa(`${creds?.username}:${creds?.password}`);
    return next(req.clone({ setHeaders: { Authorization: `Basic ${encoded}` } }));
  }

  console.warn('[dhis2AuthInterceptor] No creds found in storage for', req.url);
  return next(req);
};
