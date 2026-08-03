// clinic-visit.component.ts
import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { PatientService } from '../../core/services/patient.service';
import { Patient } from '../../core/services/patient.model';
import { BadgeModule } from 'primeng/badge';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { CardModule } from 'primeng/card';
import { ProgressBarModule } from 'primeng/progressbar';
import { Chip } from 'primeng/chip';
import { TreatmentStatus, TreatmentVisit } from './treatment-visit.model';

@Component({
  selector: 'app-clinic-visit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    TagModule,
    ProgressBarModule,
    BadgeModule,
    TooltipModule,
    DialogModule,
    CheckboxModule,
    Chip,
    DatePickerModule,
    SelectModule
  ],
  templateUrl: './clinic-visit.html',
  styleUrl: './clinic-visit.scss',
})
export class ClinicVisitComponent implements OnInit {
  private patientService = inject(PatientService);
  Math = Math;

  // State
  treatmentData = signal<TreatmentStatus[]>([]);
  searchQuery = signal('');
  activeFilter = signal<'all' | 'active' | 'atrisk' | 'defaulter'>('all');
  expandedPatientId = signal<string | null>(null);
  
  // Dialog state
  showVisitDialog = signal(false);
  selectedPatient: TreatmentStatus | null = null;
  visitDate: Date = new Date();
  visitMonth: number = 1;
  isCompleted: boolean = false;

  // Computed
  totalPatients = computed(() => this.treatmentData().length);
  
  activePatients = computed(() => 
    this.treatmentData().filter(p => p.status === 'ACTIVE')
  );
  
  atRiskPatients = computed(() => 
    this.treatmentData().filter(p => p.status === 'AT_RISK')
  );
  
  defaulterPatients = computed(() => 
    this.treatmentData().filter(p => p.status === 'DEFAULTER')
  );

  filteredPatients = computed(() => {
    let patients = this.treatmentData();
    
    if (this.activeFilter() === 'active') {
      patients = patients.filter(p => p.status === 'ACTIVE');
    } else if (this.activeFilter() === 'atrisk') {
      patients = patients.filter(p => p.status === 'AT_RISK');
    } else if (this.activeFilter() === 'defaulter') {
      patients = patients.filter(p => p.status === 'DEFAULTER');
    }
    
    if (this.searchQuery()) {
      const query = this.searchQuery().toLowerCase();
      patients = patients.filter(p => 
        p.alcNumber.toLowerCase().includes(query) ||
        p.patientName.toLowerCase().includes(query)
      );
    }
    
    return patients;
  });

  ngOnInit(): void {
    this.loadData();
  }

  private async loadData(): Promise<void> {
    try {
      const patients = await this.patientService.districtPatients();
      this.treatmentData.set(this.mapToTreatmentStatus(patients));
    } catch (error) {
      console.error('Failed to load treatment data:', error);
    }
  }

  private mapToTreatmentStatus(patients: Patient[]): TreatmentStatus[] {
    return patients.map(p => {
      const totalMonths = p.treatmentType === 'PB' ? 6 : 12;
      const currentMonth = this.calculateCurrentMonth(p.enrolledAt);
      const visits = this.getVisitsForPatient(p);
      const missedVisits = this.calculateMissedVisits(currentMonth, visits.length);
      
      let status: 'ACTIVE' | 'COMPLETED' | 'AT_RISK' | 'DEFAULTER' = 'ACTIVE';
      
      if (currentMonth >= totalMonths) {
        status = 'COMPLETED';
      } else if (missedVisits >= 2) {
        status = 'DEFAULTER';
      } else if (missedVisits >= 1) {
        status = 'AT_RISK';
      }
      
      return {
        alcNumber: p.alcNum || 'N/A',
        patientName: p.patientName || 'Unknown',
        patientId: p.id,
        treatmentType: p.treatmentType === 'PB' ? 'PB' : 'MB',
        mdtStartDate: p.enrolledAt || new Date().toISOString(),
        totalMonths: totalMonths as 6 | 12 | 24 | 36,
        currentMonth: currentMonth,
        visits: visits,
        lastVisitDate: visits.length > 0 ? visits[visits.length - 1].visitDate : undefined,
        missedVisits: missedVisits,
        isDefaulted: status === 'DEFAULTER',
        isAtRisk: status === 'AT_RISK',
        status: status
      };
    });
  }

  private calculateCurrentMonth(startDate: string): number {
    const start = new Date(startDate);
    const now = new Date();
    const months = (now.getFullYear() - start.getFullYear()) * 12 + 
                   (now.getMonth() - start.getMonth());
    return Math.min(months + 1, 36);
  }

  private getVisitsForPatient(patient: Patient): TreatmentVisit[] {
    return [];
  }

  private calculateMissedVisits(currentMonth: number, actualVisits: number): number {
    return Math.max(0, currentMonth - actualVisits);
  }

