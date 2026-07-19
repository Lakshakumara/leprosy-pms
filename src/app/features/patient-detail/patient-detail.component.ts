import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PatientService } from '../../core/services/patient.service';
import { Patient } from '../../core/services/patient.model';
import { environment } from '../../../environments/environment';
import { DeviceStorageService } from '../../core/services/device-storage.service';

@Component({
  selector: 'app-patient-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './patient-detail.component.html',
  styleUrl:    './patient-detail.component.scss',
})
export class PatientDetailComponent implements OnInit {
  private readonly route  = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly storage = inject(DeviceStorageService)
  private readonly patientService = inject(PatientService);

  protected readonly patient = signal<Patient | null>(null);
  protected readonly loading  = signal(true);
  protected readonly notFound = signal(false);

  /** Resolve the facility display name from the environment FACILITIES list. */
  protected facilityName(orgUnitId: string): string {
    return this.storage.getFacilities().find((f:any) => f.id === orgUnitId)?.displayName ?? orgUnitId;
  }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/patients']);
      return;
    }

    const found = await this.patientService.getById(id);
    if (found) {
      this.patient.set(found);
    } else {
      this.notFound.set(true);
    }
    this.loading.set(false);
  }
}
