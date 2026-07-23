import { Component, inject, computed, model, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PatientService } from '../../core/services/patient.service';
import { Patient } from '../../core/services/patient.model';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import { STORAGE_KEYS } from '../../core/util/util';
import { DeviceStorageService } from '../../core/services/device-storage.service';
import {
  buildAlerts,
  countByField,
  deformityDistribution,
  enrollmentTrend,
  hasDelayedDiagnosis,
  hasGrade2Disability,
  isChildCase,
  isDefaulter,
  isMb,
  isPb,
  isRelapse,
  programIndicators,
  yearOf,
  type CountRow,
  type DashboardAlert,
} from '../../core/util/dashboard-analytics';

interface SelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MultiSelectModule,
    SelectModule,
    TooltipModule,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private readonly storage = inject(DeviceStorageService);
  private readonly router = inject(Router);
  protected readonly patientService = inject(PatientService);

  private readonly currentYear = new Date().getFullYear();

  protected readonly yearOptions = Array.from(
    { length: this.currentYear - 2022 + 1 },
    (_, i) => this.currentYear - i
  );
  protected readonly disabilityText = [
    { label: 'Grade 2', value: '3' },
    { label: 'Grade 1', value: '2' },
    { label: 'Grade 0', value: '1' },
  ];

  protected readonly districtOptions: SelectOption[] = this.patientService.healthDistricts();
  /*protected readonly districtOptions: SelectOption[] = [
    { label: 'Ampara', value: 'Ampara' },
    { label: 'Anuradhapura', value: 'Anuradhapura' },
    { label: 'Badulla', value: 'Badulla' },
    { label: 'Batticaloa', value: 'Batticaloa' },
    { label: 'Colombo', value: 'Colombo' },
    { label: 'CMC', value: 'CMC' },
    { label: 'Galle', value: 'Galle' },
    { label: 'Gampaha', value: 'Gampaha' },
    { label: 'Hambantota', value: 'Hambantota' },
    { label: 'Jaffna', value: 'Jaffna' },
    { label: 'Kalutara', value: 'Kalutara' },
    { label: 'Kandy', value: 'Kandy' },
    { label: 'Kegalle', value: 'Kegalle' },
    { label: 'Kilinochchi', value: 'Kilinochchi' },
    { label: 'Kurunegala', value: 'Kurunegala' },
    { label: 'Mannar', value: 'Mannar' },
    { label: 'Matale', value: 'Matale' },
    { label: 'Matara', value: 'Matara' },
    { label: 'Monaragala', value: 'Monaragala' },
    { label: 'Mullaitivu', value: 'Mullaitivu' },
    { label: 'NIHS', value: 'NIHS' },
    { label: 'Nuwara Eliya', value: 'NuwaraEliya' },
    { label: 'Polonnaruwa', value: 'Polonnaruwa' },
    { label: 'Puttalam', value: 'Puttalam' },
    { label: 'Ratnapura', value: 'Ratnapura' },
    { label: 'Trincomalee', value: 'Trincomalee' },
    { label: 'Vavuniya', value: 'Vavuniya' },
  ];*/

  protected readonly selectedDistrict = model(this.patientService.healthDistricts()[0].value);
  protected readonly selectedYears = model<number[]>([this.currentYear]);
  protected readonly selectedFacility = model<string>('ALL');

  protected readonly hoveredMoh = model<string | null>(null);
  protected readonly hoveredYear = model<number | null>(null);




  // Add near your other model()/signal() declarations:

  /** Controls the collapsible filter panel - collapsed by default on mobile. */
  protected readonly showFilters = signal(false);

  /**
   * PLACEHOLDER population figure for NCDR (New Case Detection Rate).
   * Replace with a real per-district population lookup once available -
   * until then, every district's NCDR uses this same national-ish estimate,
   * which will be inaccurate for district-level comparison. The pTooltip
   * and population-note in the template both flag this to whoever's reading
   * the dashboard, so it isn't mistaken for a validated figure.
   */
  protected readonly populationEstimate = signal(1_200_000);

  /**
   * New Case Detection Rate per 100,000 population - the standard WHO/
   * national leprosy program indicator. Uses `total()` (registered cases
   * within the current filter selection) as the case count.
   */
  protected readonly ncdr = computed(() => {
    const population = this.populationEstimate();
    if (!population) return 0;
    return Math.round((this.total() / population) * 100000 * 10) / 10; // one decimal place
  });

  /** How many of district/years/facility are actively narrowing the view - drives the filter count badge. */
  protected readonly activeFilterCount = computed(() => {
    let count = 0;
    if (this.selectedDistrict()) count++;
    if (this.selectedYears().length > 0 && this.selectedYears().length < this.yearOptions.length) count++;
    if (this.selectedFacility() !== 'ALL') count++;
    return count;
  });





  protected readonly facilityOptions = computed<SelectOption[]>(() => {
    const user = this.storage.getJSON<any>(STORAGE_KEYS.USER_DATA);
    const facilities: SelectOption[] = [{ label: 'All facilities', value: 'ALL' }];
    for (const f of user?.organisationUnits ?? []) {
      facilities.push({ label: f.name, value: f.id });
    }
    return facilities;
  });

  protected readonly filteredPatients = computed<Patient[]>(() => {
    const all = this.patientService.allPatients();
    const years = this.selectedYears();
    const district = this.selectedDistrict();
    const facility = this.selectedFacility();
    return all.filter(p => {
      if (district && p.patientDistrict !== district) return false;
      if (facility !== 'ALL' && p.orgUnitId !== facility) return false;
      if (years === null || years.length === 0) return true;
      const year = yearOf(p.enrolledAt);
      return year != null && years.includes(year);
    });
  });

  protected readonly total = computed(() => this.filteredPatients().length);
  protected readonly mbCount = computed(() => this.filteredPatients().filter(isMb).length);
  protected readonly pbCount = computed(() => this.filteredPatients().filter(isPb).length);
  protected readonly activeCount = computed(
    () => this.filteredPatients().filter(p => p.enrollmentStatus === 'ACTIVE').length
  );
  protected readonly completedCount = computed(
    () => this.filteredPatients().filter(p => p.enrollmentStatus === 'COMPLETED').length
  );
  protected readonly grade2Count = computed(
    () => this.filteredPatients().filter(hasGrade2Disability).length
  );
  protected readonly childCount = computed(
    () => this.filteredPatients().filter(isChildCase).length
  );
  protected readonly recentCount = computed(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    return this.filteredPatients().filter(p => p.enrolledAt && new Date(p.enrolledAt) >= cutoff).length;
  });

  protected readonly indicators = computed(() => programIndicators(this.filteredPatients()));
  protected readonly alerts = computed<DashboardAlert[]>(() => buildAlerts(this.filteredPatients()));
  protected readonly byYear = computed(() => enrollmentTrend(this.filteredPatients()));
  protected readonly byHospital = computed<CountRow[]>(() =>
    countByField(
      this.filteredPatients(),
      p =>
        p.orgUnitName ||
        (this.storage.getFacilities() ?? []).find((f: { id: string; name: string }) => f.id === p.orgUnitId)?.name ||
        p.orgUnitId ||
        'Unknown',
      p => p.orgUnitId,
      8
    )
  );
  protected readonly byMoh = computed<CountRow[]>(() =>
    countByField(this.filteredPatients(), p => p.patientMohArea || '(not recorded)', undefined, 10)
  );
  protected readonly byPhi = computed<CountRow[]>(() =>
    countByField(this.filteredPatients(), p => p.patientPhiArea || '(not recorded)', undefined, 8)
  );
  protected readonly deformityDistribution = computed(() => deformityDistribution(this.filteredPatients()));

  protected readonly sexSplit = computed(() => {
    const patients = this.filteredPatients();
    const male = patients.filter(p => p.patientSex?.toLowerCase().startsWith('m')).length;
    const female = patients.filter(p => p.patientSex?.toLowerCase().startsWith('f')).length;
    const other = patients.length - male - female;
    const total = patients.length || 1;
    return [
      { label: 'Male', count: male, pct: Math.round((male / total) * 100) },
      { label: 'Female', count: female, pct: Math.round((female / total) * 100) },
      { label: 'Not recorded', count: other, pct: Math.round((other / total) * 100) },
    ].filter(r => r.count > 0);
  });

  protected readonly deformityBreakdown = computed(() => {
    const patients = this.filteredPatients();
    const total = patients.length || 1;
    const items = [
      { label: 'Claw hand', count: patients.filter(p => p.clawHand).length },
      { label: 'Foot drop', count: patients.filter(p => !!p.footDrop).length },
      { label: 'Foot ulcer', count: patients.filter(p => !!p.footUlcer).length },
      { label: 'Eye involvement', count: patients.filter(p => !!p.eyeInvolvement).length },
      { label: 'Face involvement', count: patients.filter(p => !!p.faceInvolvement).length },
    ];
    return items
      .filter(i => i.count > 0)
      .map(i => ({ ...i, pct: Math.round((i.count / total) * 100) }));
  });

  protected readonly mbPbDonut = computed(() => {
    const mb = this.mbCount();
    const pb = this.pbCount();
    const total = mb + pb || 1;
    const mbPct = Math.round((mb / total) * 100);
    return { mb, pb, mbPct, pbPct: 100 - mbPct };
  });

  protected readonly yearOverYearChange = computed(() => {
    const trend = this.byYear();
    if (trend.length < 2) return null;
    const latest = trend[trend.length - 1];
    const prev = trend[trend.length - 2];
    if (!prev.count) return null;
    return Math.round(((latest.count - prev.count) / prev.count) * 100);
  });

  protected readonly maxHospitalCount = computed(() =>
    Math.max(1, ...this.byHospital().map(r => r.count))
  );
  protected readonly maxMohCount = computed(() => Math.max(1, ...this.byMoh().map(r => r.count)));

  async ngOnInit(): Promise<void> {
    if (this.patientService.allPatients().length === 0) {
      await this.patientService.pullFromServer();
    }
  }

  protected selectAllYears(): void {
    this.selectedYears.set([...this.yearOptions]);
  }

  protected clearYears(): void {
    this.selectedYears.set([]);
  }

  protected navigateWithFilter(queryParams: Record<string, string>): void {
    const params: Record<string, string> = {
      district: this.selectedDistrict(),
      ...queryParams,
    };
    for (const key of Object.keys(params)) {
      if (!params[key]) delete params[key];
    }
    if (this.selectedYears().length === 1) {
      params['year'] = String(this.selectedYears()[0]);
    }
    void this.router.navigate(['/patients'], { queryParams: params });
  }

  protected drillDownMoh(row: CountRow): void {
    if (row.label === '(not recorded)') return;
    this.navigateWithFilter({ mohArea: row.label });
  }

  protected drillDownHospital(row: CountRow): void {
    if (row.id) {
      this.navigateWithFilter({ orgUnitId: row.id });
    }
  }

  protected drillDownClassification(type: 'MB' | 'PB'): void {
    this.navigateWithFilter({
      classification: type === 'MB' ? 'MB (>5 lesions)' : 'PB (1-5 lesions)',
    });
  }

  protected alertPatients(alert: DashboardAlert): Patient[] {
    const patients = this.filteredPatients();
    switch (alert.icon) {
      case 'pi-exclamation-triangle':
        return patients.filter(hasGrade2Disability);
      case 'pi-replay':
        return patients.filter(isRelapse);
      case 'pi-clock':
        return patients.filter(isDefaulter);
      case 'pi-users':
        return patients.filter(p => !p.contactHistory);
      case 'pi-calendar-times':
        return patients.filter(hasDelayedDiagnosis);
      case 'pi-heart':
        return patients.filter(isChildCase);
      case 'pi-search':
        return patients.filter(isMb);
      default:
        return patients;
    }
  }

  protected openAlert(alert: DashboardAlert): void {
    const specific = this.alertPatients(alert);
    if (specific.length === 1) {
      void this.router.navigate(['/patients', specific[0].id]);
      return;
    }
    this.navigateWithFilter(alert.queryParams);
  }
}
