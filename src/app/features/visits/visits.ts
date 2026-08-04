import { Component, inject, signal, OnInit, output, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { VisitService } from '../../core/services/visit.service';

@Component({
  selector: 'app-visit-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="visit-container">
      <div class="visit-header">
        <h2>Visit {{ visitNumber }} of 12</h2>
        <div class="progress-bar">
          <div class="progress-fill" [style.width.%]="(visitNumber/12)*100"></div>
          <span>{{ visitNumber }}/12</span>
        </div>
      </div>

      <form (ngSubmit)="submitVisit()" #visitForm="ngForm">
        <!-- Visit Date -->
        <div class="form-group">
          <label>Visit Date *</label>
          <input 
            type="date" 
            [(ngModel)]="formData.visitDate" 
            name="visitDate"
            required
          >
        </div>

        <!-- Dose Date (if different from visit date) -->
        <div class="form-group">
          <label>Date of Dose</label>
          <input 
            type="date" 
            [(ngModel)]="formData.doseDate" 
            name="doseDate"
          >
          <small class="help-text">Leave blank if same as visit date</small>
        </div>

        <!-- Reaction -->
        <div class="form-group">
          <label>Reaction?</label>
          <select [(ngModel)]="formData.reaction" name="reaction">
            <option [value]="null">No</option>
            <option [value]="true">Yes</option>
          </select>
        </div>

        <!-- Reaction details (conditional) -->
        @if (formData.reaction === true) {
          <div class="form-group nested">
            <label>Reaction Type</label>
            <select [(ngModel)]="formData.reactionType" name="reactionType">
              <option value="">Select</option>
              <option value="Type 1">Type 1 (Reversal)</option>
              <option value="Type 2">Type 2 (ENL)</option>
              <option value="Type 3">Type 3 (Lucio)</option>
            </select>
          </div>

          <div class="form-group nested">
            <label>Treatment Given</label>
            <input 
              type="text" 
              [(ngModel)]="formData.reactionTreatment" 
              name="reactionTreatment"
              placeholder="e.g., Prednisolone, Thalidomide"
            >
          </div>
        }

        <!-- Notes -->
        <div class="form-group">
          <label>Notes / Remarks</label>
          <textarea 
            [(ngModel)]="formData.notes" 
            name="notes"
            rows="3"
            placeholder="Any special remarks about this visit..."
          ></textarea>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn-primary" [disabled]="!visitForm.valid || isSubmitting">
            {{ isSubmitting ? 'Saving...' : 'Record Visit' }}
          </button>
          <button type="button" class="btn-secondary" (click)="cancel()">Cancel</button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .visit-container {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .visit-header {
      margin-bottom: 24px;
    }
    .progress-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 8px;
      background: #e5e7eb;
      border-radius: 4px;
      height: 24px;
      overflow: hidden;
      position: relative;
    }
    .progress-fill {
      height: 100%;
      background: #0b4f4a;
      transition: width 0.3s ease;
    }
    .progress-bar span {
      position: absolute;
      right: 8px;
      font-size: 12px;
      font-weight: 600;
      color: #374151;
    }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      margin-bottom: 4px;
      font-weight: 500;
    }
    .form-group input,
    .form-group select,
    .form-group textarea {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
    }
    .form-group.nested {
      padding-left: 20px;
      border-left: 3px solid #f59e0b;
    }
    .help-text {
      color: #6b7280;
      font-size: 12px;
      display: block;
      margin-top: 4px;
    }
    .form-actions {
      display: flex;
      gap: 12px;
      margin-top: 24px;
    }
    .btn-primary {
      flex: 1;
      padding: 10px 20px;
      background: #0b4f4a;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
    }
    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .btn-secondary {
      padding: 10px 20px;
      background: #f3f4f6;
      color: #374151;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      cursor: pointer;
    }
  `]
})
export class VisitFormComponent implements OnInit {
  private visitService = inject(VisitService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // ── Inputs ─────────────────────────────────────────────
  @Input() patientId = '';
  @Input() visitNumber = 1;
  @Input() isModal = false; // If true, don't redirect

  // ── Outputs ─────────────────────────────────────────────
  onVisitSaved = output<{ visitNumber: number; visitData: any }>();
  onCancel = output<void>();

  // ── State ───────────────────────────────────────────────
  isSubmitting = false;
  errorMessage = '';

  formData = {
    visitDate: '',
    doseDate: '',
    reaction: null as boolean | null,
    reactionType: '',
    reactionTreatment: '',
    notes: ''
  };

  ngOnInit(): void {
    // If patientId is not provided via Input, try from route params
    if (!this.patientId) {
      this.route.params.subscribe(params => {
        this.patientId = params['patientId'] || '';
        this.visitNumber = Number(params['visitNumber']) || 1;
        this.setDefaultDate();
      });
    } else {
      this.setDefaultDate();
    }
  }

  private setDefaultDate(): void {
    if (!this.formData.visitDate) {
      this.formData.visitDate = new Date().toISOString().split('T')[0];
    }
  }

 async submitVisit(): Promise<void> {
    if (!this.patientId) {
      this.errorMessage = 'Patient ID is required';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';

    try {
      const visitData = {
        visitNumber: this.visitNumber,
        visitDate: this.formData.visitDate,
        doseDate: this.formData.doseDate || this.formData.visitDate,
        reaction: this.formData.reaction || false,
        reactionType: this.formData.reactionType,
        reactionTreatment: this.formData.reactionTreatment,
        notes: this.formData.notes
      };

      // Record the visit (saves to DHIS2 and local)
      const savedVisit = await this.visitService.recordVisit(this.patientId, visitData);

      // Emit event with saved data
      this.onVisitSaved.emit({
        visitNumber: this.visitNumber,
        visitData: savedVisit
      });

      // Only redirect if not in modal mode
      if (!this.isModal) {
        this.router.navigate(['/patients', this.patientId]);
      }

    } catch (error: any) {
      console.error('Failed to record visit:', error);
      this.errorMessage = error.message || 'Failed to record visit. Please try again.';
      
      // Optionally, retry syncing later
      if (navigator.onLine) {
        alert('Visit saved locally but failed to sync to DHIS2. It will be synced automatically when online.');
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  cancel(): void {
    // Emit cancel event
    this.onCancel.emit();

    // Only redirect if not in modal mode
    if (!this.isModal) {
      this.router.navigate(['/patients', this.patientId]);
    }
  }

  // Helper method to reset form
  resetForm(): void {
    this.formData = {
      visitDate: new Date().toISOString().split('T')[0],
      doseDate: '',
      reaction: null,
      reactionType: '',
      reactionTreatment: '',
      notes: ''
    };
    this.errorMessage = '';
    this.isSubmitting = false;
  }

  // Helper to set visit data from parent
  setVisitData(data: Partial<typeof this.formData>): void {
    this.formData = { ...this.formData, ...data };
  }
}