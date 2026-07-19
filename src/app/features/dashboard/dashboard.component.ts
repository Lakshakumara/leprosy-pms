import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PatientService } from '../../core/services/patient.service';
import { environment } from '../../../environments/environment';
import { Patient } from '../../core/services/patient.model';

import { MultiSelectModule } from 'primeng/multiselect';
import { FormsModule } from '@angular/forms';
import { DISTRICT, STORAGE_KEYS } from '../../core/util/util';
import { OrgScopeService } from '../../core/services/org-scope.service';
import { DeviceStorageService } from '../../core/services/device-storage.service';

interface CountRow { label: string; count: number; pct: number; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MultiSelectModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private readonly storage = inject(DeviceStorageService);
  private readonly scope = inject(OrgScopeService)
  ngOnInit(): void {

    //console.log('f', this.user)
    //console.log('assignedFacilities()', this.scope.assignedFacilities())
  }
  protected readonly patientService = inject(PatientService);

  private readonly currentYear = new Date().getFullYear();

  /** 2022 .. current year, descending (newest first). */
  protected readonly yearOptions = Array.from(
    { length: this.currentYear - 2022 + 1 },
    (_, i) => this.currentYear - i
  );

  /** Empty selection = show all years (default state). */
  protected readonly selectedYears = signal<number[]>([this.currentYear]);

  /**
   * enrolledAt is stored as "yyyy-MM-dd". Pull the year straight out of the
   * string rather than going through `new Date(...).getFullYear()` - avoids
   * any timezone-driven off-by-one on date parsing.
   */
  private yearOf(enrolledAt: string | undefined | null): number | null {
    if (!enrolledAt || enrolledAt.length < 4) return null;
    const year = Number(enrolledAt.slice(0, 4));
    return Number.isNaN(year) ? null : year;
  }

  /** Every other computed value below reads from this, not patientService.patients() directly. */
  protected readonly filteredPatients = computed<Patient[]>(() => {
    const all = this.patientService.patients();
    const years = this.selectedYears();
    if (years.length === 0) return all; // no selection = all years
    return all.filter((p) => {
      const year = this.yearOf(p.enrolledAt);
      return year != null && years.includes(year) && p.patientDistrict === DISTRICT;
    });
  });

  protected selectAllYears(): void {
    this.selectedYears.set([...this.yearOptions]);
  }

  protected clearYears(): void {
    this.selectedYears.set([]);
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  protected readonly total = computed(() => this.filteredPatients().length);

  protected readonly mbCount = computed(() =>
    this.filteredPatients().filter(p => p.treatmentClassification === 'MB (>5 lesions)').length
  );
  protected readonly pbCount = computed(() =>
    this.filteredPatients().filter(p => p.treatmentClassification === 'PB (1-5 lesions)').length
  );

  protected readonly activeCount = computed(() =>
    this.filteredPatients().filter(p => p.enrollmentStatus === 'ACTIVE').length
  );
  protected readonly completedCount = computed(() =>
    this.filteredPatients().filter(p => p.enrollmentStatus === 'COMPLETED').length
  );

  protected readonly contactHistoryCount = computed(() =>
    this.filteredPatients().filter(p => p.contactHistory).length
  );
  protected readonly relapseCount = computed(() =>
    this.filteredPatients().filter(p => p.relapse && p.relapse !== 'false').length
  );
  protected readonly highEhfCount = computed(() =>
    this.filteredPatients().filter(p => p.ehfScore >= 7).length
  );
  protected readonly grade2Count = computed(() =>
    this.filteredPatients().filter(p => p.disabilityAtDiagnosis === '3').length
  );

  // Recent registrations (last 30 days) - within the currently filtered set
  protected readonly recentCount = computed(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    return this.filteredPatients().filter(p => {
      if (!p.enrolledAt) return false;
      return new Date(p.enrolledAt) >= cutoff;
    }).length;
  });

  protected readonly facilities = this.storage.getJSON<any>(STORAGE_KEYS.USER_DATA).organisationUnits;
  // ── By hospital ─────────────────────────────────────────────────────────────
  protected readonly byHospital = computed<CountRow[]>(() => {
    const patients = this.filteredPatients();
    if (!patients.length) return [];
    const map = new Map<string, number>();
    for (const p of patients) {
      const name = p.orgUnitName || this.storage.getFacilities().find((f: any) => f.id === p.orgUnitId)?.name || p.orgUnitId || 'Unknown';
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    const total = patients.length;
    return [...map.entries()]
      .map(([label, count]) => ({ label, count, pct: Math.round(count / total * 100) }))
      .sort((a, b) => b.count - a.count);
  });

  // ── By MOH area ─────────────────────────────────────────────────────────────
  protected readonly byMoh = computed<CountRow[]>(() => {
    const patients = this.filteredPatients();
    if (!patients.length) return [];
    const map = new Map<string, number>();
    for (const p of patients) {
      const key = p.patientMohArea || '(not recorded)';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const total = patients.length;
    return [...map.entries()]
      .map(([label, count]) => ({ label, count, pct: Math.round(count / total * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  });

  // ── EHF score distribution ───────────────────────────────────────────────────
  protected readonly ehfDistribution = computed<CountRow[]>(() => {
    const patients = this.filteredPatients();
    if (!patients.length) return [];
    const groups = [
      { label: 'Grade 0 (EHF 0)', min: 0, max: 0 },
      { label: 'Grade 1 (EHF 1–3)', min: 1, max: 3 },
      { label: 'Grade 2 (EHF 4–6)', min: 4, max: 6 },
      { label: 'Grade 2+ (EHF 7–12)', min: 7, max: 12 },
    ];
    const total = patients.length;
    return groups.map(g => {
      const count = patients.filter(p => p.ehfScore >= g.min && p.ehfScore <= g.max).length;
      return { label: g.label, count, pct: Math.round(count / total * 100) };
    });
  });

  // ── Trend: enrollments by year ───────────────────────────────────────────────
  protected readonly byYear = computed<{ year: number; count: number; pct: number }[]>(() => {
    const patients = this.filteredPatients();
    if (!patients.length) return [];
    const map = new Map<number, number>();
    for (const p of patients) {
      const year = this.yearOf(p.enrolledAt);
      if (year == null) continue;
      map.set(year, (map.get(year) ?? 0) + 1);
    }
    const max = Math.max(1, ...map.values());
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, count]) => ({ year, count, pct: Math.round(count / max * 100) }));
  });

  // ── Max for bar normalisation ────────────────────────────────────────────────
  protected readonly maxHospitalCount = computed(() =>
    Math.max(1, ...this.byHospital().map(r => r.count))
  );
}