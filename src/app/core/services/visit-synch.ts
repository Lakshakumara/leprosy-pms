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

  /**
   * Extends a patient's course by N more months (default 12 — e.g. a
   * standard MB course going 12 -> 24, or the very rare second extension
   * 24 -> 36). Purely a local scheduling change: DHIS2 has no "extended
   * course" concept to write to (confirmed against the program metadata —
   * no data element covers it, and adding one needs Pramil's involvement
   * regardless), so only treatmentEndDate is updated here.
   * ClinicVisitTrackerService.courseLength() takes whichever is larger
   * between the regimen's nominal length and the date span, so this
   * reliably grows the visible dose schedule and pushes the WHO-window
   * defaulter deadline out to match — all local, no DHIS2 write attempted.
   *
   * Available on any in-progress card (ACTIVE/AT_RISK/DEFAULTER), not just
   * the NEEDS_REVIEW triage flow.
   */
  async extendCourse(patient: Patient, additionalMonths = 12): Promise<void> {
    const base = patient.treatmentEndDate || patient.treatmentStartDate || patient.enrolledAt;
    const newEndDate = this.addMonthsIso(base, additionalMonths);
    const updated: Patient = {
      ...patient,
      treatmentEndDate: newEndDate,
      treatmentStatus: 'ongoing',
      updatedAt: new Date().toISOString(),
    };
    await this.patientService.updateLocalPatient(updated);
  }

  /**
   * One-time manual triage for the historical NEEDS_REVIEW backlog — a
   * patient enrolled before real dose tracking existed, whose WHO-window
   * deadline already passed with zero doses ever logged. Staff pick one of:
   *
   *  - 'completed'  → treatmentStatus = 'completed'. Pushes enrollment
   *                   status COMPLETED to DHIS2 (native field, no metadata
   *                   change needed — see setEnrollmentOutcome on Dhis2Service).
   *  - 'defaulted'  → treatmentStatus = 'defaulted'. Pushes enrollment
   *                   status CANCELLED. The specific reason stays local-only
   *                   (defaultReason) since DHIS2 has no field for it yet.
   *  - 'extended'   → delegates to extendCourse() — local-only, see above.
   */
  async resolveHistoricalOutcome(
    patient: Patient,
    outcome: 'completed' | 'defaulted' | 'extended'
  ): Promise<void> {
    const now = new Date().toISOString();

    if (outcome === 'extended') {
      await this.extendCourse(patient, 12);
      return;
    }

    const updated: Patient = {
      ...patient,
      treatmentStatus: outcome,
      updatedAt: now,
    };
    await this.patientService.updateLocalPatient(updated);

    if (navigator.onLine) {
      try {
        await this.dhis2.setEnrollmentOutcome(updated, outcome === 'completed' ? 'COMPLETED' : 'CANCELLED');
      } catch (err) {
        console.error(`[VisitSyncService] setEnrollmentOutcome push failed for patient ${patient.id}:`, err);
        // Stays correct locally even if the DHIS2 push failed; not folded
        // into the visit pending-sync queue since it's a different kind of
        // write (enrollment status, not an event) — surface separately if
        // this needs its own retry queue later.
      }
    }
  }

  /** yyyy-MM-dd + months -> yyyy-MM-dd. Empty in, empty out. */
  private addMonthsIso(dateIso: string | undefined, months: number): string {
    if (!dateIso) return '';
    const datePart = dateIso.split('T')[0];
    const [y, m, d] = datePart.split('-').map(Number);
    if (!y || !m || !d) return '';
    const dt = new Date(y, m - 1 + months, d);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
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
      const result = await this.dhis2.saveVisitEventSafe(patient, {
        visitNumber: visit.visitNumber,
        visitDate: visit.visitDate,
        doseDate: visit.doseDate,
        reaction: visit.reaction,
        reactionType: visit.reactionType,
        reactionTreatment: visit.reactionTreatment,
        notes: visit.notes,
      });
      // in pushVisit:
      //const result = await this.dhis2.saveVisitEventSafe(patient, visit);
      const synced = this.mergeVisit(patient, { ...visit, syncStatus: 'synced' }, result.eventId);
      //const synced = this.mergeVisit(patient, { ...visit, syncStatus: 'synced' });
      await this.patientService.updateLocalPatient(synced);
      await this.refreshPendingIndexFor(patient.id);
    } catch (err) {
      console.error(`[VisitSyncService] push failed — patient ${patient.id}, visit ${visit.visitNumber}:`, err);
      const errored = this.mergeVisit(patient, { ...visit, syncStatus: 'error' });
      await this.patientService.updateLocalPatient(errored);
    }
  }

  private buildVisitRecord(
    patient: Patient,
    input: VisitInput,
    syncStatus: SimplifiedVisit['syncStatus']
  ): SimplifiedVisit {
    const existing = (patient.visits ?? []).find((v) => v.visitNumber === input.visitNumber);
    return {
      id: existing?.id ?? `${patient.id}-v${input.visitNumber}`,
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

  private mergeVisit(patient: Patient, visit: SimplifiedVisit, realEventId?: string): Patient {
    const existingVisits = patient.visits ?? [];
    const hasSlot = existingVisits.some(v => v.visitNumber === visit.visitNumber);

    // Only the real DHIS2-confirmed success path (realEventId present) is
    // allowed to force syncStatus to 'synced'. Every other caller —
    // logVisit()'s initial local save ('pending') and pushVisit()'s
    // failure path ('error') — must keep whatever status it passed in, or
    // the pending/error indicators and flushPending()'s retry filter both
    // silently stop working.
    const nextVisit: SimplifiedVisit = realEventId
      ? { ...visit, id: realEventId, syncStatus: 'synced' as const }
      : { ...visit };

    // fromDhis2() now pre-populates all 12 real dose slots as placeholders,
    // so hasSlot is true for the normal 1-12 case and this branch is a
    // no-op there. It only actually fires for dose numbers beyond 12 —
    // the extended-course case (courseLength() > 12 via extendCourse()) —
    // where no DHIS2 stage/placeholder exists yet. Without this, those
    // doses would silently vanish: .map() alone never adds a new element.
    const visits = hasSlot
      ? existingVisits.map(v => (v.visitNumber === visit.visitNumber ? nextVisit : v))
      : [...existingVisits, nextVisit];

    return {
      ...patient,
      visits: visits.sort((a, b) => a.visitNumber - b.visitNumber),
      lastVisitDate: visit.visitDate || patient.lastVisitDate,
      updatedAt: new Date().toISOString(),
    };
  }



  /*private mergeVisit(patient: Patient, visit: SimplifiedVisit): Patient {
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
  }*/

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