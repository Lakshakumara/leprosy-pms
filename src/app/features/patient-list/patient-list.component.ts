// patient-list.component.ts
import { Component, inject, computed, signal, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { BadgeModule } from 'primeng/badge';
import { PatientService } from '../../core/services/patient.service';
import { Patient, PatientFilter } from '../../core/services/patient.model';
import { STORAGE_KEYS } from '../../core/util/util';
import { DeviceStorageService } from '../../core/services/device-storage.service';
import {
  hasGrade2Disability,
  isRelapse,
  isDefaulter,
  hasDelayedDiagnosis,
} from '../../core/util/dashboard-analytics';

interface SelectOption { label: string; value: string; }

@Component({
  selector: 'app-patient-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink,
    TableModule, ButtonModule, InputTextModule,
    SelectModule, TagModule, SkeletonModule, TooltipModule, BadgeModule
  ],
  templateUrl: './patient-list.component.html',
  styleUrl: './patient-list.component.scss',
})
export class PatientListComponent implements OnInit {
exportData() {
throw new Error('Method not implemented.');
}
  private readonly storage = inject(DeviceStorageService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly patientService = inject(PatientService);
  
  // State
  protected readonly filter = signal<PatientFilter>({
    district: this.patientService.userDistricts(),
    search: '',
    classification: 'ALL',
    orgUnitId: 'ALL',
    mohArea: 'ALL',
    phiArea: 'ALL',
    gnDivision: 'ALL',
    ...this.defaultDateRange(),
  });
  
  protected readonly showFilters = signal(false);
  protected readonly filtersLoading = signal(true);
  protected readonly expandedAddresses = signal(new Set<string>());
  protected readonly viewMode = signal<'table' | 'cards'>('table');
  
  // Static filter options
  protected readonly classificationOptions: SelectOption[] = [
    { label: 'All Classifications', value: 'ALL' },
    { label: 'Multibacillary (MB)', value: 'MB (>5 lesions)' },
    { label: 'Paucibacillary (PB)', value: 'PB (1-5 lesions)' },
  ];
  
  protected readonly user = this.storage.getJSON<any>(STORAGE_KEYS.USER_DATA);
  protected readonly hospitalOptions: SelectOption[] = [
    { label: 'All Facilities', value: 'ALL' },
    ...(this.user?.organisationUnits || []).map((f: any) => ({ 
      label: f.name, 
      value: f.id 
    })),
  ];
  
  // Dynamic filter options
  protected mohAreaOptions = signal<SelectOption[]>([{ label: 'All MOH Areas', value: 'ALL' }]);
  protected phiAreaOptions = signal<SelectOption[]>([{ label: 'All PHI Areas', value: 'ALL' }]);
  protected gnDivisionOptions = signal<SelectOption[]>([{ label: 'All GN Divisions', value: 'ALL' }]);
  protected districtOptions = signal<SelectOption[]>([{ label: 'All Districts', value: 'ALL' }]);
  
  // Computed values
  protected readonly rows = computed(() => this.patientService.filtered(this.filter()));
  protected readonly totalPatients = computed(() => this.patientService.districtPatients().length);
  
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
    return count;
  });
  
  protected readonly stats = computed(() => ({
    total: this.totalPatients(),
    filtered: this.rows().length,
    mb: this.rows().filter(p => p.treatmentClassification?.toUpperCase().startsWith('MB')).length,
    pb: this.rows().filter(p => p.treatmentClassification?.toUpperCase().startsWith('PB')).length,
    children: this.rows().filter(p => Number(p.patientAge) < 15).length,
  }));

  private defaultDateRange(): { enrolledFrom: string; enrolledTo: string } {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return {
      enrolledFrom: `${yyyy}-01-01`,
      enrolledTo: `${yyyy}-${mm}-${dd}`,
    };
  }

  async ngOnInit(): Promise<void> {
    if (this.patientService.districtPatients().length === 0) {
      await this.patientService.pullFromServer();
    }
    await this.loadDistinctValues();
    this.applyQueryParams(this.route.snapshot.queryParamMap);
    this.route.queryParamMap.subscribe(params => this.applyQueryParams(params));
  }

  private applyQueryParams(params: { get: (key: string) => string | null }): void {
    const patch: Partial<PatientFilter> = {};
    const district = params.get('district');
    const year = params.get('year');
    const classification = params.get('classification');
    const orgUnitId = params.get('orgUnitId');
    const mohArea = params.get('mohArea');

    if (district) patch.district = district;
    if (classification) patch.classification = classification;
    if (orgUnitId) patch.orgUnitId = orgUnitId;
    if (mohArea) patch.mohArea = mohArea;
    const alert = params.get('alert');
    if (alert) patch.alert = alert;
    if (year) {
      patch.enrolledFrom = `${year}-01-01`;
      patch.enrolledTo = `${year}-12-31`;
    }

    if (Object.keys(patch).length) {
      this.filter.update(f => ({ ...f, ...patch }));
      this.showFilters.set(true);
    }
  }

  private async loadDistinctValues(): Promise<void> {
    this.filtersLoading.set(true);
    const [moh, phi, gn, district] = await Promise.all([
      this.patientService.getDistinctValues('patientMohArea'),
      this.patientService.getDistinctValues('patientPhiArea'),
      this.patientService.getDistinctValues('patientGnDivision'),
      this.patientService.getDistinctValues('patientDistrict')
    ]);
    this.districtOptions.set([
      { label: 'All Districts', value: 'ALL' },
      ...district.map(v => ({ label: v, value: v })),
    ]);
    this.mohAreaOptions.set([
      { label: 'All MOH Areas', value: 'ALL' },
      ...moh.map(v => ({ label: v, value: v })),
    ]);
    this.phiAreaOptions.set([
      { label: 'All PHI Areas', value: 'ALL' },
      ...phi.map(v => ({ label: v, value: v })),
    ]);
    this.gnDivisionOptions.set([
      { label: 'All GN Divisions', value: 'ALL' },
      ...gn.map(v => ({ label: v, value: v })),
    ]);
    this.filtersLoading.set(false);
  }

  protected updateFilter<K extends keyof PatientFilter>(key: K, value: PatientFilter[K]): void {
    this.filter.update(f => ({ ...f, [key]: value }));
  }

  protected clearFilters(): void {
    this.filter.set({
      district: this.patientService.userDistricts(),
      search: '',
      classification: 'ALL',
      orgUnitId: 'ALL',
      mohArea: 'ALL',
      phiArea: 'ALL',
      gnDivision: 'ALL',
      ...this.defaultDateRange(),
    });
  }

  protected async syncNow(): Promise<void> {
    await this.patientService.pullFromServer();
    await this.loadDistinctValues();
  }

  protected classBadge(cls: string): string {
    if (!cls) return 'badge--unknown';
    const upper = cls.trim().toUpperCase();
    if (upper.startsWith('MB')) return 'badge--mb';
    if (upper.startsWith('PB')) return 'badge--pb';
    return 'badge--unknown';
  }

  protected isOuterDistrict(p: Patient): boolean {
    if (!p.orgUnitId) return false;
    return !this.hospitalOptions.some((h: any) => h.value === p.orgUnitId);
  }

  protected isChildCase(p: Patient): boolean {
    const age = Number(p.patientAge);
    return !Number.isNaN(age) && age < 15;
  }

  protected rowNumber(rowIndex: number): number {
    return this.rows().length - rowIndex;
  }

  protected priorityClass(p: Patient): string {
    if (hasGrade2Disability(p)) return 'priority--grade2';
    if (isRelapse(p)) return 'priority--relapse';
    if (isDefaulter(p)) return 'priority--defaulter';
    if (hasDelayedDiagnosis(p)) return 'priority--delayed';
    return '';
  }

  protected isDefaultCaseType(caseType: string): boolean {
    return caseType?.trim().toLowerCase() === 'new';
  }

  protected caseTypeBadge(caseType: string): string {
    if (!caseType) return 'tag--other';
    const v = caseType.trim().toLowerCase();
    if (v.includes('relapse')) return 'tag--relapse';
    if (v.includes('default')) return 'tag--defaulter';
    if (v.includes('restart')) return 'tag--defaulter';
    return 'tag--other';
  }

  protected whatsappLink(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('94')) return `https://wa.me/${digits}`;
    return `https://wa.me/94${digits.replace(/^0/, '')}`;
  }

  protected toggleAddress(id: string, event: Event): void {
    event.stopPropagation();
    const next = new Set(this.expandedAddresses());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expandedAddresses.set(next);
  }

  protected goToPatient(id: string): void {
    this.router.navigate(['/patients', id]);
  }

  protected toggleViewMode(): void {
    this.viewMode.update(m => m === 'table' ? 'cards' : 'table');
  }
}