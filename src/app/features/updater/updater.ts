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
  template: `
    <div class="patient-update-container">
      <!-- Loading State -->
      @if (loading()) {
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Loading patient data...</p>
        </div>
      }

      <!-- Not Found -->
      @if (notFound()) {
        <div class="not-found">
          <i class="pi pi-user-minus"></i>
          <h3>Patient Not Found</h3>
          <p>The patient you're looking for doesn't exist or has been removed.</p>
          <button class="btn-primary" (click)="goBack()">Back to Registry</button>
        </div>
      }

      <!-- Patient Detail -->
      @if (patient(); as p) {
        <div class="patient-card">
          <!-- Header -->
          <div class="patient-header">
            <div class="header-left">
              <button class="back-btn" (click)="goBack()">
                <i class="pi pi-arrow-left"></i>
              </button>
              <div>
                <h2>{{ p.patientName }}</h2>
                <div class="patient-meta">
                  <span class="alc-badge">#{{ p.alcNum }}</span>
                  <span class="status-badge" [class.status-active]="p.enrollmentStatus === 'ACTIVE'">
                    {{ p.enrollmentStatus || 'Active' }}
                  </span>
                  <span class="facility-badge">
                    <i class="pi pi-building"></i> {{ p.orgUnitName }}
                  </span>
                </div>
              </div>
            </div>
            <div class="header-right">
              <span class="sync-status" [class.synced]="p.syncStatus === 'synced'">
                <i class="pi" [class.pi-check-circle]="p.syncStatus === 'synced'"
                   [class.pi-clock]="p.syncStatus === 'pending'"
                   [class.pi-times-circle]="p.syncStatus === 'error'"></i>
                {{ p.syncStatus || 'Synced' }}
              </span>
            </div>
          </div>

          <!-- EHF Score -->
          <div class="field-group">
            <div class="field-label">
              <label>EHF Score</label>
              <span class="field-hint">(0-12)</span>
            </div>
            <div class="field-input">
              <input type="number" 
                     [(ngModel)]="form.ehfScore" 
                     min="0" 
                     max="12"
                     class="field-control" />
              <button class="btn-save" (click)="save('ehfScore')" 
                      [disabled]="loadingField() === 'ehfScore'">
                @if (loadingField() === 'ehfScore') {
                  <i class="pi pi-spin pi-spinner"></i> Saving...
                } @else {
                  <i class="pi pi-save"></i> Save
                }
              </button>
              @if (getFieldStatus('ehfScore')) {
                <span class="field-status" 
                      [class.status-success]="getFieldStatus('ehfScore') === 'success'"
                      [class.status-error]="getFieldStatus('ehfScore') === 'error'">
                  {{ getFieldStatus('ehfScore') }}
                </span>
              }
            </div>
          </div>

          <!-- Mobile Number -->
          <div class="field-group">
            <div class="field-label">
              <label>Mobile Number</label>
            </div>
            <div class="field-input">
              <input type="tel" 
                     [(ngModel)]="form.mobileNum" 
                     class="field-control"
                     placeholder="Enter mobile number" />
              <button class="btn-save" (click)="save('mobileNum')"
                      [disabled]="loadingField() === 'mobileNum'">
                @if (loadingField() === 'mobileNum') {
                  <i class="pi pi-spin pi-spinner"></i> Saving...
                } @else {
                  <i class="pi pi-save"></i> Save
                }
              </button>
              @if (getFieldStatus('mobileNum')) {
                <span class="field-status" 
                      [class.status-success]="getFieldStatus('mobileNum') === 'success'"
                      [class.status-error]="getFieldStatus('mobileNum') === 'error'">
                  {{ getFieldStatus('mobileNum') }}
                </span>
              }
            </div>
          </div>

          <!-- Treatment Classification -->
          <div class="field-group">
            <div class="field-label">
              <label>Treatment Classification</label>
            </div>
            <div class="field-input">
              <select [(ngModel)]="form.treatmentClassification" class="field-control">
                <option value="MB">MB - Multibacillary</option>
                <option value="PB">PB - Paucibacillary</option>
              </select>
              <button class="btn-save" (click)="save('treatmentClassification')"
                      [disabled]="loadingField() === 'treatmentClassification'">
                @if (loadingField() === 'treatmentClassification') {
                  <i class="pi pi-spin pi-spinner"></i> Saving...
                } @else {
                  <i class="pi pi-save"></i> Save
                }
              </button>
              @if (getFieldStatus('treatmentClassification')) {
                <span class="field-status" 
                      [class.status-success]="getFieldStatus('treatmentClassification') === 'success'"
                      [class.status-error]="getFieldStatus('treatmentClassification') === 'error'">
                  {{ getFieldStatus('treatmentClassification') }}
                </span>
              }
            </div>
          </div>

          <hr class="divider" />

          <!-- Facility Update (Org Unit) -->
          <div class="field-group field-group-highlight">
            <div class="field-label">
              <label>Correct Facility</label>
              <span class="field-hint">Move patient to the correct facility</span>
            </div>
            <div class="field-input facility-field">
              <div class="facility-select-wrapper">
                <i class="pi pi-building facility-icon"></i>
                <select [(ngModel)]="selectedOrgUnitId" class="field-control facility-select">
                  <option value="">Select a facility</option>
                  @for (facility of facilityOptions(); track facility.value) {
                    <option [value]="facility.value" 
                            [class.current-option]="facility.isCurrent">
                      {{ facility.label }} @if (facility.isCurrent) { (Current) }
                    </option>
                  }
                </select>
              </div>
              <button class="btn-move" (click)="fixOrgUnit()"
                      [disabled]="loadingField() === 'orgUnit' || !selectedOrgUnitId || selectedOrgUnitId === patient()?.orgUnitId">
                @if (loadingField() === 'orgUnit') {
                  <i class="pi pi-spin pi-spinner"></i> Moving...
                } @else {
                  <i class="pi pi-arrow-right"></i> Move Patient
                }
              </button>
              @if (getFieldStatus('orgUnit')) {
                <span class="field-status" 
                      [class.status-success]="getFieldStatus('orgUnit') === 'success'"
                      [class.status-error]="getFieldStatus('orgUnit') === 'error'">
                  {{ getFieldStatus('orgUnit') }}
                </span>
              }
            </div>
          </div>

          <!-- Current Facility Info -->
          <div class="current-facility-info">
            <div class="info-item">
              <span class="info-label">Current Facility:</span>
              <span class="info-value">{{ p.orgUnitName }} ({{ p.orgUnitId }})</span>
            </div>
            <div class="info-item">
              <span class="info-label">District:</span>
              <span class="info-value">{{ p.patientDistrict || 'N/A' }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">MOH Area:</span>
              <span class="info-value">{{ p.patientMohArea || 'N/A' }}</span>
            </div>
          </div>

          <!-- Error Messages -->
          @if (errorMessage()) {
            <div class="error-banner">
              <i class="pi pi-exclamation-circle"></i>
              {{ errorMessage() }}
              <button class="error-dismiss" (click)="errorMessage.set(null)">
                <i class="pi pi-times"></i>
              </button>
            </div>
          }

          <!-- Success Messages -->
          @if (successMessage()) {
            <div class="success-banner">
              <i class="pi pi-check-circle"></i>
              {{ successMessage() }}
              <button class="success-dismiss" (click)="successMessage.set(null)">
                <i class="pi pi-times"></i>
              </button>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .patient-update-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }

    .loading-state, .not-found {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 400px;
      text-align: center;
    }

    .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid #f1f5f9;
      border-top: 4px solid #0f766e;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 16px;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .not-found {
      i {
        font-size: 48px;
        color: #94a3b8;
        margin-bottom: 16px;
      }
      h3 { margin: 0 0 8px; color: #0f172a; }
      p { color: #64748b; margin-bottom: 20px; }
    }

    .btn-primary {
      padding: 8px 20px;
      background: #0f766e;
      color: white;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        background: #115e59;
        transform: translateY(-1px);
      }
    }

    .patient-card {
      background: #ffffff;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      border: 1px solid #e2e8f0;
    }

    .patient-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid #f1f5f9;

      .header-left {
        display: flex;
        gap: 12px;
        align-items: flex-start;

        .back-btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 8px;
          border-radius: 8px;
          transition: all 0.2s;
          color: #64748b;

          &:hover {
            background: #f1f5f9;
            color: #0f172a;
          }
        }

        h2 {
          margin: 0 0 4px;
          font-size: 24px;
          color: #0f172a;
        }

        .patient-meta {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;

          .alc-badge {
            font-family: 'JetBrains Mono', monospace;
            font-weight: 700;
            font-size: 13px;
            color: #0f766e;
            background: #f0fdfa;
            padding: 2px 10px;
            border-radius: 999px;
          }

          .status-badge {
            font-size: 12px;
            font-weight: 600;
            padding: 2px 10px;
            border-radius: 999px;
            background: #e2e8f0;
            color: #64748b;

            &.status-active {
              background: #dcfce7;
              color: #15803d;
            }
          }

          .facility-badge {
            font-size: 12px;
            color: #64748b;
            display: flex;
            align-items: center;
            gap: 4px;

            i { font-size: 12px; }
          }
        }
      }

      .header-right {
        .sync-status {
          font-size: 12px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 12px;
          border-radius: 999px;
          background: #f1f5f9;
          color: #64748b;

          &.synced {
            background: #dcfce7;
            color: #15803d;
          }

          i { font-size: 14px; }
        }
      }
    }

    .field-group {
      margin-bottom: 20px;
      padding: 16px;
      border-radius: 8px;
      background: #f8fafc;
      border: 1px solid #f1f5f9;

      &-highlight {
        background: #f0fdfa;
        border-color: #ccfbf1;
      }

      .field-label {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;

        label {
          font-weight: 600;
          font-size: 14px;
          color: #0f172a;
        }

        .field-hint {
          font-size: 12px;
          color: #94a3b8;
        }
      }

      .field-input {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;

        .field-control {
          flex: 1;
          min-width: 150px;
          padding: 8px 12px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          font-size: 14px;
          transition: all 0.2s;
          background: #ffffff;

          &:focus {
            outline: none;
            border-color: #0f766e;
            box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.1);
          }
        }

        .facility-select {
          padding-left: 36px;
          
          .current-option {
            font-weight: 600;
            color: #0f766e;
          }
        }

        .btn-save, .btn-move {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border: none;
          border-radius: 6px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;

          &:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          i { font-size: 14px; }
        }

        .btn-save {
          background: #0f766e;
          color: white;

          &:hover:not(:disabled) {
            background: #115e59;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(15, 118, 110, 0.2);
          }
        }

        .btn-move {
          background: #dc2626;
          color: white;

          &:hover:not(:disabled) {
            background: #b91c1c;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(220, 38, 38, 0.2);
          }
        }

        .field-status {
          font-size: 12px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 4px;
          min-width: 60px;
          text-align: center;

          &.status-success {
            color: #15803d;
            background: #dcfce7;
          }

          &.status-error {
            color: #dc2626;
            background: #fef2f2;
          }
        }
      }

      .facility-field {
        .facility-select-wrapper {
          flex: 1;
          position: relative;
          min-width: 200px;

          .facility-icon {
            position: absolute;
            left: 12px;
            top: 50%;
            transform: translateY(-50%);
            color: #94a3b8;
            z-index: 1;
          }

          select {
            width: 100%;
            appearance: auto;
            cursor: pointer;
            
            option {
              padding: 4px 0;
            }
          }
        }
      }
    }

    .divider {
      margin: 24px 0;
      border: none;
      border-top: 2px solid #f1f5f9;
    }

    .current-facility-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      padding: 16px;
      background: #f8fafc;
      border-radius: 8px;
      margin-bottom: 16px;

      .info-item {
        display: flex;
        flex-direction: column;
        gap: 2px;

        .info-label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #94a3b8;
        }

        .info-value {
          font-size: 14px;
          font-weight: 500;
          color: #0f172a;
        }
      }
    }

    .error-banner, .success-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-radius: 8px;
      margin-top: 16px;
      font-size: 14px;

      i { font-size: 18px; }

      .error-dismiss, .success-dismiss {
        margin-left: auto;
        background: none;
        border: none;
        cursor: pointer;
        opacity: 0.6;
        padding: 4px;

        &:hover { opacity: 1; }
      }
    }

    .error-banner {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;

      i { color: #dc2626; }
    }

    .success-banner {
      background: #f0fdfa;
      color: #0f766e;
      border: 1px solid #ccfbf1;

      i { color: #0f766e; }
    }

    @media (max-width: 640px) {
      .patient-update-container {
        padding: 12px;
      }

      .patient-card {
        padding: 16px;
      }

      .patient-header {
        flex-direction: column;
        gap: 12px;

        .header-right {
          align-self: flex-start;
        }
      }

      .field-group .field-input {
        flex-direction: column;
        align-items: stretch;

        .field-control {
          min-width: unset;
        }

        .btn-save, .btn-move {
          justify-content: center;
        }

        .facility-select-wrapper {
          min-width: unset;
        }
      }

      .current-facility-info {
        grid-template-columns: 1fr;
      }
    }
  `]
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
      await this.updater.changeOrgUnit(patient, facility.value, facility.label);
      
      // Update local patient
      patient.orgUnitId = facility.value;
      patient.orgUnitName = facility.label;
      this.patient.set({ ...patient });
      
      this.fieldStatusMap.update(map => ({ ...map, orgUnit: 'success' }));
      
      // Update facility options
      await this.loadFacilityOptions();
      
      this.successMessage.set(`Patient moved to ${facility.label} successfully ✓`);
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