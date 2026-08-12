import { AfterViewInit, Component, computed, effect, inject, OnDestroy, OnInit, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { BadgeModule } from 'primeng/badge';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { PopoverModule, Popover } from 'primeng/popover';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { TooltipModule } from 'primeng/tooltip';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ProgressBarModule } from 'primeng/progressbar';
import { ClinicVisitStatus, DoseSlot, CLINIC_VISIT_STATUS_LABEL, ClinicVisitTrackerService } from '../../core/services/clinic-tracker';
import { Patient, PatientFilter } from '../../core/services/patient.model';
import { PatientService } from '../../core/services/patient.service';
import { VisitSyncService } from '../../core/services/visit-synch';
import { MobileHeaderService, MobileOverflow } from '../../core/services/mobile-header.service';
import { SelectOption, STORAGE_KEYS } from '../../core/util/util';

/**
 * Everything a card template needs, precomputed ONCE per patient per
 * filter/data change — not re-derived on every Angular change-detection
 * tick. With 255+ patients, calling getDoseSchedule()/getVisitStatus()/etc.
 * as plain methods directly from *ngFor was the real source of the slow
 * rendering: each one rebuilds a 12-slot array, and CD was re-invoking them
 * repeatedly per patient per tick. This view-model is built inside a single
 * `computed()`, so it only reruns when the underlying signals it reads
 * actually change.
 */
interface PatientCardViewModel {
  patient: Patient;
  status: ClinicVisitStatus;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null; // <-- ADD
  remainDoses: number;
  remainMonths: number;
  doseSchedule: DoseSlot[];
  completedCount: number;
  nextDose: DoseSlot | null;
  defaulterDeadline: string;
  daysToDeadline: number | null;
  priority: number;
}

/**
 * Clinic visit tracker — browse/search/filter registered patients and log
 * MDT doses against them.
 *
 * SCOPE NOTE: this component assumes patients already exist in the local
 * cache (synced down from DHIS2 via `PatientService.pullFromServer()`).
 * It does not create new tracked entities / enrollments.
 *
 * Filtering is two layers, kept deliberately separate:
 *  - `PatientFilter` (search + classification) goes through the existing
 *    `PatientService.filtered()`.
 *  - ACTIVE / COMPLETED / AT_RISK / DEFAULTER / NEEDS_REVIEW is a UI-only
 *    re-filter on top, via `ClinicVisitTrackerService.filterByStatus()`.
 *    It never touches `PatientFilter`.
 *
 * HISTORICAL BACKLOG: patients enrolled before real visit-tracking existed
 * (no doses ever logged, WHO-window deadline already passed before
 * TRACKING_START_DATE in the tracker service) land in NEEDS_REVIEW rather
 * than being auto-labeled DEFAULTER. Each one needs a single one-time
 * human decision — see the "Confirm outcome" actions on those cards, wired
 * through `resolveHistoricalOutcome()` on VisitSyncService.
 */
@Component({
  selector: 'app-clinic-visit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    TagModule,
    BadgeModule,
    InputTextModule,
    DatePickerModule,
    SelectModule,
    PopoverModule,
    IconFieldModule,
    InputIconModule,
    TooltipModule,
    MessageModule,
    ProgressSpinnerModule,
    ProgressBarModule,
  ],
  templateUrl: './clinic-visit.html',
  styleUrl: './clinic-visit.scss',
})
export class ClinicVisitComponent implements AfterViewInit, OnDestroy {
  private mobileHeader = inject(MobileHeaderService);
  readonly statusLabel = CLINIC_VISIT_STATUS_LABEL;
  readonly todayDate = new Date();


  protected readonly hospitalOptions: SelectOption[] = [
    { label: 'All Facilities', value: 'ALL' },
    ...(this.patientService.user?.organisationUnits || []).map((f: any) => ({
      label: f.name,
      value: f.id
    })),
    { label: 'Other Institute', value: 'OTHER' },
  ];
  readonly classificationOptions: SelectOption[] = [
    { label: 'All classifications', value: 'ALL' },
    { label: 'PB', value: 'PB' },
    { label: 'MB', value: 'MB' },
  ];

  readonly statusOptions: SelectOption[] = [
    { label: 'All statuses', value: 'ALL' },
    { label: 'On going', value: 'ONGOING' },
    { label: 'Active', value: 'ACTIVE' },
    { label: 'At risk', value: 'AT_RISK' },
    { label: 'Needs review', value: 'NEEDS_REVIEW' },
    { label: 'Defaulter', value: 'DEFAULTER' },
    { label: 'Completed', value: 'COMPLETED' },
  ];

