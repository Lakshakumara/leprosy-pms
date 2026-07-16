import { Injectable } from '@angular/core';
import { createStore, entries, get, set, del } from 'idb-keyval';
import { Patient } from '../delete/patient.model';

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
  private readonly store    = createStore('leprosy-pms-db', 'patients');
  private readonly metaStore = createStore('leprosy-pms-db', 'meta');

  async getAllPatients(): Promise<Patient[]> {
    const all = await entries<string, Patient>(this.store);
    return all.map(([, value]) => value);
  }

  async getPatient(id: string): Promise<Patient | undefined> {
    return get<Patient>(id, this.store);
  }

  async savePatient(patient: Patient): Promise<void> {
    await set(patient.id, patient, this.store);
  }

  async savePatients(patients: Patient[]): Promise<void> {
    await Promise.all(patients.map(p => set(p.id, p, this.store)));
  }

  async deletePatient(id: string): Promise<void> {
    await del(id, this.store);
  }

  /** Simple key/value area for sync bookkeeping (e.g. last sync timestamp). */
  async getMeta<T>(key: string): Promise<T | undefined> {
    return get<T>(key, this.metaStore);
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    console.log(key, value)
    await set(key, value, this.metaStore);
  }

  /**
   * Returns sorted distinct non-empty string values for the given field across
   * all locally stored patients. Used to populate filter dropdowns
   * (MOH area, PHI area, GN Division) without a live DHIS2 call.
   */
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
}