  getCardStyleClass(status: string): string {
    switch(status) {
      case 'ACTIVE': return 'border-l-4 border-green-500';
      case 'AT_RISK': return 'border-l-4 border-yellow-500';
      case 'DEFAULTER': return 'border-l-4 border-red-500';
      case 'COMPLETED': return 'border-l-4 border-blue-500';
      default: return '';
    }
  }

  // CORRECTED: Using proper severity types for PrimeNG 21
  getStatusSeverity(status: string): 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast' | null | undefined {
    switch(status) {
      case 'ACTIVE': return 'success';
      case 'AT_RISK': return 'warn';
      case 'DEFAULTER': return 'danger';
      case 'COMPLETED': return 'info';
      default: return 'secondary';
    }
  }

  getVisitCellClass(patient: TreatmentStatus, month: number): string {
    if (this.isMonthCompleted(patient, month)) {
      return 'bg-green-100 border-green-400';
    }
    if (this.isMonthMissed(patient, month)) {
      return 'bg-red-100 border-red-400';
    }
    if (month === patient.currentMonth) {
      return 'ring-2 ring-blue-400';
    }
    return 'bg-gray-100 border-gray-300';
  }

  setFilter(filter: 'all' | 'active' | 'atrisk' | 'defaulter'): void {
    this.activeFilter.set(filter);
  }

  applyFilters(): void {}

  getMonthsArray(totalMonths: number): number[] {
    return Array.from({ length: totalMonths }, (_, i) => i + 1);
  }

  isMonthCompleted(patient: TreatmentStatus, month: number): boolean {
    return patient.visits.some(v => v.monthNumber === month && v.isCompleted);
  }

  isMonthMissed(patient: TreatmentStatus, month: number): boolean {
    return !this.isMonthCompleted(patient, month) && 
           patient.visits.some(v => v.monthNumber === month);
  }

  getMonthVisitDate(patient: TreatmentStatus, month: number): string | null {
    const visit = patient.visits.find(v => v.monthNumber === month);
    return visit ? visit.visitDate : null;
  }

  viewDetails(patient: TreatmentStatus): void {
    this.expandedPatientId.set(
      this.expandedPatientId() === patient.patientId ? null : patient.patientId
    );
  }

  openVisitDialog(patient: TreatmentStatus): void {
    this.selectedPatient = patient;
    this.visitDate = new Date();
    this.visitMonth = patient.currentMonth;
    this.isCompleted = true;
    this.showVisitDialog.set(true);
  }

  openMonthVisitDialog(patient: TreatmentStatus, month: number): void {
    if (month > patient.currentMonth) {
      alert('This month is in the future. Please wait for the visit.');
      return;
    }
    if (this.isMonthCompleted(patient, month)) {
      alert('This month has already been marked as completed.');
      return;
    }
    this.selectedPatient = patient;
    this.visitDate = new Date();
    this.visitMonth = month;
    this.isCompleted = true;
    this.showVisitDialog.set(true);
  }

  getAvailableMonths(patient: TreatmentStatus): { label: string, value: number }[] {
    const months = [];
    for (let i = 1; i <= patient.currentMonth; i++) {
      const isCompleted = patient.visits.some(v => v.monthNumber === i && v.isCompleted);
      if (!isCompleted) {
        months.push({ label: `Month ${i}`, value: i });
      }
    }
    return months;
  }

  saveVisit(): void {
    if (!this.selectedPatient || !this.visitDate) {
      return;
    }

    const newVisit: TreatmentVisit = {
      id: `visit-${Date.now()}`,
      patientId: this.selectedPatient.patientId,
      visitDate: this.visitDate.toISOString().split('T')[0],
      monthNumber: this.visitMonth,
      isCompleted: this.isCompleted,
      notes: this.isCompleted ? 'Completed' : 'Missed'
    };

    this.treatmentData.update(data => {
      const patientIndex = data.findIndex(p => p.patientId === this.selectedPatient!.patientId);
      if (patientIndex === -1) return data;
      
      const updatedPatient = {
        ...data[patientIndex],
        visits: [...data[patientIndex].visits, newVisit],
        lastVisitDate: newVisit.visitDate,
        missedVisits: this.calculateMissedVisits(
          data[patientIndex].currentMonth,
          data[patientIndex].visits.length + 1
        )
      };

      if (updatedPatient.missedVisits >= 2) {
        updatedPatient.status = 'DEFAULTER';
        updatedPatient.isDefaulted = true;
        updatedPatient.isAtRisk = false;
      } else if (updatedPatient.missedVisits >= 1) {
        updatedPatient.status = 'AT_RISK';
        updatedPatient.isAtRisk = true;
        updatedPatient.isDefaulted = false;
      }

      const newData = [...data];
      newData[patientIndex] = updatedPatient;
      return newData;
    });

    this.closeVisitDialog();
  }

  closeVisitDialog(): void {
    this.showVisitDialog.set(false);
    this.selectedPatient = null;
    this.visitDate = new Date();
    this.visitMonth = 1;
    this.isCompleted = false;
  }
}