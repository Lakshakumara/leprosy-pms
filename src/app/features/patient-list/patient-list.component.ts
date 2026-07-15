import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { TagModule } from 'primeng/tag';
import { PatientService } from '../../core/services/patient.service';
import { PatientFilter } from '../../core/models/patient.model';

@Component({
  selector: 'app-patient-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TableModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    InputNumberModule,
    TagModule
  ],
  templateUrl: './patient-list.component.html',
  styleUrl: './patient-list.component.scss'
})
export class PatientListComponent implements OnInit {
  ngOnInit(): void {  
    this.patientService.pullFromServer(); 
  }
  protected readonly patientService = inject(PatientService);

  protected readonly filter = signal<PatientFilter>({
    search: '',
    classification: 'ALL',
    disabilityGrade: 'ALL',
    syncStatus: 'ALL'
  });

  protected readonly classificationOptions = [
    { label: 'All classifications', value: 'ALL' },
    { label: 'MB — Multibacillary', value: 'MB' },
    { label: 'PB — Paucibacillary', value: 'PB' }
  ];

  protected readonly gradeOptions = [
    { label: 'All grades', value: 'ALL' },
    { label: 'Grade 0', value: '0' },
    { label: 'Grade 1', value: '1' },
    { label: 'Grade 2', value: '2' }
  ];

  protected readonly statusOptions = [
    { label: 'All statuses', value: 'ALL' },
    { label: 'Synced', value: 'synced' },
    { label: 'Pending sync', value: 'pending' },
    { label: 'Local only', value: 'local-only' },
    { label: 'Sync error', value: 'error' }
  ];

  protected readonly rows = computed(() => this.patientService.filtered(this.filter()));

  protected updateFilter<K extends keyof PatientFilter>(key: K, value: PatientFilter[K]): void {
    this.filter.update((f) => ({ ...f, [key]: value }));
  }

  protected async remove(id: string): Promise<void> {
    if (confirm('Remove this patient record from the local device?')) {
      await this.patientService.delete(id);
    }
  }

  protected statusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' {
    switch (status) {
      case 'synced': return 'success';
      case 'pending': return 'warn';
      case 'error': return 'danger';
      default: return 'info';
    }
  }
}
