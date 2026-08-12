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
  public courseStartDate(patient: Patient): string {
    return this.normalizeDate(patient.treatmentStartDate) || this.normalizeDate(patient.enrolledAt);
  }

  // ── Course length / dose schedule ────────────────────────────────────────

  /** The regimen's nominal length, ignoring any date-based extension. */
  private nominalCourseLength(patient: Patient): number {
    const regimen = patient.treatmentRegimen;
    return regimen && FIXED_COURSE_LENGTH[regimen] ? FIXED_COURSE_LENGTH[regimen]! : DEFAULT_COURSE_LENGTH;
  }

  /**
   * How many monthly doses this patient's course is expected to run.
   *
   * Takes the LARGER of: the regimen's nominal length (PB=6, MB=12), and
   * the span implied by treatmentStartDate/treatmentEndDate. An extension
   * only ever pushes the deadline further out, never shorter — so if
   * treatmentEndDate has been manually pushed past the regimen's nominal
   * length (via extendCourse() on VisitSyncService), that always wins.
   *
   * This is how the rare 24/36-month extensions are represented: DHIS2 has
   * no field for "this course was extended" (confirmed against the program
   * metadata — no data element covers it, and Pramil's the only one who
   * could add one). It isn't a distinct `treatmentRegimen` value either.
   * So it lives purely as a later treatmentEndDate in the local cache —
   * practical, not ideal, but there's no DHIS2 slot to put it in.
   */
  courseLength(patient: Patient): number {
    const nominal = this.nominalCourseLength(patient);
    const start = this.normalizeDate(patient.treatmentStartDate);
    const end = this.normalizeDate(patient.treatmentEndDate);
    const fromDates = start && end ? this.monthsBetween(start, end) : 0;
    return Math.max(nominal, fromDates);
  }

  /** True once a course has been pushed past its regimen's nominal length — drives the "Extended" badge in the UI. */
  isExtended(patient: Patient): boolean {
    return this.courseLength(patient) > this.nominalCourseLength(patient);
  }

  //------------ schedule date calculation-------------

  private getClinicWeekdayFromHistory(patient: Patient): number {
    const realVisits = (patient.visits ?? [])
      .filter(v => this.normalizeDate(v.visitDate))
      .map(v => this.normalizeDate(v.visitDate)!)
      .sort((a, b) => a.localeCompare(b)) // oldest first
      .slice(-5); // last 5 only - handles consultant change

    if (realVisits.length === 0) {
      const start = this.courseStartDate(patient);
      return start ? new Date(start).getDay() : 1;
    }

    // Count weekdays
    const counts = new Map<number, number>();
    for (const d of realVisits) {
      const wd = new Date(d).getDay();
      counts.set(wd, (counts.get(wd) ?? 0) + 1);
    }

    // Most frequent weekday = clinic day
    let bestDay = new Date(realVisits[realVisits.length - 1]).getDay();
    let bestCount = 0;
    counts.forEach((c, day) => {
      if (c > bestCount) {
        bestCount = c;
        bestDay = day;
      }
    });
    return bestDay;
  }
  /**
   * Builds the expected dose schedule and merges in whatever real visits
   * have actually been logged, matched by `visitNumber`.
   */
  getDoseSchedule(patient: Patient): DoseSlot[] {
    const start = this.courseStartDate(patient);
    const length = this.courseLength(patient);
    const visitsByNumber = new Map((patient.visits ?? []).map(v => [v.visitNumber, v]));
    const clinicWeekday = this.getClinicWeekdayFromHistory(patient);

    let lastDate = start;
    const slots: DoseSlot[] = [];

    for (let doseNumber = 1; doseNumber <= length; doseNumber++) {
      if (SKIP_DOSE_NUMBERS.has(doseNumber)) continue;

      let expectedDate = '';
      if (doseNumber === 1) {
        expectedDate = start;
      } else {
        const prevVisit = visitsByNumber.get(doseNumber - 1);
        const baseDate = prevVisit?.visitDate ? this.normalizeDate(prevVisit.visitDate) : lastDate;
        if (baseDate) {
          const plus28 = this.addDays(baseDate, 28);
          expectedDate = this.adjustToClinicDay(plus28, clinicWeekday);
        }
      }
      if (expectedDate) lastDate = expectedDate;

      slots.push({
        doseNumber,
        expectedDate,
        visit: visitsByNumber.get(doseNumber) ?? null,
      });
    }
    return slots;
  }

  private adjustToClinicDay(dateStr: string, targetWeekday: number): string {
    const d = new Date(dateStr);
    let diff = targetWeekday - d.getDay();
    // Never exceed 28 days, if snap would go to +3 days or more, go back 1 week = 21-25 days
    if (diff > 2) diff -= 7;
    if (diff < -4) diff += 7; // never go below 21 days
    d.setDate(d.getDate() + diff);
    return this.toIsoDate(d);
  }

  private addDays(dateStr: string, days: number): string {
    const dt = new Date(dateStr);
    dt.setDate(dt.getDate() + days);
    return this.toIsoDate(dt);
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

  // ── Status ────────────────────────────────────────────────────────────────

  isCompleted(patient: Patient): boolean {
    if (!this.isEligibleForTracking(patient)) return false;
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

  private diffMonths(from: string, to: string): number {
    const a = new Date(from);
    const b = new Date(to);
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() >= a.getDate() ? 0 : -1);
    // If today is 2026-07-05 and enroll 2026-06-07, counts as 0 months used, not 1
  }

  isDefaulter(patient: Patient, today: string = this.todayIso()): boolean {
    if (!this.isEligibleForTracking(patient)) return false;
    if (this.isNeedsReview(patient, today)) return false;
    if (this.isCompleted(patient)) return false;

    const enrollDate = this.courseStartDate(patient);
    if (!enrollDate) return false;

    const totalDoses = patient.treatmentType.includes('PB') ? 6 : 12;
    const maxMonths = patient.treatmentType.includes('PB') ? 9 : 18; // Basic idea 3

    // 1. y = how many visits already done (last completed)
    const completedVisits = (patient.visits ?? [])
      .filter(v => this.normalizeDate(v.visitDate))
      .sort((a, b) => a.visitNumber - b.visitNumber);

    const y = completedVisits.length; // Basic idea 4.1
    const lastVisit = completedVisits[completedVisits.length - 1];

    // If no visit yet, not defaulter
    if (y === 0) return false;

    // 2. z = remaining to complete
    const z = totalDoses - y; // Basic idea 4.2
    if (z <= 0) return false; // completed

    // 3. yUsedMonths = months spent to complete y doses (from enroll to TODAY, not last visit)
    // This includes the gap when patient was absent
    const yUsedMonths = this.diffMonths(enrollDate, today);

    // 4. zRemainingMonths
    const zRemainingMonths = maxMonths - yUsedMonths;

    // 5 & 6. Can patient still complete?
    // Needs at least 1 month per remaining dose
    return zRemainingMonths < z;
  }

  isAtRisk(patient: Patient, today: string = this.todayIso()): boolean {
    if (!this.isEligibleForTracking(patient)) return false;
    if (this.isNeedsReview(patient, today)) return false;
    if (this.isCompleted(patient)) return false;
    if (this.isDefaulter(patient, today)) return false;

    const enrollDate = this.courseStartDate(patient);
    if (!enrollDate) return false;

    const totalDoses = patient.treatmentType.includes('PB') ? 6 : 12;
    const maxMonths = patient.treatmentType.includes('PB') ? 9 : 18;

    const y = (patient.visits ?? []).filter(v => this.normalizeDate(v.visitDate)).length;
    const x = totalDoses - y; // remain doses
    if (x <= 0) return false;

    const yUsedMonths = this.diffMonths(enrollDate, today);
    const xRemainingMonths = maxMonths - yUsedMonths; // remaining months to complete

    // No risk: has more than 1.5 months per remaining dose = active
    if (xRemainingMonths > x * 1.5) return false;

    // If remaining time is <= 1.5 per dose, patient is at risk (LOW/MEDIUM/HIGH)
    // Defaulter already handled: if xRemainingMonths < x
    return xRemainingMonths <= x * 1.5;
  }

  getAtRiskLevel(patient: Patient, today: string = this.todayIso()): 'LOW' | 'MEDIUM' | 'HIGH' | null {
    const enrollDate = this.courseStartDate(patient);
    if (!enrollDate) return null;
    if (!this.isAtRisk(patient, today)) return null;
    const totalDoses = patient.treatmentType.includes('PB') ? 6 : 12;
    const maxMonths = patient.treatmentType.includes('PB') ? 9 : 18;

    const y = (patient.visits ?? []).filter(v => this.normalizeDate(v.visitDate)).length;
    const x = totalDoses - y;
    const yUsedMonths = this.diffMonths(enrollDate, today);
    const xRemainingMonths = maxMonths - yUsedMonths;

    // Your exact rules:
    if (xRemainingMonths === x * 1.5 || xRemainingMonths > x * 1.5 - 0.5) {
      // e.g. x=2, xRemaining=3 => 3 = 2*1.5 => LOW
      return 'LOW';
    }
    if (xRemainingMonths === x) {
      // e.g. x=2, xRemaining=2 => exactly enough months = HIGH
      return 'HIGH';
    }
    // x < xRemaining < x*1.5 => MEDIUM
    // e.g. x=4, xRemaining=5 => 4 < 5 < 6 => MEDIUM
    if (xRemainingMonths > x && xRemainingMonths < x * 1.5) {
      return 'MEDIUM';
    }

    return 'HIGH'; // fallback: closest to deadline
  }

  // Helper you already have, but fix to use normalizeDate
  nextActionableDose(patient: Patient): DoseSlot | null {
    return this.getDoseSchedule(patient).find(slot => {
      const hasRealDate = this.normalizeDate(slot.visit?.visitDate ?? '') !== '';
      return !hasRealDate;
    }) ?? null;
  }

  overdueDays(slot: DoseSlot, today: string = this.todayIso()): number {
    if (!slot.expectedDate) return 0;
    const due = new Date(slot.expectedDate);
    const now = new Date(today);
    const diff = now.getTime() - due.getTime();
    return Math.max(0, Math.floor(diff / 86400000));
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
    if (!this.isEligibleForTracking(patient)) return true;
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
    // Case X check
    if (!this.isEligibleForTracking(patient)) {
      return 'NEEDS_REVIEW';
    }

    // Only runs if Case X passes
    if (this.isCompleted(patient)) return 'COMPLETED';
    if (this.isDefaulter(patient, today)) return 'DEFAULTER';
    if (this.isAtRisk(patient, today)) return 'AT_RISK';
    return 'ACTIVE';
  }

  /**
   * 1. enroll date after TRACKING_START_DATE -> eligible
   * 2. enroll date older than TRACKING_START_DATE AND has 1st + 2nd visit -> eligible
   *    (means user started entering back-dated visits)
   */
  private isEligibleForTracking(patient: Patient): boolean {
    const enrollDate = this.normalizeDate(patient.enrolledAt) || this.courseStartDate(patient);
    if (!enrollDate) return false;

    // Condition 1: New patient after tracking started
    if (enrollDate >= TRACKING_START_DATE) {
      return true;
    }

    // Condition 2: Old patient but user started entering history
    // 1st visit = enroll date (auto), 2nd visit = mapped data element
    // So check if at least 2 visits have visitDate
    const hasFirstVisit = (patient.visits ?? []).some(v => v.visitNumber === 1 && !!v.visitDate)
      || !!enrollDate; // 1st is auto as enroll date, so always true if enrollDate exists

    const hasRealSecondVisit = (patient.visits ?? []).some(v => {
      if (v.visitNumber !== 2) return false;
      const date = this.normalizeDate(v.visitDate); // '' if empty/invalid, '2024-03-12' if real
      return date !== '';
    });// If you mapped 2nd visit to a dataElement, also check that DE
    // Example: const secondVisitFromDE = this.normalizeDate((patient as any).secondVisitDate);
    // const hasSecondVisit = !!secondVisitFromDE || visits check above

    if (hasFirstVisit && hasRealSecondVisit) {
      return true;
    }

    return false;
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
    status: 'ALL' | 'ONGOING' | ClinicVisitStatus,
    today: string = this.todayIso()
  ): Patient[] {
    if (status === 'ALL') return patients;
    if (status === 'ONGOING') return patients.filter((p) => {
      const s = this.getVisitStatus(p, today);
      return s === 'ACTIVE' || s === 'AT_RISK';
    });
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