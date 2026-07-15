import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { environment } from '../../../environments/environment';
import { PatientService } from '../../core/services/patient.service';
import { Patient } from '../../core/models/patient.model';

@Component({
  selector: 'app-patient-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    ButtonModule,
    TextareaModule
  ],
  templateUrl: './patient-form.component.html',
  styleUrl: './patient-form.component.scss'
})
export class PatientFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly patientService = inject(PatientService);

  protected readonly isEdit = signal(false);
  protected readonly saving = signal(false);
  private existing?: Patient;

  protected readonly genderOptions = [
    { label: 'Male', value: 'Male' },
    { label: 'Female', value: 'Female' },
    { label: 'Other', value: 'Other' }
  ];
  protected readonly classificationOptions = [
    { label: 'MB — Multibacillary', value: 'MB' },
    { label: 'PB — Paucibacillary', value: 'PB' }
  ];
  protected readonly gradeOptions = [
    { label: 'Grade 0 — no visible disability', value: '0' },
    { label: 'Grade 1 — sensory loss, no visible deformity', value: '1' },
    { label: 'Grade 2 — visible deformity/damage', value: '2' }
  ];

  protected readonly form = this.fb.nonNullable.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    gender: ['Other' as 'Male' | 'Female' | 'Other', Validators.required],
    registeredAt: [new Date(), Validators.required],
    onsetYear: [new Date().getFullYear(), [Validators.required, Validators.min(1950)]],
    classification: ['PB' as 'MB' | 'PB', Validators.required],
    disabilityGrade: ['0' as '0' | '1' | '2'| '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10', Validators.required],
    phoneNumber: [''],
    orgUnitId: [environment.dhis2.orgUnitId],
    address: [''],
    latitude: [null as number | null],
    longitude: [null as number | null],
    notes: ['']
  });

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      const found = await this.patientService.getById(id);
      if (found) {
        this.existing = found;
        this.isEdit.set(true);
        this.form.patchValue({
          ...found,
          //registeredAt: new Date(found.registeredAt),
          latitude: found.latitude ?? null,
          longitude: found.longitude ?? null
        });
      }
    }
  }

  protected useCurrentLocation(): void {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      this.form.patchValue({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    });
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const v = this.form.getRawValue();
    const now = new Date().toISOString();

    const patient: Patient = {
      id: this.existing?.id ?? crypto.randomUUID(),
      teiId: this.existing?.teiId,
      firstName: v.firstName,
      lastName: v.lastName,
      gender: v.gender,
      onsetYear: v.onsetYear,
      classification: v.classification,
     // registeredAt: v.registeredAt,
      disabilityGrade: v.disabilityGrade,
      phoneNumber: v.phoneNumber || undefined,
      orgUnitId: v.orgUnitId || environment.dhis2.orgUnitId,
      address: v.address || undefined,
      latitude: v.latitude ?? undefined,
      longitude: v.longitude ?? undefined,
      notes: v.notes || undefined,
      createdAt: this.existing?.createdAt ?? now,
      updatedAt: now,
      syncStatus: this.existing?.syncStatus ?? 'local-only'
    };

    await this.patientService.save(patient);
    this.saving.set(false);
    this.router.navigate(['/patients']);
  }
}
