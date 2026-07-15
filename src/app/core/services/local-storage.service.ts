import { Injectable } from '@angular/core';
import { createStore, entries, get, set, del } from 'idb-keyval';
import { Patient } from '../models/patient.model';

/**
 * Offline-first persistence layer.
 *
 * Patient records live in IndexedDB (via idb-keyval), so the app is fully
 * usable without network access. The PatientService is responsible for
 * reconciling this local store with DHIS2 when connectivity returns.
 *
 * NOTE ON PRIVACY: this stores identifiable health data (name, diagnosis
 * classification, location) on-device. For production use on shared or
 * loaned devices, wrap this store with an encryption-at-rest layer (e.g.
 * encrypt values with a passphrase-derived key before calling idb-keyval)
 * and/or enforce an app-level PIN/biometric lock before rendering patient
 * data.
 */
@Injectable({ providedIn: 'root' })
export class LocalStorageService {
  private readonly store = createStore('leprosy-pms-db', 'patients');
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

  async deletePatient(id: string): Promise<void> {
    await del(id, this.store);
  }

  /** Simple key/value area for sync bookkeeping (e.g. last sync timestamp). */
  async getMeta<T>(key: string): Promise<T | undefined> {
    return get<T>(key, this.metaStore);
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    await set(key, value, this.metaStore);
  }
}
