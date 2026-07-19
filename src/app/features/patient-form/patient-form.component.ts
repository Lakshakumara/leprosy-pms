import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { PatientService } from '../../core/services/patient.service';
import { OrgScopeService } from '../../core/services/org-scope.service';
import { Patient } from '../../core/services/patient.model';

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
  protected readonly orgScope = inject(OrgScopeService);

  protected readonly isEdit = signal(false);
  protected readonly saving = signal(false);
  private existing?: Patient;

  // ── Option lists ───────────────────────────────────────────────────────
  protected readonly sexOptions = [
    { label: 'Male', value: 'Male' },
    { label: 'Female', value: 'Female' }
  ];
  protected readonly classificationOptions = [
    { label: 'MB — Multibacillary', value: 'MB' },
    { label: 'PB — Paucibacillary', value: 'PB' }
  ];
  protected readonly enrollmentStatusOptions = [
    { label: 'Active', value: 'ACTIVE' },
    { label: 'Completed', value: 'COMPLETED' },
    { label: 'Cancelled', value: 'CANCELLED' }
  ];
  protected readonly yesNoOptions = [
    { label: 'Yes', value: true },
    { label: 'No', value: false }
  ];

  /** Facility dropdown sourced from the logged-in user's actual DHIS2 assignment - no hardcoded UIDs. */
  protected readonly facilityOptions = this.orgScope.assignedFacilities;

  protected readonly form = this.fb.nonNullable.group({
    // Identifiers
    alcNum: ['', Validators.required],
    clinicNum: [''],
    nicNum: [''],
    guardianName: [''],

    // Contact
    mobileNum: [''],
    telNum: [''],

    // Demographics
    patientName: ['', Validators.required],
    patientSex: ['Male' as 'Male' | 'Female', Validators.required],
    ethnicGroup: [''],
    patientAge: [''],

    // Enrollment
    orgUnitId: ['', Validators.required],
    enrolledAt: [new Date().toISOString().slice(0, 10), Validators.required],
    enrollmentStatus: ['ACTIVE', Validators.required],

    // FIRST_VISIT clinical fields
    treatmentClassification: ['PB' as 'MB' | 'PB', Validators.required],
    treatmentType: [''],
    caseType: [''],
    disabilityAtDiagnosis: [''],
    ehfScore: [0, [Validators.min(0), Validators.max(12)]],
    timeSinceOnsetMonths: [''],
    yearOfTreatmentCompletion: [''],
    relapse: [''],
    previousTreatmentType: [''],
    changeOfTreatmentType: [''],
    defaulterRestartingTreatment: [''],

    // Contact history
    contactHistory: [false],
    contactHistorySource: [''],

    // Referral
    patientReferredBy: [''],
    nameOfConsultant: [''],
    nameOfMO: [''],

    // Location
    patientDistrict: [''],
    patientMohArea: [''],
    patientPhiArea: [''],
    patientGnDivision: [''],
    patientHomeAddress: [''],
    latitude: [null as number | null],
    longitude: [null as number | null],

    // Deformity
    clawHand: [false],
    footDrop: [''],
    footUlcer: [''],
    eyeInvolvement: [''],
    faceInvolvement: ['']
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
          enrolledAt: found.enrolledAt ? found.enrolledAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
          patientSex: (found.patientSex as 'Male' | 'Female') || 'Male',
          treatmentClassification: (found.treatmentClassification as 'MB' | 'PB') || 'PB',
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

    const facility = this.facilityOptions().find((f) => f.id === v.orgUnitId);

    const patient: Patient = {
      id: this.existing?.id ?? crypto.randomUUID(),
      teiId: this.existing?.teiId,

      alcNum: v.alcNum,
      clinicNum: v.clinicNum,
      nicNum: v.nicNum,
      guardianName: v.guardianName,
      mobileNum: v.mobileNum,
      telNum: v.telNum,
      patientName: v.patientName,
      patientSex: v.patientSex,
      ethnicGroup: v.ethnicGroup,
      patientAge: v.patientAge,

      orgUnitId: v.orgUnitId,
      orgUnitName: facility?.name ?? this.existing?.orgUnitName ?? '',
      enrolledAt: v.enrolledAt,
      enrollmentStatus: v.enrollmentStatus,

      treatmentClassification: v.treatmentClassification,
      treatmentType: v.treatmentType,
      caseType: v.caseType,
      disabilityAtDiagnosis: v.disabilityAtDiagnosis,
      ehfScore: v.ehfScore,
      timeSinceOnsetMonths: v.timeSinceOnsetMonths,
      yearOfTreatmentCompletion: v.yearOfTreatmentCompletion,
      relapse: v.relapse,
      previousTreatmentType: v.previousTreatmentType,
      changeOfTreatmentType: v.changeOfTreatmentType,
      defaulterRestartingTreatment: v.defaulterRestartingTreatment,

      contactHistory: v.contactHistory,
      contactHistorySource: v.contactHistorySource,

      patientReferredBy: v.patientReferredBy,
      nameOfConsultant: v.nameOfConsultant,
      nameOfMO: v.nameOfMO,

      patientDistrict: v.patientDistrict,
      patientMohArea: v.patientMohArea,
      patientPhiArea: v.patientPhiArea,
      patientGnDivision: v.patientGnDivision,
      patientHomeAddress: v.patientHomeAddress,
      latitude: v.latitude ?? undefined,
      longitude: v.longitude ?? undefined,

      clawHand: v.clawHand,
      footDrop: v.footDrop,
      footUlcer: v.footUlcer,
      eyeInvolvement: v.eyeInvolvement,
      faceInvolvement: v.faceInvolvement,

      createdAt: this.existing?.createdAt ?? now,
      updatedAt: now,
      syncStatus: this.existing?.syncStatus ?? 'local-only'
    };

    //await this.patientService.save(patient);
    this.saving.set(false);
    this.router.navigate(['/patients']);
  }
}