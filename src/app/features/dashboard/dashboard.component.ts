import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PatientService } from '../../core/delete/patient.service';
import { environment } from '../../../environments/environment';
import { Patient } from '../../core/delete/patient.model';

interface CountRow { label: string; count: number; pct: number; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  protected readonly patientService = inject(PatientService);

  // ── Totals ─────────────────────────────────────────────────────────────────
  protected readonly total = computed(() => this.patientService.patients().length);

  protected readonly mbCount = computed(() =>

    this.patientService.patients().filter(p => p.treatmentClassification === 'MB (>5 lesions)').length
  );
  protected readonly pbCount = computed(() =>
    this.patientService.patients().filter(p => p.treatmentClassification === 'PB (1-5 lesions)' ).length
  );

  protected readonly activeCount = computed(() =>
    this.patientService.patients().filter(p => p.enrollmentStatus === 'ACTIVE').length
  );
  protected readonly completedCount = computed(() =>
    this.patientService.patients().filter(p => p.enrollmentStatus === 'COMPLETED').length
  );

  protected readonly contactHistoryCount = computed(() =>
    this.patientService.patients().filter(p => p.contactHistory).length
  );
  protected readonly relapseCount = computed(() =>
    this.patientService.patients().filter(p => p.relapse && p.relapse !== 'false').length
  );
  protected readonly highEhfCount = computed(() =>
    this.patientService.patients().filter(p => p.ehfScore >= 7).length
  );
  protected readonly grade0Count = computed(() =>
    this.patientService.patients().filter(p => p.disabilityAtDiagnosis === '3').length
  );

  // Recent registrations (last 30 days)
  protected readonly recentCount = computed(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    return this.patientService.patients().filter(p => {
      if (!p.enrolledAt) return false;
      return new Date(p.enrolledAt) >= cutoff;
    }).length;
  });

  // ── By hospital ─────────────────────────────────────────────────────────────
  protected readonly byHospital = computed<CountRow[]>(() => {
    const patients = this.patientService.patients();
    if (!patients.length) return [];
    const map = new Map<string, number>();
    for (const p of patients) {
      const name = p.orgUnitName || environment.FACILITIES.find(f => f.id === p.orgUnitId)?.displayName || p.orgUnitId || 'Unknown';
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    const total = patients.length;
    return [...map.entries()]
      .map(([label, count]) => ({ label, count, pct: Math.round(count / total * 100) }))
      .sort((a, b) => b.count - a.count);
  });

  // ── By MOH area ─────────────────────────────────────────────────────────────
  protected readonly byMoh = computed<CountRow[]>(() => {
    const patients = this.patientService.patients();
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
    const patients = this.patientService.patients();
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
    const patients = this.patientService.patients();
    if (!patients.length) return [];
    const map = new Map<number, number>();
    for (const p of patients) {
      if (!p.enrolledAt) continue;
      const year = new Date(p.enrolledAt).getFullYear();
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