  // ── Filter state ──────────────────────────────────────────────────────────
  searchTerm = signal('');
  classificationFilter = signal<string>('ALL');
  statusFilter = signal<'ALL' | 'ONGOING' | ClinicVisitStatus>('ONGOING');
  hospitalFilter = signal<'All' | string>('ALL');
  private patientFilter = computed<PatientFilter>(() => ({
    search: this.searchTerm().trim() || undefined,
    classification: this.classificationFilter() === 'ALL' ? undefined : this.classificationFilter(),
    orgUnitId: this.hospitalFilter() == 'ALL' ? undefined : this.hospitalFilter()
  }));

  /** Layer 1 — existing PatientService filtering (search + classification). */
  private baseFiltered = computed(() => this.patientService.filtered(this.patientFilter()));

  /** Layer 2 — UI-only status split, applied on top, never touching PatientFilter. */
  private statusFiltered = computed(() =>
    this.trackerService.filterByStatus(this.baseFiltered(), this.statusFilter())
  );

  cardViewModels = computed<PatientCardViewModel[]>(() => {
    const today = this.trackerService.todayIso();
    return this.statusFiltered()
      .map((patient) => {
        const status = this.trackerService.getVisitStatus(patient, today);
        const y = (patient.visits ?? []).filter(v => this.trackerService['normalizeDate'](v.visitDate)).length;
        const total = this.trackerService.courseLength(patient);
        const remainDoses = total - y;
        const enroll = this.trackerService.courseStartDate(patient);
        const yUsed = enroll ? this.trackerService['diffMonths'](enroll, today) : 0;
        const maxMonths = patient.treatmentType?.includes('PB') ? 9 : 18;
        const remainMonths = maxMonths - yUsed;

        return {
          patient,
          status,
          riskLevel: status === 'AT_RISK' ? this.trackerService.getAtRiskLevel(patient, today) : null,
          remainDoses,
          remainMonths,
          doseSchedule: this.trackerService.getDoseSchedule(patient),
          completedCount: this.trackerService.completedDoseCount(patient),
          nextDose: this.trackerService.nextActionableDose(patient),
          defaulterDeadline: this.trackerService.defaulterDeadline(patient),
          daysToDeadline: this.trackerService.daysToDefaulterDeadline(patient, today),
          priority: this.trackerService.priorityIndex(patient, today),
        };
      })
      .sort((a, b) => a.priority - b.priority);
  });

  atRiskLowCount = computed(() => this.cardViewModels().filter(vm => vm.riskLevel === 'LOW').length);
  atRiskMediumCount = computed(() => this.cardViewModels().filter(vm => vm.riskLevel === 'MEDIUM').length);
  atRiskHighCount = computed(() => this.cardViewModels().filter(vm => vm.riskLevel === 'HIGH').length);

  riskSeverity(level: string) {
    if (level === 'LOW') return 'success';
    if (level === 'MEDIUM') return 'warn';
    return 'danger';
  }

  activeStats = computed(() => {
    const filtered = this.baseFiltered();
    let total = 0;
    const byHospitalMap = new Map<string, number>();

    for (const p of filtered) {
      if (this.trackerService.getVisitStatus(p) !== 'ACTIVE') continue;
      total++;
      const hospital = p.orgUnitName || p.orgUnitId || 'Unknown';
      byHospitalMap.set(hospital, (byHospitalMap.get(hospital) || 0) + 1);
    }

    const byHospital = [...byHospitalMap.entries()]
      .sort((a, b) => b[1] - a[1]) // highest count first
      .map(([hospital, count]) => ({ hospital, count }));

    return { total, byHospital };
  });

  defaulterCount = computed(() => this.baseFiltered().filter((p) => this.trackerService.isDefaulter(p)).length);
  atRiskCount = computed(() => this.baseFiltered().filter((p) => this.trackerService.isAtRisk(p)).length);
  needsReviewStats = computed(() => {
    const filtered = this.baseFiltered();
    let total = 0;
    const byYearMap = new Map<string, number>();

    for (const p of filtered) {
      if (!this.trackerService.isNeedsReview(p)) continue;
      total++;
      const year = p.enrolledAt?.slice(0, 4) || 'Unknown';
      byYearMap.set(year, (byYearMap.get(year) || 0) + 1);
    }

    const byYear = [...byYearMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([year, count]) => ({ year, count }));

    return { total, byYear };
  });


  // ── Progressive reveal (renders large lists in batches instead of all at once) ──
  private readonly revealBatchSize = 20;
  private readonly revealDelayMs = 60;
  revealedCount = signal(this.revealBatchSize);
  private revealTimer: ReturnType<typeof setTimeout> | undefined;

  visibleCardViewModels = computed(() => this.cardViewModels().slice(0, this.revealedCount()));

  revealProgressPercent = computed(() => {
    const total = this.cardViewModels().length;
    return total === 0 ? 100 : Math.round((this.revealedCount() / total) * 100);
  });

