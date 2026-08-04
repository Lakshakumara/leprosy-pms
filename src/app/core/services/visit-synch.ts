import { Injectable, inject, signal } from '@angular/core';
import { PatientService } from './patient.service';
import { LocalStorageService } from './local-storage.service';
import { Dhis2Service } from './dhis2.service';
import { Patient, SimplifiedVisit } from './patient.model';

export interface VisitInput {
  visitNumber: number;
  /** yyyy-MM-dd */
  visitDate: string;
  /** yyyy-MM-dd, if different from visitDate */
  doseDate?: string;
  reaction?: boolean;
  reactionType?: string;
  reactionTreatment?: string;
  notes?: string;
}

/** Key under LocalStorageService's meta store — index of patient ids with at least one unsynced visit. */
const PENDING_VISIT_META_KEY = 'pendingVisitSyncPatientIds';

/**
 * Offline-first write path for clinic visits.
 *
 * Flow for `logVisit()`:
 *  1. Build/merge the visit into the patient record, marked `syncStatus: 'pending'`.
 *  2. Save to IndexedDB and refresh the in-memory signal via
 *     `PatientService.updateLocalPatient()` — this happens unconditionally
 *     and instantly, so the clinic worker sees the tick regardless of
 *     connectivity.
 *  3. If online, attempt an immediate push to DHIS2. Success upgrades the
 *     visit to `syncStatus: 'synced'`; failure leaves it `'pending'`/`'error'`
 *     for later retry.
 *
 * Automatic recovery: a browser `online` event triggers `flushPending()`,
 * which walks every patient id in the pending index and retries their
 * unsynced visits. The pending index itself is persisted (not just in
 * memory), so a logged-offline visit still gets pushed even if the app was
 * closed and reopened before connectivity returned.
 */
