// visit.service.ts
import { Injectable, inject } from '@angular/core';
import { PatientService } from './patient.service';
import { Dhis2Service } from './dhis2.service';
import { LocalStorageService } from './local-storage.service';
import { Patient, SimplifiedVisit } from './patient.model';

@Injectable({ providedIn: 'root' })
export class VisitService {
  private patientService = inject(PatientService);
  private dhis2 = inject(Dhis2Service);
  private localStorage = inject(LocalStorageService);

  /**
   * Record a visit and save to DHIS2
   */
async recordVisit(
  patientId: string,
  visitData: {
    visitNumber: number;
    visitDate: string;
    doseDate?: string;
    reaction?: boolean;
    reactionType?: string;
    reactionTreatment?: string;
    notes?: string;
  }
): Promise<SimplifiedVisit> {
  const patient = await this.patientService.getById(patientId);
  if (!patient) throw new Error('Patient not found');

  const visit: SimplifiedVisit = {
    id: `visit-${Date.now()}`,
    visitNumber: visitData.visitNumber,
    visitDate: visitData.visitDate,
    doseDate: visitData.doseDate || visitData.visitDate,
    reaction: visitData.reaction || false,
    reactionType: visitData.reactionType || '',
    reactionTreatment: visitData.reactionTreatment || '',
    notes: visitData.notes || '',
    syncStatus: 'pending'
  };

  try {
    // Save to DHIS2
    const result = await this.dhis2.saveVisitEventSafe(patient, visitData);
    
    if (result.success) {
      visit.id = result.eventId;
      visit.syncStatus = 'synced';
    }

    // Update local patient record
    const updatedPatient = await this.updateLocalPatient(patient, visit);
    return visit;

  } catch (error: any) {
    console.error('Failed to save visit:', error);
    
    // Save locally with pending status
    visit.syncStatus = 'pending';
    await this.updateLocalPatient(patient, visit);
    
    // Show user-friendly message
    const message = error?.message || 'Failed to save visit to DHIS2. Saved locally and will sync later.';
    throw new Error(message);
  }
}


  ///////////

  /**
   * Update local patient with new visit
   */
  private async updateLocalPatient(patient: Patient, visit: SimplifiedVisit): Promise<Patient> {
    // Update visits array
    const visits = [...(patient.visits || [])];
    const existingIndex = visits.findIndex(v => v.visitNumber === visit.visitNumber);
    
    if (existingIndex >= 0) {
      visits[existingIndex] = visit;
    } else {
      visits.push(visit);
    }

    // Sort by visit number
    visits.sort((a, b) => a.visitNumber - b.visitNumber);

    // Update derived fields
    const updatedPatient = this.calculateDerivedFields(patient, visits);
    
    // Save to local storage
    await this.localStorage.savePatient(updatedPatient);
    
    return updatedPatient;
  }

  /**
   * Calculate derived fields from visits
   */
  private calculateDerivedFields(patient: Patient, visits: SimplifiedVisit[]): Patient {
    if (visits.length === 0) return patient;

    const sortedVisits = [...visits].sort((a, b) => a.visitNumber - b.visitNumber);
    const firstVisit = sortedVisits[0];
    const lastVisit = sortedVisits[sortedVisits.length - 1];

    let treatmentStartDate = patient.treatmentStartDate || firstVisit.visitDate;
    let treatmentEndDate = patient.treatmentEndDate || '';
    let treatmentStatus: Patient['treatmentStatus'] = patient.treatmentStatus || 'ongoing';
    let nextVisitDate = patient.nextVisitDate || '';

    // Update treatment dates
    if (sortedVisits.length >= 12) {
      treatmentStatus = 'completed';
      treatmentEndDate = lastVisit.visitDate;
      nextVisitDate = '';
    } else {
      treatmentStatus = 'ongoing';
      // Calculate expected end date
      const start = new Date(treatmentStartDate);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 12);
      end.setDate(end.getDate() - 1);
      treatmentEndDate = end.toISOString().split('T')[0];
      
      // Calculate next visit date (1 month after last visit)
      const next = new Date(lastVisit.visitDate);
      next.setMonth(next.getMonth() + 1);
      nextVisitDate = next.toISOString().split('T')[0];
    }

    return {
      ...patient,
      visits: visits,
      treatmentStartDate: treatmentStartDate,
      treatmentEndDate: treatmentEndDate,
      treatmentStatus: treatmentStatus,
      nextVisitDate: nextVisitDate,
      lastVisitDate: lastVisit.visitDate,
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Sync pending visits to DHIS2
   */
  async syncPendingVisits(patientId: string): Promise<void> {
    const patient = await this.patientService.getById(patientId);
    if (!patient) return;

    const pendingVisits = (patient.visits || []).filter(v => v.syncStatus === 'pending');

    for (const visit of pendingVisits) {
      try {
        const result = await this.dhis2.saveVisitEventWithTracker(patient, {
          visitNumber: visit.visitNumber,
          visitDate: visit.visitDate,
          doseDate: visit.doseDate,
          reaction: visit.reaction,
          reactionType: visit.reactionType,
          reactionTreatment: visit.reactionTreatment,
          notes: visit.notes
        });

        if (result.success) {
          visit.id = result.eventId;
          visit.syncStatus = 'synced';
        }
      } catch (error) {
        console.error(`Failed to sync visit ${visit.visitNumber}:`, error);
      }
    }

    // Save updated patient
    await this.localStorage.savePatient(patient);
  }

  /**
   * Get visit status for a patient
   */
  getVisitStatus(patient: Patient): {
    completed: number;
    remaining: number;
    nextVisitNumber: number;
    isComplete: boolean;
    progress: number;} 
    {
    const visits = patient.visits || [];
    const completed = visits.length;
    const remaining = Math.max(0, 12 - completed);
    const isComplete = completed >= 12;
    const progress = Math.round((completed / 12) * 100);
    const nextVisitNumber = isComplete ? 0 : completed + 1;

    return {
      completed,
      remaining,
      nextVisitNumber,
      isComplete,
      progress
    };
  }
}