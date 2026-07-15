import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PatientService } from '../../core/services/patient.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  protected readonly patientService = inject(PatientService);

  protected readonly total = computed(() => this.patientService.patients().length);
  protected readonly mbCount = computed(
    () => this.patientService.patients().filter((p) => p.classification === 'MB').length
  );
  protected readonly pbCount = computed(
    () => this.patientService.patients().filter((p) => p.classification === 'PB').length
  );
  protected readonly grade2Count = computed(
    () => this.patientService.patients().filter((p) => p.disabilityGrade === '2').length
  );

  protected readonly byYear = computed(() => {
    const map = new Map<number, number>();
    for (const p of this.patientService.patients()) {
      map.set(p.onsetYear, (map.get(p.onsetYear) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  });

  protected readonly maxYearCount = computed(() => Math.max(1, ...this.byYear().map(([, c]) => c)));
}
