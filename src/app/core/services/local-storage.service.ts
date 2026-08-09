import { inject, Injectable } from '@angular/core';
import { createStore, entries, get, set, del } from 'idb-keyval';
import { Patient } from './patient.model';
import { CryptoService } from './crypto.service';

@Injectable({ providedIn: 'root' })
export class LocalStorageService {
  private crypto = inject(CryptoService);
  private readonly store = createStore('leprosy-pms-db', 'patients');
  private readonly metaStore = createStore('leprosy-pms-db', 'meta');

  constructor() { this.initDb(); }

  private initDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('leprosy-pms-db', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('patients')) db.createObjectStore('patients');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllPatients(): Promise<Patient[]> {
    await this.crypto.ensureReady(); // FIX: auto wait
    const all = await entries(this.store);
    const patients: Patient[] = [];
    for (const [, encValue] of all) {
      try {
        if (typeof encValue === 'string') {
          const p = await this.crypto.decrypt<Patient>(encValue as string);
          patients.push(p);
        } else {
          // migration: old plain data
          patients.push(encValue as any as Patient);
        }
      } catch {}
    }
    return patients;
  }

  async getPatient(id: string): Promise<Patient | undefined> {
    await this.crypto.ensureReady();
    const enc = await get(id, this.store) as string | undefined;
    if (!enc) return undefined;
    if (typeof enc!== 'string') return enc as any as Patient; // old plain
    try { return await this.crypto.decrypt<Patient>(enc); }
    catch { return undefined; }
  }

  async savePatient(patient: Patient): Promise<void> {
    await this.crypto.ensureReady();
    const enc = await this.crypto.encrypt(patient);
    await set(patient.id, enc, this.store);
  }

  async savePatients(patients: Patient[]): Promise<void> {
    await this.crypto.ensureReady();
    // parallel faster for 255 patients
    await Promise.all(patients.map(p => this.savePatient(p)));
  }

  async deletePatient(id: string): Promise<void> { await del(id, this.store); }
  async getMeta<T>(key: string): Promise<T | undefined> { return get<T>(key, this.metaStore); }
  async setMeta<T>(key: string, value: T): Promise<void> { await set(key, value, this.metaStore); }

  async getDistinctValues(field: keyof Patient): Promise<string[]> {
    const all = await this.getAllPatients();
    return [...new Set(all.map(p => p[field]).filter(v => typeof v === 'string' && v.trim()!== '') as string[])].sort();
  }

  async getYears(top: number): Promise<string[]> {
    const all = await this.getAllPatients();
    const set_ = new Set<string>();
    for (const p of all) if (p.enrolledAt?.slice(0,4)) set_.add(p.enrolledAt.slice(0,4));
    return [...set_].sort((a,b) => b.localeCompare(a)).slice(0, top);
  }
}