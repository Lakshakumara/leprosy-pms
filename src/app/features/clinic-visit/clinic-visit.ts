import { Component, computed, signal } from '@angular/core';
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

import { PatientFilter, Patient } from '../../core/services/patient.model';
import { PatientService } from '../../core/services/patient.service';
import { ClinicVisitStatus, CLINIC_VISIT_STATUS_LABEL, DoseSlot, ClinicVisitTrackerService } from '../../core/services/clinic-tracker';
import { VisitSyncService } from '../../core/services/visit-synch';



interface StatusOption {
  label: string;
  value: 'ALL' | ClinicVisitStatus;
}

interface ClassificationOption {
  label: string;
  value: string; // 'ALL' | 'PB' | 'MB'
}

/**
 * Clinic visit tracker — browse/search/filter registered patients and log
 * MDT doses against them.
 *
 * SCOPE NOTE: this component assumes patients already exist in the local
 * cache (synced down from DHIS2 via `PatientService.pullFromServer()`).
 * It does not create new tracked entities / enrollments — registering a
 * brand-new patient in DHIS2 needs TEI-attribute + enrollment payloads
 * (see `Dhis2Service`) that are a separate, larger piece of work than the
 * visit-tracking view itself. Say the word if you want that added as a
 * "Register new patient" flow on top of this.
 *
 * Filtering is two layers, kept deliberately separate:
 *  - `PatientFilter` (search + classification) goes through the existing
 *    `PatientService.filtered()` — the same mechanism the rest of the app's
 *    dashboards use.
 *  - ACTIVE / COMPLETED / AT_RISK / DEFAULTER is a UI-only re-filter on top,
 *    via `ClinicVisitTrackerService.filterByStatus()`. It never touches
 *    `PatientFilter`.
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
  ],
  templateUrl: './clinic-visit.html',
  styleUrl: './clinic-visit.scss',
})
export class ClinicVisitComponent {
  readonly statusLabel = CLINIC_VISIT_STATUS_LABEL;
  readonly todayDate = new Date();

  readonly classificationOptions: ClassificationOption[] = [
    { label: 'All classifications', value: 'ALL' },
    { label: 'PB', value: 'PB' },
    { label: 'MB', value: 'MB' },
  ];

  readonly statusOptions: StatusOption[] = [
    { label: 'All statuses', value: 'ALL' },
    { label: 'Active', value: 'ACTIVE' },
    { label: 'Completed', value: 'COMPLETED' },
    { label: 'At risk', value: 'AT_RISK' },
    { label: 'Defaulter', value: 'DEFAULTER' },
  ];

  // ── Filter state ──────────────────────────────────────────────────────────
  searchTerm = signal('');
  classificationFilter = signal<string>('ALL');
  statusFilter = signal<'ALL' | ClinicVisitStatus>('ALL');
  

  /** The subset of PatientFilter this view actually uses — no date-range restriction, so
   *  patients enrolled in a prior year but still mid-course aren't hidden. */
  private patientFilter = computed<PatientFilter>(() => ({
    district: 'ALL',
    search: this.searchTerm().trim() || undefined,
    classification: this.classificationFilter() === 'ALL' ? undefined : this.classificationFilter(),
    orgUnitId: 'ALL',
    mohArea: 'ALL',
    phiArea: 'ALL',
    gnDivision: 'ALL',
  }));

  /** Layer 1 — existing PatientService filtering (search + classification). */
  private baseFiltered = computed(() => this.patientService.filtered(this.patientFilter()));

  /** Layer 2 — UI-only status split, applied on top, never touching PatientFilter. */
  filteredPatients = computed(() => {
    const list = this.trackerService.filterByStatus(this.baseFiltered(), this.statusFilter());
    return [...list].sort((a, b) => {
      const order: Record<ClinicVisitStatus, number> = { DEFAULTER: 0, AT_RISK: 1, ACTIVE: 2, COMPLETED: 3 };
      return order[this.status(a)] - order[this.status(b)];
    });
  });

  defaulterCount = computed(() => this.baseFiltered().filter((p) => this.trackerService.isDefaulter(p)).length);
  atRiskCount = computed(() => this.baseFiltered().filter((p) => this.trackerService.isAtRisk(p)).length);

  // ── Dose entry popover state ────────────────────────────────────────────
  activePatientId: string | null = null;
  activeDoseSlot: DoseSlot | null = null;
  doseDateValue: Date | null = null;
  doseError = signal<string | null>(null);
  isSavingDose = signal(false);

  constructor(
    readonly patientService: PatientService,
    private readonly trackerService: ClinicVisitTrackerService,
    readonly visitSync: VisitSyncService
  ) {}

  // ── Template helpers ─────────────────────────────────────────────────────
  status(patient: Patient): ClinicVisitStatus {
    return this.trackerService.getVisitStatus(patient);
  }

  statusSeverity(status: ClinicVisitStatus) {
    return this.trackerService.statusSeverity(status);
  }

  doseSchedule(patient: Patient): DoseSlot[] {
    return this.trackerService.getDoseSchedule(patient);
  }

  completedDoseCount(patient: Patient): number {
    return this.trackerService.completedDoseCount(patient);
  }

  nextActionableDose(patient: Patient): DoseSlot | null {
    return this.trackerService.nextActionableDose(patient);
  }

  overdueDays(slot: DoseSlot): number {
    return this.trackerService.overdueDays(slot);
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

  /** Always look the patient up from the full cache, not the filtered/sorted view —
   *  logging a dose can move a patient out of the currently-filtered status bucket. */
  private currentPatients(): Patient[] {
    return this.patientService.allPatients();
  }
}