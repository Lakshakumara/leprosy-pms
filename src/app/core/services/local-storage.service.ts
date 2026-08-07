import { inject, Injectable } from '@angular/core';
import { createStore, entries, get, set, del } from 'idb-keyval';
import { Patient } from './patient.model';
import { CryptoService } from './crypto.service';
/**
 * Offline-first persistence layer using IndexedDB (idb-keyval).
 *
 * Patient records are stored locally so the app is fully usable offline.
 * PatientService is responsible for syncing with DHIS2 when online.
 *
 * NOTE ON PRIVACY: stores identifiable health data on-device. For production
 * use on shared devices, wrap with an encryption-at-rest layer and enforce
 * an app-level PIN/biometric lock before rendering patient data.
 */
@Injectable({ providedIn: 'root' })
export class LocalStorageService {
  private crypto = inject(CryptoService);
  private readonly store = createStore('leprosy-pms-db', 'patients');
  private readonly metaStore = createStore('leprosy-pms-db', 'meta');
  constructor() {
    // ensure both stores exist on first run
    this.initDb();
  }

  private initDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('leprosy-pms-db', 2);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('patients')) {
          db.createObjectStore('patients');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
      };

      request.onsuccess = () => {
        request.result.close(); // close to allow idb-keyval to use it
        resolve();
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => console.warn('DB upgrade blocked, close other tabs');
    });
  }

   async getAllPatients(): Promise<Patient[]> {
    if (!this.crypto.isUnlocked()) throw new Error('App locked');
    const all = await entries<string, string>(this.store); // now string = encrypted
    const patients: Patient[] = [];
    for (const [, encValue] of all) {
      try {
        const p = await this.crypto.decrypt<Patient>(encValue);
        patients.push(p);
      } catch {}
    }
    return patients;
  }

  async savePatient(patient: Patient): Promise<void> {
    if (!this.crypto.isUnlocked()) throw new Error('App locked');
    const enc = await this.crypto.encrypt(patient);
    await set(patient.id, enc, this.store);
  }

  async savePatients(patients: Patient[]): Promise<void> {
    for (const p of patients) await this.savePatient(p);
  }

  async getPatient(id: string): Promise<Patient | undefined> {
    return get<Patient>(id, this.store);
  }


  async deletePatient(id: string): Promise<void> {
    await del(id, this.store);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return get<T>(key, this.metaStore);
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    await set(key, value, this.metaStore);
  }

  async getDistinctValues(field: keyof Patient): Promise<string[]> {
    const all = await this.getAllPatients();
    const set_ = new Set<string>();
    for (const p of all) {
      const v = p[field];
      if (typeof v === 'string' && v.trim() !== '') {
        set_.add(v.trim());
      }
    }
    return [...set_].sort((a, b) => a.localeCompare(b));
  }
  async getYears(top: number): Promise<string[]> {
    const all = await this.getAllPatients();
    const set_ = new Set<string>();
    for (const p of all) {
      let year = '' + new Date().getFullYear()
      if (p.enrolledAt) {
        const extractedYear = p.enrolledAt.slice(0, 4);
        if (extractedYear && !isNaN(Number(extractedYear))) {
          year = extractedYear;
          set_.add(extractedYear.trim());
        }
      }
    }
    const sorted = [...set_].sort((a, b) => b.localeCompare(a));

    // top 5, if less than 5 return all
    return sorted.slice(0, top);
  }
}
