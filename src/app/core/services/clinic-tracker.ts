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
export type ClinicVisitStatus = 'ACTIVE' | 'COMPLETED' | 'AT_RISK' | 'DEFAULTER' | 'NEEDS_REVIEW';

export const CLINIC_VISIT_STATUS_LABEL: Record<ClinicVisitStatus, string> = {
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  AT_RISK: 'At risk',
  DEFAULTER: 'Defaulter',
  NEEDS_REVIEW: 'Needs review',
};

/**
 * The date real dose-visit tracking actually went live in this app. Any
 * enrollment whose WHO-window deadline had ALREADY passed before this date,
 * with zero doses ever logged, predates tracking entirely — paper records
 * or a prior process may well have resolved it (completed or defaulted)
 * long ago, we just never captured which. Auto-labeling 255 such patients
 * DEFAULTER would be asserting something we don't actually know.
 *
 * Update this to the real go-live date once decided; everything enrolled
 * before it and already overdue falls into a one-time manual triage queue
 * (NEEDS_REVIEW) instead.
 */
const TRACKING_START_DATE = '2026-08-05'; // TODO: set to the actual go-live date

/**
 * Dose numbers omitted from the visible schedule entirely. Visit 2's DHIS2
 * program stage has zero data elements (confirmed from the program
 * metadata) — nothing to record there beyond a bare event date, so it's
 * dropped from the trackable schedule rather than shown as a dead chip.
 */
