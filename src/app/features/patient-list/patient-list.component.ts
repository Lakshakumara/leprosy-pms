import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { PatientService } from '../../core/services/patient.service';
import { Patient, PatientFilter } from '../../core/services/patient.model';
import { environment } from '../../../environments/environment';
import { DISTRICT, STORAGE_KEYS } from '../../core/util/util';
import { DeviceStorageService } from '../../core/services/device-storage.service';
interface SelectOption { label: string; value: string; }
@Component({
    selector: 'app-patient-list',
    standalone: true,
    imports: [
        CommonModule, FormsModule, RouterLink,
        TableModule, ButtonModule, InputTextModule,
        SelectModule, TagModule, SkeletonModule,
    ],
    templateUrl: './patient-list.component.html',
    styleUrl: './patient-list.component.scss',
})
export class PatientListComponent implements OnInit {
    private readonly storage = inject(DeviceStorageService);
    protected readonly patientService = inject(PatientService);
    protected readonly filter = signal<PatientFilter>({
        district: 'All',
        search: '',
        classification: 'ALL',
        orgUnitId: 'ALL',
        mohArea: 'ALL',
        phiArea: 'ALL',
        gnDivision: 'ALL',
        ...this.defaultDateRange(),
    });
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
    protected readonly showFilters = signal(false);
    protected readonly filtersLoading = signal(true);
    // ── Static filter options ─────────────────────────────────────────────────
    protected readonly classificationOptions: SelectOption[] = [
        { label: 'All classifications', value: 'ALL' },
        { label: 'MB — Multibacillary', value: 'MB (>5 lesions)' },
        { label: 'PB — Paucibacillary', value: 'PB (1-5 lesions)' },
    ];
    protected readonly user = this.storage.getJSON<any>(STORAGE_KEYS.USER_DATA);
    protected readonly hospitalOptions: SelectOption[] = [
        { label: 'All hospitals', value: 'ALL' },
        // ...environment.FACILITIES.map(f => ({ label: f.displayName, value: f.id })),
        ...this.user.organisationUnits.map((f: any) => ({ label: f.name, value: f.id })),
    ];
    // ── Dynamic filter options (from IndexedDB distinct values) ───────────────
    protected mohAreaOptions = signal<SelectOption[]>([{ label: 'All MOH areas', value: 'ALL' }]);
    protected phiAreaOptions = signal<SelectOption[]>([{ label: 'All PHI areas', value: 'ALL' }]);
    protected gnDivisionOptions = signal<SelectOption[]>([{ label: 'All GN divisions', value: 'ALL' }]);
    protected districtOptions = signal<SelectOption[]>([{ label: 'All District', value: 'ALL' }]);
    // ── Filtered rows ─────────────────────────────────────────────────────────
    protected readonly rows = computed(() => this.patientService.filtered(this.filter()));
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
    async ngOnInit(): Promise<void> {
        // Trigger DHIS2 pull on first visit (if online and no local data)
        if (this.patientService.patients().length === 0) {
            await this.patientService.pullFromServer();
        }
        await this.loadDistinctValues();
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
            { label: 'All District', value: 'ALL' },
            ...district.map(v => ({ label: v, value: v })),
        ]);
        this.mohAreaOptions.set([
            { label: 'All MOH areas', value: 'ALL' },
            ...moh.map(v => ({ label: v, value: v })),
        ]);
        this.phiAreaOptions.set([
            { label: 'All PHI areas', value: 'ALL' },
            ...phi.map(v => ({ label: v, value: v })),
        ]);
        this.gnDivisionOptions.set([
            { label: 'All GN divisions', value: 'ALL' },
            ...gn.map(v => ({ label: v, value: v })),
        ]);
        this.filtersLoading.set(false);
    }
    protected updateFilter<K extends keyof PatientFilter>(key: K, value: PatientFilter[K]): void {
        this.filter.update(f => ({ ...f, [key]: value }));
    }
    protected clearFilters(): void {
        this.filter.set({
            district: DISTRICT,
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

    /*protected classBadge(cls: string): string {
        if (!cls) return 'badge--unknown';
        return cls.toUpperCase() === 'MB (>5 lesions)' ? 'badge--mb' : 'badge--pb';
    } */
    protected enrolledDaysAgo(enrolledAt: string): number {
        if (!enrolledAt) return 0;
        const ms = Date.now() - new Date(enrolledAt).getTime();
        return Math.floor(ms / (1000 * 60 * 60 * 24));
    }
    /**
 * Splice these into your existing PatientListComponent class, replacing
 * the old classBadge() method.
 */

/**
 * FIXED: previously compared an uppercased full string against a
 * lowercase-in-part literal ("MB (>5 lesions)"), which could never match
 * since .toUpperCase() also uppercases "lesions". Now only checks the
 * MB/PB prefix, case-insensitively, ignoring the parenthetical detail -
 * works regardless of exact DHIS2 option-set wording.
 */
protected classBadge(cls: string): string {
  if (!cls) return 'badge--unknown';
  const upper = cls.trim().toUpperCase();
  if (upper.startsWith('MB')) return 'badge--mb';
  if (upper.startsWith('PB')) return 'badge--pb';
  return 'badge--unknown';
}

/**
 * True if this patient was enrolled at a facility OUTSIDE your own
 * hospitalOptions list (i.e. an "outer district" registration you're
 * seeing via the living-district cross-search, not your own catchment).
 * Assumes hospitalOptions items have `.value` matching p.orgUnitId -
 * adjust the field name here if your actual hospitalOptions shape differs.
 */
protected isOuterDistrict(p: Patient): boolean {
  if (!p.orgUnitId) return false;
  return !this.hospitalOptions.some((h: any) => h.value === p.orgUnitId);
}

/** True if this is a pediatric case (under 15) worth flagging visually. */
protected isChildCase(p: Patient): boolean {
  const age = Number(p.patientAge);
  return !Number.isNaN(age) && age < 15;
}

/**
 * Bottom-to-top numbering across the WHOLE filtered dataset (not just the
 * current page). PrimeNG's p-table body template exposes `rowIndex` as the
 * absolute 0-based index accounting for pagination offset - pass it in
 * from the template as `let-rowIndex="rowIndex"`.
 */
protected rowNumber(rowIndex: number): number {
  return this.rows().length - rowIndex;
}
}
