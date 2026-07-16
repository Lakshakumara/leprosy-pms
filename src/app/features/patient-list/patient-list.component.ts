import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select'; import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { PatientService } from '../../core/delete/patient.service';
import { PatientFilter } from '../../core/delete/patient.model';
import { environment } from '../../../environments/environment';
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
    protected readonly patientService = inject(PatientService);
    protected readonly filter = signal<PatientFilter>({
        search: '',
        classification: 'ALL',
        orgUnitId: 'ALL',
        mohArea: 'ALL',
        phiArea: 'ALL',
        gnDivision: 'ALL',
    });
    protected readonly showFilters = signal(false);
    protected readonly filtersLoading = signal(true);
    // ── Static filter options ─────────────────────────────────────────────────
    protected readonly classificationOptions: SelectOption[] = [
        { label: 'All classifications', value: 'ALL' },
        { label: 'MB — Multibacillary', value: 'MB (>5 lesions)' },
        { label: 'PB — Paucibacillary', value: 'PB (1-5 lesions)' },
    ];
    protected readonly hospitalOptions: SelectOption[] = [
        { label: 'All hospitals', value: 'ALL' },
        ...environment.FACILITIES.map(f => ({ label: f.displayName, value: f.id })),
    ];
    // ── Dynamic filter options (from IndexedDB distinct values) ───────────────
    protected mohAreaOptions = signal<SelectOption[]>([{ label: 'All MOH areas', value: 'ALL' }]);
    protected phiAreaOptions = signal<SelectOption[]>([{ label: 'All PHI areas', value: 'ALL' }]);
    protected gnDivisionOptions = signal<SelectOption[]>([{ label: 'All GN divisions', value: 'ALL' }]);
    // ── Filtered rows ─────────────────────────────────────────────────────────
    protected readonly rows = computed(() => this.patientService.filtered(this.filter()));
    protected readonly activeFilterCount = computed(() => {
        const f = this.filter();
        let count = 0;
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
        const [moh, phi, gn] = await Promise.all([
            this.patientService.getDistinctValues('patientMohArea'),
            this.patientService.getDistinctValues('patientPhiArea'),
            this.patientService.getDistinctValues('patientGnDivision'),
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
            search: '',
            classification: 'ALL',
            orgUnitId: 'ALL',
            mohArea: 'ALL',
            phiArea: 'ALL',
            gnDivision: 'ALL',
        });
    }

    protected async syncNow(): Promise<void> {
        await this.patientService.pullFromServer();
        await this.loadDistinctValues();
    }

    protected classBadge(cls: string): string {
        if (!cls) return 'badge--unknown';
        return cls.toUpperCase() === 'MB' ? 'badge--mb' : 'badge--pb';
    }
    protected enrolledDaysAgo(enrolledAt: string): number {
        if (!enrolledAt) return 0;
        const ms = Date.now() - new Date(enrolledAt).getTime();
        return Math.floor(ms / (1000 * 60 * 60 * 24));
    }
}
