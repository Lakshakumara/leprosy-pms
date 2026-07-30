// patient-update.component.ts
import { Component, inject, Input, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Dhis2UpdaterService } from '../../core/services/dhis2-updater.service';
import { Patient } from '../../core/services/patient.model';
import { ActivatedRoute, Router } from '@angular/router';
import { DeviceStorageService } from '../../core/services/device-storage.service';
import { PatientService } from '../../core/services/patient.service';
import { OrgScopeService } from '../../core/services/org-scope.service';

interface FacilityOption {
  label: string;
  value: string;
  isCurrent?: boolean;
}

@Component({
  selector: 'app-patient-update',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './updater.html',
  styleUrl: './updater.scss',
})
export class PatientUpdateComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly storage = inject(DeviceStorageService);
  private readonly patientService = inject(PatientService);
  private readonly orgScopeService = inject(OrgScopeService);
  private readonly updater = inject(Dhis2UpdaterService);

  // State
  protected readonly patient = signal<Patient | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly loadingField = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);

  // Field status tracking - use a signal with Record type
  private readonly fieldStatusMap = signal<Record<string, 'success' | 'error' | 'idle'>>({});

  // Form data
  protected form: any = {};
  protected selectedOrgUnitId = '';
  protected facilityOptions = signal<FacilityOption[]>([]);

  // Method to get field status - FIXED: returns string or null
  protected getFieldStatus(field: string): 'success' | 'error' | 'idle' | null {
    return this.fieldStatusMap()[field] || null;
  }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/patients']);
      return;
    }

    const field = this.route.snapshot.paramMap.get('field'); // e.g. "location" or null

  if (field === 'location') {
    // scroll to map, open location tab
  }
    await this.loadPatient(id);
  }

  private async loadPatient(id: string): Promise<void> {
    try {
      const found = await this.patientService.getById(id);
      if (found) {
        this.patient.set(found);
        this.initializeForm(found);
        await this.loadFacilityOptions();
      } else {
        this.notFound.set(true);
      }
    } catch (error) {
      console.error('Error loading patient:', error);
      this.errorMessage.set('Failed to load patient data');
    } finally {
      this.loading.set(false);
    }
  }

  private initializeForm(patient: Patient): void {
    this.form = {
      ehfScore: patient.ehfScore,
      mobileNum: patient.mobileNum,
      treatmentClassification: patient.treatmentClassification
    };
    this.selectedOrgUnitId = patient.orgUnitId;
  }

  private async loadFacilityOptions(): Promise<void> {
    try {
      // Get facilities from OrgScopeService
      const facilities = this.orgScopeService.assignedFacilities();
      const currentPatient = this.patient();

      if (!currentPatient) return;

      const options: FacilityOption[] = facilities.map(f => ({
        label: f.name,
        value: f.id,
        isCurrent: f.id === currentPatient.orgUnitId
      }));

      // If current facility isn't in the list, add it
      if (!options.some(o => o.value === currentPatient.orgUnitId)) {
        options.unshift({
          label: currentPatient.orgUnitName || currentPatient.orgUnitId,
          value: currentPatient.orgUnitId,
          isCurrent: true
        });
      }

      // Sort: current first, then alphabetically
      options.sort((a, b) => {
        if (a.isCurrent) return -1;
        if (b.isCurrent) return 1;
        return a.label.localeCompare(b.label);
      });

      this.facilityOptions.set(options);
    } catch (error) {
      console.error('Error loading facility options:', error);
      // Fallback: add current facility only
      const currentPatient = this.patient();
      if (currentPatient) {
        this.facilityOptions.set([{
          label: currentPatient.orgUnitName || currentPatient.orgUnitId,
          value: currentPatient.orgUnitId,
          isCurrent: true
        }]);
      }
    }
  }

  protected getSelectedFacilityLabel(): string {
    const facility = this.facilityOptions().find(f => f.value === this.selectedOrgUnitId);
    return facility?.label || 'Select a facility';
  }

  protected getSelectedFacility(): FacilityOption | undefined {
    return this.facilityOptions().find(f => f.value === this.selectedOrgUnitId);
  }

  protected async save(field: keyof Patient): Promise<void> {
    const currentPatient = this.patient();
    if (!currentPatient) return;

    const newValue = this.form[field as string];
    const currentValue = currentPatient[field as keyof Patient];

    // Check if value changed
    if (String(newValue) === String(currentValue)) {
      this.successMessage.set(`No change needed for ${field}`);
      setTimeout(() => this.successMessage.set(null), 3000);
      return;
    }

    this.loadingField.set(field as string);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await this.updater.updateSingleField(currentPatient, field, newValue);

      // Update local patient
      (currentPatient as any)[field] = newValue;
      this.patient.set({ ...currentPatient });

      // Update field status - FIXED: using proper update
      this.fieldStatusMap.update(map => ({ ...map, [field]: 'success' }));

      this.successMessage.set(`${this.getFieldLabel(field)} updated successfully ✓`);
      setTimeout(() => this.successMessage.set(null), 3000);
    } catch (error: any) {
      this.fieldStatusMap.update(map => ({ ...map, [field]: 'error' }));
      this.errorMessage.set(`Failed to update ${this.getFieldLabel(field)}: ${error.message}`);
      console.error('Update error:', error);
    } finally {
      this.loadingField.set(null);
    }
  }

  protected async fixOrgUnit(): Promise<void> {
    const currentPatient = this.patient();
    if (!currentPatient) return;

    if (this.selectedOrgUnitId === currentPatient.orgUnitId) {
      this.successMessage.set('Patient already assigned to this facility');
      setTimeout(() => this.successMessage.set(null), 3000);
      return;
    }

    const selectedFacility = this.getSelectedFacility();
    if (!selectedFacility) {
      this.errorMessage.set('Please select a facility');
      return;
    }

    // Confirm with user
    if (!confirm(`Are you sure you want to move ${currentPatient.patientName} (${currentPatient.alcNum}) from "${currentPatient.orgUnitName}" to "${selectedFacility.label}"?`)) {
      return;
    }

    await this.performOrgUnitMove(currentPatient, selectedFacility);
  }


  private async performOrgUnitMove(patient: Patient, facility: FacilityOption): Promise<void> {
    this.loadingField.set('orgUnit');
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
        // Use the COMPLETE method - updates EVERYTHING including Program Owner
        await this.updater.changeOrgUnitComplete(patient, facility.value, facility.label);
        
        // Update local patient
        patient.orgUnitId = facility.value;
        patient.orgUnitName = facility.label;
        this.patient.set({ ...patient });
        
        this.fieldStatusMap.update(map => ({ ...map, orgUnit: 'success' }));
        await this.loadFacilityOptions();
        
        this.successMessage.set(`✅ Patient moved to ${facility.label} successfully!`);
        setTimeout(() => this.successMessage.set(null), 3000);
        
    } catch (error: any) {
        this.fieldStatusMap.update(map => ({ ...map, orgUnit: 'error' }));
        this.errorMessage.set(`Move failed: ${error.message}`);
        console.error('Org unit move error:', error);
    } finally {
        this.loadingField.set(null);
    }
}


