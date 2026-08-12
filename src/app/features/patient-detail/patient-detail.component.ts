import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PatientService } from '../../core/services/patient.service';
import { Patient } from '../../core/services/patient.model';
import { DeviceStorageService } from '../../core/services/device-storage.service';
import { MobileHeaderService } from '../../core/services/mobile-header.service';
import { DISABILITY_CONVERSION, DISABILITY_MAP } from '../../core/util/util';

@Component({
  selector: 'app-patient-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './patient-detail.component.html',
  styleUrl: './patient-detail.component.scss',
})
export class PatientDetailComponent implements OnInit, OnDestroy {
  private mobileHeader = inject(MobileHeaderService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly storage = inject(DeviceStorageService)
  private readonly patientService = inject(PatientService);

  protected readonly patient = signal<Patient | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);

  /** Resolve the facility display name from the environment FACILITIES list. */
  protected facilityName(orgUnitId: string): string {
    return this.storage.getFacilities().find((f: any) => f.id === orgUnitId)?.displayName ?? orgUnitId;
  }

  async ngOnInit(): Promise<void> {
    setTimeout(() => {
      this.setupMobileHeader();
    }, 50);

    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/patients']);
      return;
    }

    const found = await this.patientService.getById(id);
    if (found) {
      console.log(found)
      this.patient.set(found);
    } else {
      this.notFound.set(true);
    }
    this.loading.set(false);
  }

  private setupMobileHeader(): void {
    const p = this.patient();
    if (!p) return;

    // Build subtext or IDs string
    const ids = [
      p.alcNum ? `${p.alcNum}` : null,
      p.clinicNum ? `Clinic: ${p.clinicNum}` : null,
      p.nicNum ? `NIC: ${p.nicNum}` : null
    ].filter(Boolean).join(' | ');

    this.mobileHeader.set({
      title: p.patientName || '(no name)',
      subtitle: ids || p.enrollmentStatus || 'Unknown',
      backRoute: '/patients', // 👈 Enables top-left back arrow button
      actions: [
        // Optional quick actions (e.g., Edit Patient)
        {
          icon: 'pi pi-pencil',
          label: 'Edit',
          command: () => this.editPatient()
        }
      ]
    });
  }

  ngOnDestroy(): void {
    // Reset back to default mobile header state when leaving details view
    this.mobileHeader.clear();
  }

  editPatient(): void {
    // Edit logic...
  }
  getDisabilityText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return DISABILITY_MAP.get(String(value).trim()) ?? '';
}
}