@Injectable({ providedIn: 'root' })
export class VisitSyncService {
  private readonly patientService = inject(PatientService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly dhis2 = inject(Dhis2Service);

  /** Count of patients with at least one visit awaiting sync — safe to show in the UI as a badge. */
  readonly pendingCount = signal(0);
  readonly isFlushing = signal(false);
  readonly lastFlushError = signal<string | null>(null);

  constructor() {
    window.addEventListener('online', () => this.flushPending());
    this.restorePendingCount();

    // Leftover pending visits from a previous offline session should go out
    // as soon as we get a chance, not wait for the next online *transition*.
    if (navigator.onLine) {
      setTimeout(() => this.flushPending(), 1500);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async logVisit(patient: Patient, input: VisitInput): Promise<void> {
    const visit = this.buildVisitRecord(patient, input, 'pending');
    const updated = this.mergeVisit(patient, visit);

    // Local-first: never blocked by network.
    await this.patientService.updateLocalPatient(updated);
    await this.addToPendingIndex(patient.id);

    if (navigator.onLine) {
      await this.pushVisit(updated, visit);
    }
  }

  /** Clear a visit's date (undo a mis-entry). Same offline-first + sync path as logging one. */
  async clearVisit(patient: Patient, visitNumber: number): Promise<void> {
    const existing = (patient.visits ?? []).find((v) => v.visitNumber === visitNumber);
    if (!existing) return;

    const cleared: SimplifiedVisit = { ...existing, visitDate: '', syncStatus: 'pending' };
    const updated = this.mergeVisit(patient, cleared);

    await this.patientService.updateLocalPatient(updated);
    await this.addToPendingIndex(patient.id);

    if (navigator.onLine) {
      await this.pushVisit(updated, cleared);
    }
  }

  /** Manual "sync now" entry point — same logic the `online` listener runs automatically. */
  async flushPending(): Promise<void> {
    if (this.isFlushing() || !navigator.onLine) return;

    this.isFlushing.set(true);
    this.lastFlushError.set(null);

    try {
      const pendingIds = await this.getPendingIds();
      for (const patientId of pendingIds) {
        const patient = await this.localStorage.getPatient(patientId);
        if (!patient) {
          await this.removeFromPendingIndex(patientId);
          continue;
        }
        const unsynced = (patient.visits ?? []).filter((v) => v.syncStatus === 'pending' || v.syncStatus === 'error');
        for (const visit of unsynced) {
          await this.pushVisit(patient, visit);
        }
      }
    } catch (err) {
      console.error('[VisitSyncService] flushPending failed:', err);
      this.lastFlushError.set('Sync failed — will retry automatically next time you are online.');
    } finally {
      this.isFlushing.set(false);
    }
  }

  // ── Push + merge internals ───────────────────────────────────────────────

  private async pushVisit(patient: Patient, visit: SimplifiedVisit): Promise<void> {
    // An empty visitDate means "cleared locally" — nothing meaningful to
    // push to DHIS2 for that yet; just let it settle as synced-empty.
    if (!visit.visitDate) {
      const synced = this.mergeVisit(patient, { ...visit, syncStatus: 'synced' });
      await this.patientService.updateLocalPatient(synced);
      await this.refreshPendingIndexFor(patient.id);
      return;
    }

    try {
      await this.dhis2.saveVisitEventSafe(patient, {
        visitNumber: visit.visitNumber,
        visitDate: visit.visitDate,
        doseDate: visit.doseDate,
        reaction: visit.reaction,
        reactionType: visit.reactionType,
        reactionTreatment: visit.reactionTreatment,
        notes: visit.notes,
      });

      const synced = this.mergeVisit(patient, { ...visit, syncStatus: 'synced' });
      await this.patientService.updateLocalPatient(synced);
      await this.refreshPendingIndexFor(patient.id);
    } catch (err) {
      console.error(`[VisitSyncService] push failed — patient ${patient.id}, visit ${visit.visitNumber}:`, err);
      const errored = this.mergeVisit(patient, { ...visit, syncStatus: 'error' });
      await this.patientService.updateLocalPatient(errored);
      // Left in the pending index deliberately, so the next flush retries it.
    }
  }

  private buildVisitRecord(
    patient: Patient,
    input: VisitInput,
    syncStatus: SimplifiedVisit['syncStatus']
  ): SimplifiedVisit {
    const existing = (patient.visits ?? []).find((v) => v.visitNumber === input.visitNumber);
    return {
      id: existing?.id ?? `${patient.id}-visit-${input.visitNumber}`,
      visitNumber: input.visitNumber,
      visitDate: input.visitDate,
      doseDate: input.doseDate,
      reaction: input.reaction,
      reactionType: input.reactionType,
      reactionTreatment: input.reactionTreatment,
      notes: input.notes,
      syncStatus,
    };
  }

  private mergeVisit(patient: Patient, visit: SimplifiedVisit): Patient {
    const existingVisits = patient.visits ?? [];
    const hasSlot = existingVisits.some((v) => v.visitNumber === visit.visitNumber);
    const visits = hasSlot
      ? existingVisits.map((v) => (v.visitNumber === visit.visitNumber ? visit : v))
      : [...existingVisits, visit].sort((a, b) => a.visitNumber - b.visitNumber);

    return {
      ...patient,
      visits,
      lastVisitDate: visit.visitDate || patient.lastVisitDate,
      updatedAt: new Date().toISOString(),
    };
  }

  // ── Pending index (persisted via LocalStorageService's meta store) ──────

  private async getPendingIds(): Promise<string[]> {
    return (await this.localStorage.getMeta<string[]>(PENDING_VISIT_META_KEY)) ?? [];
  }

  private async addToPendingIndex(patientId: string): Promise<void> {
    const ids = new Set(await this.getPendingIds());
    ids.add(patientId);
    await this.localStorage.setMeta(PENDING_VISIT_META_KEY, [...ids]);
    this.pendingCount.set(ids.size);
  }

  private async removeFromPendingIndex(patientId: string): Promise<void> {
    const ids = new Set(await this.getPendingIds());
    ids.delete(patientId);
    await this.localStorage.setMeta(PENDING_VISIT_META_KEY, [...ids]);
    this.pendingCount.set(ids.size);
  }

  /** After a push attempt, drop the patient from the index only if nothing of theirs is still pending/error. */
  private async refreshPendingIndexFor(patientId: string): Promise<void> {
    const patient = await this.localStorage.getPatient(patientId);
    const stillPending = patient?.visits?.some((v) => v.syncStatus === 'pending' || v.syncStatus === 'error') ?? false;
    if (stillPending) {
      await this.addToPendingIndex(patientId);
    } else {
      await this.removeFromPendingIndex(patientId);
    }
  }

  private async restorePendingCount(): Promise<void> {
    const ids = await this.getPendingIds();
    this.pendingCount.set(ids.length);
  }
}