  isRevealing = computed(() => this.revealedCount() < this.cardViewModels().length);

  trackByPatientId(_index: number, vm: PatientCardViewModel): string {
    return vm.patient.id;
  }

  // ── Dose entry popover state ────────────────────────────────────────────
  activePatientId: string | null = null;
  activeDoseSlot: DoseSlot | null = null;
  doseDateValue: Date | null = null;
  doseError = signal<string | null>(null);
  isSavingDose = signal(false);

  // ── Historical-outcome triage popover state ────────────────────────────
  triagePatientId: string | null = null;
  isResolvingOutcome = signal(false);
  triageError = signal<string | null>(null);

  // ── Course extension (available on any in-progress card, not just triage) ──
  isExtendingCourse = signal(false);
  extendError = signal<string | null>(null);

  constructor(
    readonly patientService: PatientService,
    private readonly trackerService: ClinicVisitTrackerService,
    readonly visitSync: VisitSyncService
  ) {
    effect(() => {
      const total = this.cardViewModels().length; // track

      // don't track writes
      untracked(() => {
        clearTimeout(this.revealTimer);
        this.revealedCount.set(Math.min(this.revealBatchSize, total || this.revealBatchSize));
        this.scheduleNextBatch();
      });
    });
  }
  ngAfterViewInit() {
    queueMicrotask(() => {
      this.setupMobileHeader();
    });
  }
  ngOnDestroy(): void {
    this.mobileHeader.clear();
  }

  private setupMobileHeader(): void {
    const currentStatus = this.statusFilter();

    this.mobileHeader.set({
      title: 'Clinic visit tracker',
      subtitle: `Cases ${this.statusFiltered().length}`,
      searchPlaceholder: 'Search ALC, clinic no, name...',

      actions: [
        {
          icon: 'pi pi-filter',
          label: 'Filter',
          badge: this.activeFilterCount() > 0 ? this.activeFilterCount() : undefined,
          command: () => this.mobileHeader.toggleFilterDrawer()
        },
      ],

      overflow: [
        // Status options - replaces your p-select
        ...this.statusOptions.map(opt => ({
          label: opt.label,
          icon: currentStatus === opt.value ? 'pi pi-check-circle' : 'pi pi-circle',
          command: () => this.onStatusChange(opt.value)
        } as MobileOverflow)),

        { label: '', separator: true } as MobileOverflow,


      ]
    });
  }

  private onStatusChange(value: any): void {
    this.statusFilter.set(value);
    /*
      // If ALL -> clear filter
      if (value === 'ALL') {
        this.se.set(null);
      } else {
        this._activeStatusFilter.set(value as ClinicVisitStatus);
      }
    
      this.setupMobileHeader();
      this.applyFilters();*/
  }
  protected readonly filter = signal<PatientFilter>({
    district: this.patientService.userDistrict(),
    search: '',
    classification: 'ALL',
    orgUnitId: 'ALL',
    mohArea: 'ALL',
    phiArea: 'ALL',
    gnDivision: 'ALL',
    year: new Date().getFullYear().toString(),
  });
  protected readonly activeFilterCount = computed(() => {
    const f = this.filter();
    let count = 0;
    if (f.district) count++;
    if (f.search) count++;
    if (f.classification && f.classification !== 'ALL') count++;
    if (f.orgUnitId && f.orgUnitId !== 'ALL') count++;
    if (f.mohArea && f.mohArea !== 'ALL') count++;
    if (f.phiArea && f.phiArea !== 'ALL') count++;
    if (f.gnDivision && f.gnDivision !== 'ALL') count++;
    if (f.enrolledFrom) count++;
    if (f.enrolledTo) count++;
    if (f.outsideDistrict) count++;
    if (f.year) count++;
    return count;
  });

  private scheduleNextBatch(): void {
    this.revealTimer = setTimeout(() => {
      const total = this.cardViewModels().length;
      if (this.revealedCount() >= total) return;
      this.revealedCount.update((n) => Math.min(n + this.revealBatchSize, total));
      this.scheduleNextBatch();
    }, this.revealDelayMs);
  }

  // ── Template helpers ─────────────────────────────────────────────────────
  statusSeverity(status: ClinicVisitStatus) {
    return this.trackerService.statusSeverity(status);
  }

  overdueDays(slot: DoseSlot): number {
    return this.trackerService.overdueDays(slot);
  }

  /** Always yyyy-MM-dd or '—' — never a raw timestamp, never NaN-NaN-NaN. */
  displayDate(raw: string | null | undefined): string {
    return this.trackerService.displayDate(raw);
  }

  firstMdtDateDisplay(patient: Patient): string {
    return this.trackerService.displayDate(patient.treatmentStartDate || patient.enrolledAt);
  }

