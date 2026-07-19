import { Injectable, inject, signal, computed } from '@angular/core';
import { catchError, of } from 'rxjs';
import { LocalStorageService } from './local-storage.service';
import { Dhis2Service } from './dhis2.service';
import { Patient, PatientFilter } from './patient.model';

@Injectable({ providedIn: 'root' })
export class PatientService {
  private readonly localStorage = inject(LocalStorageService);
  private readonly dhis2 = inject(Dhis2Service);
  
  /** Full in-memory cache of local records; source of truth for the UI. */
  private readonly _patients = signal<Patient[]>([]);
  readonly patients = this._patients.asReadonly();
  readonly isOnline = signal<boolean>(navigator.onLine);
  readonly isSyncing = signal(false);
  readonly lastPullError = signal<string | null>(null);

  readonly lastSyncedAt = signal<string | null>(null);

  get districtPatients() {
    return  this.patients().filter(p => p.patientDistrict === 'Ratnapura')
  };

  constructor() {
    window.addEventListener('online', () => this.isOnline.set(true));
    window.addEventListener('offline', () => this.isOnline.set(false));
    this.loadFromLocal();
  }
  // ── Load from IndexedDB ────────────────────────────────────────────────────
  async loadFromLocal(): Promise<void> {
    const all = await this.localStorage.getAllPatients();
    this._patients.set(
      all.sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt))
    );
  }
  // ── Filter ─────────────────────────────────────────────────────────────────
  filtered(filter: PatientFilter): Patient[] {
    const ci = (s: string) => s.toLowerCase();
    return this._patients().filter(p => {
      // Free-text search: name, ALC#, NIC
      if (filter.search) {
        const q = ci(filter.search);
        if (
          !ci(p.patientName).includes(q) &&
          !ci(p.alcNum).includes(q) &&
          !ci(p.nicNum).includes(q)
        ) return false;
      }
      // Exact ALC number
      if (filter.alcNum && !ci(p.alcNum).includes(ci(filter.alcNum))) return false;
      // Classification (MB / PB)
      if (filter.classification && filter.classification !== 'ALL') {
        if (ci(p.treatmentClassification) !== ci(filter.classification)) return false;
      }
      // Hospital (org unit)
      if (filter.orgUnitId && filter.orgUnitId !== 'ALL') {
        if (p.orgUnitId !== filter.orgUnitId) return false;
      }
      // MOH area (contains)
      if (filter.mohArea && filter.mohArea !== 'ALL') {
        if (!ci(p.patientMohArea).includes(ci(filter.mohArea))) return false;
      }
      // PHI area (contains)
      if (filter.phiArea && filter.phiArea !== 'ALL') {
        if (!ci(p.patientPhiArea).includes(ci(filter.phiArea))) return false;
      }
      // GN Division (contains)
      if (filter.gnDivision && filter.gnDivision !== 'ALL') {
        if (!ci(p.patientGnDivision).includes(ci(filter.gnDivision))) return false;
      }
      // Enrolled date range
      if (filter.enrolledFrom && p.enrolledAt < filter.enrolledFrom) return false;
      if (filter.enrolledTo && p.enrolledAt > filter.enrolledTo) return false;
      return true;
    })
      // Mandatory sort: newest enrolled patient first
      .sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt));
  }

  async getById(id: string): Promise<Patient | undefined> {
    return this.localStorage.getPatient(id);
  }

  /**
   * Pull all patients from DHIS2 Tracker API and save to IndexedDB.
   * Existing local-only records are preserved; synced records are overwritten
   * with fresh DHIS2 data.
   */
  async pullFromServer(): Promise<void> {
    if (!this.isOnline()) {
      this.lastPullError.set('Device is offline — showing local data only.');
      return;
    }

    if (this.isSyncing()) return;
    this.lastPullError.set(null);
    this.isSyncing.set(true);
    this.dhis2
      //.fetchPatients()
      .fetchPatientsByLivingDistrictForYears([2026])
      .pipe(
        catchError(err => {
          const message =
            err?.status === 0
              ? 'Request blocked before reaching the server — likely CORS or network/DNS issue.'
              : err?.status
                ? `DHIS2 returned ${err.status}: ${err?.error?.message ?? err.message}`
                : 'Unknown error while contacting DHIS2. Check the browser console.';
          this.lastPullError.set(message);
          this.isSyncing.set(false);
          console.error('[PatientService] pullFromServer failed:', err);
          return of([] as Patient[]);
        })
      )
      .subscribe(async (remote) => {
        if (remote.length === 0) {
          this.isSyncing.set(false);
          return;
        }
        console.info(`[PatientService] pullFromServer received ${remote.length} record(s)`);
        // Merge: don't overwrite local-only / pending records with server data
        for (const r of remote) {
          const existing = await this.localStorage.getPatient(r.id);
          const ageCorrected = this.setAge(r)
          if (!existing || existing.syncStatus === 'synced') {
            await this.localStorage.savePatient(ageCorrected);
          }
        }
        const now = new Date().toISOString();
        // await this.localStore.setMeta('lastSyncedAt', now);
        this.lastSyncedAt.set(now);
        this.isSyncing.set(false);
        await this.loadFromLocal();
      });
  }

  setAge(p: Patient): Patient {
    const value = p.patientAge?.trim();

    // If it's already an age like "24" or "24y", keep it
    if (!value || value.length <= 4 && !value.includes('-')) {
      return p;
    }

    // Try to treat value as DOB: "2000-01-02" or "2000-01-02T00:00:00.000"
    const dobStr = value.split('T')[0];
    const enrolledStr = (p.enrolledAt || new Date().toISOString()).split('T')[0];

    const dob = new Date(dobStr);
    const enrolled = new Date(enrolledStr);

    if (isNaN(dob.getTime()) || isNaN(enrolled.getTime())) {
      return p; // not a valid date, return as-is
    }

    let age = enrolled.getFullYear() - dob.getFullYear();

console.log('map age', String(age) )
    return {
      ...p,
      patientAge: String(age)
    };
  }
  // ── Distinct values for filter dropdowns ───────────────────────────────────
  getDistinctValues(field: keyof Patient): Promise<string[]> {
    return this.localStorage.getDistinctValues(field);
  }
}