const SKIP_DOSE_NUMBERS = new Set<number>([]);

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

  /**
   * DHIS2's enrolledAt (and potentially other date-ish fields) come back as
   * full timestamps ("2024-03-12T00:00:00.000"), not the plain yyyy-MM-dd
   * our own date math expects. Feeding a raw timestamp into addMonths()
   * silently produces an Invalid Date, which then prints as "NaN-NaN-NaN" —
   * that's exactly where that bug came from. Every date read from a Patient
   * field goes through this before any arithmetic happens on it.
   */
  private normalizeDate(raw: string | null | undefined): string {
    if (!raw) return '';
    const datePart = raw.split('T')[0].split(' ')[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : '';
  }

  /**
   * Safe for templates: a normalized yyyy-MM-dd, or an em dash placeholder
   * if the source value is missing/malformed — never a raw timestamp,
   * never "NaN-NaN-NaN".
   */
  displayDate(raw: string | null | undefined): string {
    return this.normalizeDate(raw) || '—';
  }

  /** First non-empty of treatmentStartDate / enrolledAt, normalized to yyyy-MM-dd (or '' if neither is usable). */
  private courseStartDate(patient: Patient): string {
    return this.normalizeDate(patient.treatmentStartDate) || this.normalizeDate(patient.enrolledAt);
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
    const start = this.normalizeDate(patient.treatmentStartDate);
    const end = this.normalizeDate(patient.treatmentEndDate);
    if (start && end) {
      return this.monthsBetween(start, end);
    }
    return DEFAULT_COURSE_LENGTH;
  }

  /**
   * Builds the expected dose schedule and merges in whatever real visits
   * have actually been logged, matched by `visitNumber`.
   */
  getDoseSchedule(patient: Patient): DoseSlot[] {
    const start = this.courseStartDate(patient);
    const length = this.courseLength(patient);
    const visitsByNumber = new Map((patient.visits ?? []).map((v) => [v.visitNumber, v]));
    return Array.from({ length }, (_, i) => i + 1)
      .filter((doseNumber) => !SKIP_DOSE_NUMBERS.has(doseNumber))
      .map((doseNumber) => ({
        doseNumber,
        expectedDate: start ? this.addMonths(start, doseNumber - 1) : '',
        visit: visitsByNumber.get(doseNumber) ?? null,
      }));
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
    if (patient.treatmentStatus) return patient.treatmentStatus === 'completed';
    const schedule = this.getDoseSchedule(patient);
    return schedule.length > 0 && schedule.every((slot) => !!slot.visit?.visitDate);
  }

  /**
   * How many months a patient has, from treatment start, before formally
   * defaulting — per WHO/national leprosy program convention: 1.5x the
   * nominal course length.
   *   MB (12 doses / 12 months nominal)  -> defaults if not finished within 18 months
   *   PB (6 doses / 6 months nominal)    -> defaults if not finished within 9 months
   *
   * For the rare EXT24/EXT36 extended courses, no official multiplier is
   * defined anywhere we've seen — this applies the same 1.5x rule for
   * consistency (24mo -> 36mo deadline, 36mo -> 54mo deadline). Flag this
   * assumption to a clinical lead if those rare cases need a different rule.
   */
  private defaulterWindowMonths(patient: Patient): number {
    return this.courseLength(patient) * 1.5;
  }

  /** yyyy-MM-dd — the actual calendar date this patient formally defaults, if not completed by then. */
  defaulterDeadline(patient: Patient): string {
    const start = this.courseStartDate(patient);
    if (!start) return '';
    return this.addMonths(start, this.defaulterWindowMonths(patient));
  }

  /** Signed day count to the formal default deadline — negative means already past it. */
  daysToDefaulterDeadline(patient: Patient, today: string = this.todayIso()): number | null {
    const deadline = this.defaulterDeadline(patient);
    if (!deadline) return null;
    const dl = new Date(deadline);
    const now = new Date(today);
    return Math.round((dl.getTime() - now.getTime()) / 86_400_000);
  }

  /**
   * A manually-confirmed default (`treatmentStatus === 'defaulted'`, set by
   * clinic staff via a deliberate "confirm outcome" action) always wins.
   * Otherwise: defaulter iff today is past the WHO-window deadline and the
   * course still isn't complete. This is an objective date comparison, not
   * a missed-dose heuristic — a single late visit does NOT make someone a
   * defaulter; only actually running out the full 1.5x window does.
   */
  isDefaulter(patient: Patient, today: string = this.todayIso()): boolean {
    if (patient.treatmentStatus === 'defaulted') return true;
    if (this.isCompleted(patient)) return false;
    const deadline = this.defaulterDeadline(patient);
    return !!deadline && today > deadline;
  }

  /**
   * AT_RISK is the window BEFORE the formal default deadline: the patient
   * is behind their expected dose schedule (at least one overdue dose) but
   * hasn't yet run out the full 1.5x window. This is the "go find this
   * patient" flag for clinic staff, distinct from the harder DEFAULTER line.
   */
  isAtRisk(patient: Patient, today: string = this.todayIso()): boolean {
    if (this.isCompleted(patient) || this.isDefaulter(patient, today)) return false;
    return this.missedDoseCount(patient, today) >= 1;
  }

  /**
   * True for enrollments that predate real visit tracking: the WHO-window
   * deadline already passed, but zero doses were ever logged AND that
   * deadline fell before TRACKING_START_DATE — meaning we never had a
   * chance to record what actually happened. Needs a one-time human
   * decision (completed / defaulted / still active-extended), not an
   * auto-computed DEFAULTER label.
   *
   * Once a patient has been manually triaged (treatmentStatus set to
   * something other than the default 'ongoing', or a dose has actually
   * been logged), they never land here again.
   */
  isNeedsReview(patient: Patient, today: string = this.todayIso()): boolean {
    if (patient.treatmentStatus && patient.treatmentStatus !== 'ongoing') return false;
    if (this.isCompleted(patient)) return false;
    if (this.completedDoseCount(patient) > 0) return false;
    const deadline = this.defaulterDeadline(patient);
    return !!deadline && deadline < TRACKING_START_DATE;
  }

  /**
   * Single source of truth for a patient's tracker-card status.
   * Priority: COMPLETED > NEEDS_REVIEW > DEFAULTER > AT_RISK > ACTIVE.
   * NEEDS_REVIEW is checked before DEFAULTER deliberately — an untracked
   * historical overdue-and-empty record should surface as "go find out
   * what happened", not be asserted as a confirmed default.
   */
  getVisitStatus(patient: Patient, today: string = this.todayIso()): ClinicVisitStatus {
    if (this.isCompleted(patient)) return 'COMPLETED';
    if (this.isNeedsReview(patient, today)) return 'NEEDS_REVIEW';
    if (this.isDefaulter(patient, today)) return 'DEFAULTER';
    if (this.isAtRisk(patient, today)) return 'AT_RISK';
    return 'ACTIVE';
  }

  /**
   * Lower number = shown first. Combines status urgency with a recency
   * heuristic applied only within the NEEDS_REVIEW backlog: more recently
   * enrolled patients are more likely to still be genuinely active (e.g.
   * the handful of 2024 extended cases) and worth triaging first; very old
   * enrollments are more likely long since resolved either way and safe to
   * leave for last.
   */
  priorityIndex(patient: Patient, today: string = this.todayIso()): number {
    const STATUS_TIER: Record<ClinicVisitStatus, number> = {
      DEFAULTER: 0,
      AT_RISK: 1,
      ACTIVE: 2,
      NEEDS_REVIEW: 3,
      COMPLETED: 4,
    };
    const status = this.getVisitStatus(patient, today);
    const tier = STATUS_TIER[status];
    if (status !== 'NEEDS_REVIEW') return tier;

    const start = this.courseStartDate(patient);
    const monthsAgo = start ? this.monthsBetween(start, today) : 9999;
    return tier + monthsAgo / 10_000; // fractional nudge — keeps the NEEDS_REVIEW tier intact, just orders within it
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

  statusSeverity(status: ClinicVisitStatus): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    switch (status) {
      case 'DEFAULTER':
        return 'danger';
      case 'AT_RISK':
        return 'warn';
      case 'COMPLETED':
        return 'success';
      case 'NEEDS_REVIEW':
        return 'secondary';
      default:
        return 'info';
    }
  }
}