  isExtended(patient: Patient): boolean {
    return this.trackerService.isExtended(patient);
  }

  courseLength(patient: Patient): number {
    return this.trackerService.courseLength(patient);
  }

  async extendCourse(patient: Patient): Promise<void> {
    const currentLength = this.trackerService.courseLength(patient);
    const nextLength = currentLength + 12;
    const confirmed = window.confirm(
      `Extend this patient's course from ${currentLength} to ${nextLength} months? ` +
      `The formal default deadline moves out to match (${nextLength} × 1.5 months from start). ` +
      `Note: DHIS2 has no field for this — it's tracked locally only.`
    );
    if (!confirmed) return;

    this.isExtendingCourse.set(true);
    try {
      await this.visitSync.extendCourse(patient, 12);
      this.extendError.set(null);
    } catch (err) {
      console.error('[ClinicVisitComponent] extendCourse failed:', err);
      this.extendError.set('Could not save locally — please try again.');
    } finally {
      this.isExtendingCourse.set(false);
    }
  }

  doseChipStatus(slot: DoseSlot): 'visited' | 'visited-late' | 'missed' | 'upcoming' {
    if (slot.visit?.visitDate) {
      return slot.visit.visitDate > slot.expectedDate ? 'visited-late' : 'visited';
    }
    return slot.expectedDate && slot.expectedDate < this.trackerService.todayIso() ? 'missed' : 'upcoming';
  }

  /** 'pending' | 'error' | null — drives the small sync-status indicator on a dose chip. */
  doseSyncFlag(slot: DoseSlot): 'pending' | 'error' | null {
    if (!slot.visit) return null;
    return slot.visit.syncStatus === 'synced' ? null : slot.visit.syncStatus;
  }

  // ── Dose entry ────────────────────────────────────────────────────────────
  openDoseEntry(popover: Popover, event: Event, patient: Patient, slot: DoseSlot): void {
    this.activePatientId = patient.id;
    this.activeDoseSlot = slot;
    this.doseDateValue = this.trackerService.parseIsoDate(slot.visit?.visitDate ?? null);
    this.doseError.set(null);
    popover.toggle(event);
  }

  async saveDose(popover: Popover): Promise<void> {
    const patient = this.currentPatients().find((p) => p.id === this.activePatientId);
    if (!patient || !this.activeDoseSlot) return;

    if (!this.doseDateValue) {
      this.doseError.set('Pick a visit date');
      return;
    }
    const iso = this.trackerService.toIsoDate(this.doseDateValue);
    const today = this.trackerService.todayIso();
    if (iso > today) {
      this.doseError.set('Visit date cannot be in the future');
      return;
    }

    this.isSavingDose.set(true);
    try {
      await this.visitSync.logVisit(patient, {
        visitNumber: this.activeDoseSlot.doseNumber,
        visitDate: iso,
        doseDate: iso,
      });
      this.doseError.set(null);
      popover.hide();
    } catch (err) {
      console.error('[ClinicVisitComponent] saveDose failed:', err);
      this.doseError.set('Could not save locally — please try again.');
    } finally {
      this.isSavingDose.set(false);
    }
  }

  async clearDose(popover: Popover): Promise<void> {
    const patient = this.currentPatients().find((p) => p.id === this.activePatientId);
    if (!patient || !this.activeDoseSlot) return;

    this.isSavingDose.set(true);
    try {
      await this.visitSync.clearVisit(patient, this.activeDoseSlot.doseNumber);
      this.doseDateValue = null;
      popover.hide();
    } finally {
      this.isSavingDose.set(false);
    }
  }

  // ── Historical-outcome triage (NEEDS_REVIEW backlog) ─────────────────────
  openTriage(popover: Popover, event: Event, patient: Patient): void {
    this.triagePatientId = patient.id;
    this.triageError.set(null);
    popover.toggle(event);
  }

  async resolveTriage(popover: Popover, outcome: 'completed' | 'defaulted' | 'extended'): Promise<void> {
    const patient = this.currentPatients().find((p) => p.id === this.triagePatientId);
    if (!patient) return;

    this.isResolvingOutcome.set(true);
    try {
      await this.visitSync.resolveHistoricalOutcome(patient, outcome);
      this.triageError.set(null);
      popover.hide();
    } catch (err) {
      console.error('[ClinicVisitComponent] resolveTriage failed:', err);
      this.triageError.set('Could not save locally — please try again.');
    } finally {
      this.isResolvingOutcome.set(false);
    }
  }

  /** Always look the patient up from the full cache, not the filtered/sorted view —
   *  logging a dose or resolving triage can move a patient out of the currently-filtered bucket. */
  private currentPatients(): Patient[] {
    return this.patientService.allPatients();
  }
}