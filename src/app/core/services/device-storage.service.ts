import { Injectable } from '@angular/core';
import { STORAGE_KEYS } from '../util/util';

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