import { Injectable, inject, signal, computed } from '@angular/core';
import { catchError, of } from 'rxjs';
import { LocalStorageService } from './local-storage.service';
import { Dhis2Service } from './dhis2.service';
import { Patient, PatientFilter } from '../models/patient.model';

@Injectable({ providedIn: 'root' })
export class PatientService {
  private readonly localStore = inject(LocalStorageService);
  private readonly dhis2 = inject(Dhis2Service);

  /** Full in-memory cache of local records; the source of truth for the UI. */
  private readonly _patients = signal<Patient[]>([]);
  readonly patients = this._patients.asReadonly();

  readonly isOnline = signal<boolean>(navigator.onLine);
  readonly isSyncing = signal(false);
  readonly lastPullError = signal<string | null>(null);
  readonly pendingCount = computed(
    () => this._patients().filter((p) => p.syncStatus === 'pending' || p.syncStatus === 'local-only').length
  );

  constructor() {
    window.addEventListener('online', () => this.isOnline.set(true));
    window.addEventListener('offline', () => this.isOnline.set(false));
    this.loadFromLocal();
  }

  async loadFromLocal(): Promise<void> {
    const all = await this.localStore.getAllPatients();
    this._patients.set(all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }

  filtered(filter: PatientFilter): Patient[] {
    return this._patients().filter((p) => {
      if (filter.search) {
        const q = filter.search.toLowerCase();
        const name = `${p.firstName} ${p.lastName}`.toLowerCase();
        if (!name.includes(q) && !(p.phoneNumber ?? '').includes(q)) return false;
      }
      if (filter.onsetYearFrom != null && p.onsetYear < filter.onsetYearFrom) return false;
      if (filter.onsetYearTo != null && p.onsetYear > filter.onsetYearTo) return false;
      if (filter.classification && filter.classification !== 'ALL' && p.classification !== filter.classification)
        return false;
      if (filter.disabilityGrade && filter.disabilityGrade !== 'ALL' && p.disabilityGrade !== filter.disabilityGrade)
        return false;
      if (filter.syncStatus && filter.syncStatus !== 'ALL' && p.syncStatus !== filter.syncStatus) return false;
      return true;
    });
  }

  async getById(id: string): Promise<Patient | undefined> {
    return this.localStore.getPatient(id);
  }

  /** Save locally first (always works offline), then opportunistically push to DHIS2. */
  async save(patient: Patient): Promise<void> {
    const now = new Date().toISOString();
    const toSave: Patient = {
      ...patient,
      updatedAt: now,
      syncStatus: patient.syncStatus === 'synced' ? 'pending' : (patient.syncStatus ?? 'local-only')
    };
    await this.localStore.savePatient(toSave);
    await this.loadFromLocal();

    if (this.isOnline()) {
      this.pushOne(toSave);
    }
  }

  async delete(id: string): Promise<void> {
    await this.localStore.deletePatient(id);
    await this.loadFromLocal();
  }

  /** Push every pending/local-only record to DHIS2. Safe to call repeatedly. */
  async syncAll(): Promise<void> {
    if (!this.isOnline() || this.isSyncing()) return;
    this.isSyncing.set(true);
    const pending = this._patients().filter((p) => p.syncStatus !== 'synced');
    for (const p of pending) {
      await this.pushOne(p);
    }
    await this.localStore.setMeta('lastSyncedAt', new Date().toISOString());
    this.isSyncing.set(false);
  }

  /**
   * Pull the latest patient list from DHIS2 and merge into local storage.
   * Any failure (auth, CORS, missing attribute filter, network) is captured
   * in `lastPullError` instead of being swallowed — check that signal (or
   * the browser console, which logs the raw error from Dhis2Service) if
   * the patient list stays empty after calling this.
   */
  async pullFromServer(): Promise<void> {
    if (!this.isOnline()) {
      this.lastPullError.set('Device is offline — showing local data only.');
      return;
    }
    this.lastPullError.set(null);

    this.dhis2
      .fetchPatients()
      .pipe(
        catchError((err) => {
          const message =
            err?.status === 0
              ? 'Request blocked before reaching the server — likely CORS or a network/DNS issue.'
              : err?.status
                ? `DHIS2 returned ${err.status}: ${err?.error?.message ?? err.message}`
                : 'Unknown error while contacting DHIS2. Check the console.';
          this.lastPullError.set(message);
          console.error('[PatientService] pullFromServer failed:', err);
          return of([] as Patient[]);
        })
      )
      .subscribe(async (remote) => {
        console.info(`[PatientService] pullFromServer received ${remote.length} record(s)`);
        for (const r of remote) {
          const existing = await this.localStore.getPatient(r.id);
          // Don't clobber a record with unsynced local edits.
          console.log('Patient=>', r);
          if (!existing || existing.syncStatus === 'synced') {
            await this.localStore.savePatient(r);
          }
        }
        await this.loadFromLocal();
      });
  }

  private async pushOne(patient: Patient): Promise<void> {
    this.dhis2
      .upsertPatient(patient)
      .pipe(catchError((err) => {
        console.error('[PatientService] pushOne failed:', err);
        return of(null);
      }))
      .subscribe(async (res) => {
        if (res) {
          await this.localStore.savePatient({ ...patient, teiId: res.teiId, syncStatus: 'synced' });
        } else {
          await this.localStore.savePatient({ ...patient, syncStatus: 'error' });
        }
        await this.loadFromLocal();
      });
  }
}
