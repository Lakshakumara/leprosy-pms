import { Injectable } from '@angular/core';
import { STORAGE_KEYS } from '../util/util';

/**
 * Single point of contact for browser localStorage - small session-level
 * data only (auth tokens, cached user profile, org scope, UI preferences).
 *
 * This is deliberately separate from PatientStoreService (IndexedDB), which
 * holds the bulk patient dataset. Rule of thumb: if it's a handful of small
 * values needed synchronously at startup (auth state, org scope) -> here.
 * If it's a dataset that could grow into hundreds/thousands of structured
 * records (patients) -> IndexedDB via PatientStoreService instead.
 *
 * Centralizing this also gives one place to add things later without
 * touching every service that reads/writes storage: e.g. encrypting
 * values at rest, namespacing keys per environment, or swapping the
 * underlying mechanism entirely.
 */
@Injectable({ providedIn: 'root' })
export class DeviceStorageService {
  getString(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setString(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.error(`[DeviceStorageService] Failed to write "${key}":`, err);
    }
  }

  getJSON<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  setJSON<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.error(`[DeviceStorageService] Failed to write "${key}":`, err);
    }
  }

  remove(key: string): void {
    localStorage.removeItem(key);
  }

  getFacilities():any{
    return this.getJSON<any>(STORAGE_KEYS.USER_DATA).organisationUnits;
  }
}