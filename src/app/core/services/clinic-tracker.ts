import { Injectable } from '@angular/core';
import { Patient, SimplifiedVisit } from './patient.model';

/**
 * UI-only status used for the clinic-visit tracker cards/filters.
 *
 * Deliberately NOT wired to `../util/dashboard-analytics.ts` — that file's
 * `isDefaulter` / `isMb` etc. drive the existing dashboard drill-downs via
 * `PatientFilter.alert`, and are left untouched. This is a second, parallel
 * read of the same `Patient` data for a different surface (the visit-tracker
 * card view), so the two can evolve independently without either one having
 * to account for the other's callers.
 *
 * This service is meant to be layered ON TOP of `PatientService.filtered()`:
 * call `filtered()` first for district/search/date/alert filtering, then run
 * the resulting list through `filterByStatus()` here for the ACTIVE /
 * COMPLETED / AT_RISK / DEFAULTER split. Neither layer needs to know about
 * the other's filter fields.
 */
export type ClinicVisitStatus = 'ACTIVE' | 'COMPLETED' | 'AT_RISK' | 'DEFAULTER';

export const CLINIC_VISIT_STATUS_LABEL: Record<ClinicVisitStatus, string> = {
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  AT_RISK: 'At risk',
  DEFAULTER: 'Defaulter',
};

/** A single expected dose slot, with the matching real visit merged in if logged. */
export interface DoseSlot {
  doseNumber: number;
  /** yyyy-MM-dd — derived, not stored anywhere */
  expectedDate: string;
  visit: SimplifiedVisit | null;
}

/**
 * Course length (number of monthly doses) per regimen, for regimens where
 * this is fixed by protocol. Regimens not listed here (ROM, Without Dapsone,
 * Rifampicin Only, Other) don't have a single fixed length — course length
 * for those falls back to `treatmentEndDate` if set, or DEFAULT_COURSE_LENGTH
 * otherwise. See `courseLength()`.
 */
const FIXED_COURSE_LENGTH: Partial<Record<NonNullable<Patient['treatmentRegimen']>, number>> = {
  'MDT-PB': 6,
  'MDT-MB': 12,
};

/** Fallback when neither regimen nor treatmentEndDate tells us the course length. */
const DEFAULT_COURSE_LENGTH = 12;

@Injectable({ providedIn: 'root' })
export class ClinicVisitTrackerService {

 /* const doseDateMap: Record<number, string> = {
  3: 'iUmTtQ7Ns2e',   // Lep - Date of 3rd dose
  4: 'Q9yfNalp7Zx',   // Lep - Date of 4th dose
  5: 'OrjHDf1HxkM',   // Lep - Date of 5th dose
  6: 'Aqbn33c8zhC',   // Lep - Date of 6th dose
  7: 'gZYy0bxCe4z',   // Lep - Date of 7th dose
  8: 'cT00vhW7acW',   // Lep - Date of 8th dose
  9: 'V0wKlPaB5Tl',   // Lep - Date of 9th dose
  10: 'MJY4wcQLvsG',  // Lep - Date of 10th dose
  11: 'FELbL4uIrz4',  // Lep - Date of 11th dose
  12: 'xw1t4z8CXvF',  // Lep - Date of 12th dose
};*/
  // ── Date helpers ──────────────────────────────────────────────────────────

  todayIso(): string {
    return this.toIsoDate(new Date());
  }