private async performOrgUnitMovefromVisits(patient: Patient, facility: FacilityOption): Promise<void> {
    this.loadingField.set('orgUnit');
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
        // Use the main changeOrgUnit method (updates ENROLLMENT)
        await this.updater.changeOrgUnit(patient, facility.value, facility.label);
        
        // Update local patient
        patient.orgUnitId = facility.value;
        patient.orgUnitName = facility.label;
        this.patient.set({ ...patient });
        
        this.fieldStatusMap.update(map => ({ ...map, orgUnit: 'success' }));
        await this.loadFacilityOptions();
        
        this.successMessage.set(`✅ Patient moved to ${facility.label} successfully!`);
        setTimeout(() => this.successMessage.set(null), 3000);
        
    } catch (error: any) {
        this.fieldStatusMap.update(map => ({ ...map, orgUnit: 'error' }));
        this.errorMessage.set(`Move failed: ${error.message}`);
        console.error('Org unit move error:', error);
    } finally {
        this.loadingField.set(null);
    }
}

  private getFieldLabel(field: string): string {
    const labels: Record<string, string> = {
      ehfScore: 'EHF Score',
      mobileNum: 'Mobile Number',
      treatmentClassification: 'Treatment Classification',
      orgUnit: 'Facility'
    };
    return labels[field] || field;
  }

  protected goBack(): void {
    this.router.navigate(['/patients']);
  }

}