  /** Public so components can convert a p-datepicker value straight to the yyyy-MM-dd the model stores. */
  toIsoDate(dt: Date): string {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** Public inverse of toIsoDate — parses yyyy-MM-dd into a local Date for binding to p-datepicker. */
  parseIsoDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  private addMonths(dateStr: string, months: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return this.toIsoDate(new Date(y, m - 1 + months, d));
  }

  private monthsBetween(startIso: string, endIso: string): number {
    const [sy, sm] = startIso.split('-').map(Number);
    const [ey, em] = endIso.split('-').map(Number);
    return Math.max(1, (ey - sy) * 12 + (em - sm));
  }

  // ── Course length / dose schedule ────────────────────────────────────────

  /**
   * How many monthly doses this patient's course is expected to run.
   * Priority: fixed regimen length (PB=6, MB=12) > span implied by
   * treatmentStartDate/treatmentEndDate (covers the rare 24 / 36 month
   * extensions, which aren't a distinct `treatmentRegimen` value in the
   * model) > DEFAULT_COURSE_LENGTH.
   */
  courseLength(patient: Patient): number {
    const regimen = patient.treatmentRegimen;
    if (regimen && FIXED_COURSE_LENGTH[regimen]) {
      return FIXED_COURSE_LENGTH[regimen]!;
    }
    if (patient.treatmentStartDate && patient.treatmentEndDate) {
      return this.monthsBetween(patient.treatmentStartDate, patient.treatmentEndDate);
    }
    return DEFAULT_COURSE_LENGTH;
  }

  /**
   * Builds the expected dose schedule and merges in whatever real visits
   * have actually been logged, matched by `visitNumber`.
   */
  getDoseSchedule(patient: Patient): DoseSlot[] {
    const start = patient.treatmentStartDate || patient.enrolledAt;
    const length = this.courseLength(patient);
    const visitsByNumber = new Map((patient.visits ?? []).map((v) => [v.visitNumber, v]));

    return Array.from({ length }, (_, i) => {
      const doseNumber = i + 1;
      return {
        doseNumber,
        expectedDate: start ? this.addMonths(start, i) : '',
        visit: visitsByNumber.get(doseNumber) ?? null,
      };
    });
  }

  // ── Counts ────────────────────────────────────────────────────────────────

  completedDoseCount(patient: Patient): number {
    return (patient.visits ?? []).filter((v) => !!v.visitDate).length;
  }

  missedDoseCount(patient: Patient, today: string = this.todayIso()): number {
    return this.getDoseSchedule(patient).filter(
      (slot) => !slot.visit?.visitDate && slot.expectedDate && slot.expectedDate < today
    ).length;
  }

  nextActionableDose(patient: Patient): DoseSlot | null {
    return this.getDoseSchedule(patient).find((slot) => !slot.visit?.visitDate) ?? null;
  }

  overdueDays(slot: DoseSlot, today: string = this.todayIso()): number {
    if (!slot.expectedDate) return 0;
    const due = new Date(slot.expectedDate);
    const now = new Date(today);
    return Math.max(0, Math.round((now.getTime() - due.getTime()) / 86_400_000));
  }

  // ── Status ────────────────────────────────────────────────────────────────

  isCompleted(patient: Patient): boolean {
    if (patient.enrollmentStatus) return patient.enrollmentStatus === 'COMPLETED';
    const schedule = this.getDoseSchedule(patient);
    return schedule.length > 0 && schedule.every((slot) => !!slot.visit?.visitDate);
  }

  /**
   * A manually-flagged default (`treatmentStatus === 'defaulted'`, set by
   * clinic staff) always wins. Otherwise falls back to the missed-dose
   * count threshold below.
   */
  isDefaulter(patient: Patient, today: string = this.todayIso()): boolean {
    if (patient.treatmentStatus === 'defaulted') return true;
    return this.missedDoseCount(patient, today) >= 2;
  }

  /**
   * REFERENCE METHOD — intentionally simple placeholder, to be redesigned.
   *
   * Every call site (status derivation, card badge, filter, sort) reads
   * through this one function, so replacing its body later is a one-file
   * change. Likely future inputs: overdue-day count rather than just missed
   * count, distance/travel time to clinic, prior default history, EHF score
   * / disability grade, age.
   *
   * Current rule: exactly one missed dose (below the DEFAULTER threshold
   * of 2+, above zero).
   */
  isAtRisk(patient: Patient, today: string = this.todayIso()): boolean {
    return this.missedDoseCount(patient, today) === 1;
  }

  /**
   * Single source of truth for a patient's tracker-card status.
   * Priority: COMPLETED > DEFAULTER > AT_RISK > ACTIVE.
   */
  getVisitStatus(patient: Patient, today: string = this.todayIso()): ClinicVisitStatus {
    if (this.isCompleted(patient)) return 'COMPLETED';
    if (this.isDefaulter(patient, today)) return 'DEFAULTER';
    if (this.isAtRisk(patient, today)) return 'AT_RISK';
    return 'ACTIVE';
  }

  // ── UI-only filter layer ────────────────────────────────────────────────

  /**
   * Applies the ACTIVE / COMPLETED / AT_RISK / DEFAULTER split on top of an
   * already-filtered list (e.g. the output of `PatientService.filtered()`).
   * Purely a client-side re-filter — doesn't touch `PatientFilter` at all.
   */
  filterByStatus(
    patients: Patient[],
    status: 'ALL' | ClinicVisitStatus,
    today: string = this.todayIso()
  ): Patient[] {
    if (status === 'ALL') return patients;
    return patients.filter((p) => this.getVisitStatus(p, today) === status);
  }

  statusSeverity(status: ClinicVisitStatus): 'success' | 'warn' | 'danger' | 'info' {
    switch (status) {
      case 'DEFAULTER':
        return 'danger';
      case 'AT_RISK':
        return 'warn';
      case 'COMPLETED':
        return 'success';
      default:
        return 'info';
    }
  }
}