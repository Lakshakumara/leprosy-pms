import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GoogleMapsModule } from '@angular/google-maps';
import { PatientService } from '../../core/services/patient.service';
import { environment } from '../../../environments/environment';
import { Patient } from '../../core/models/patient.model';

@Component({
  selector: 'app-patient-map',
  standalone: true,
  imports: [CommonModule, GoogleMapsModule],
  templateUrl: './patient-map.component.html',
  styleUrl: './patient-map.component.scss'
})
export class PatientMapComponent implements OnInit {
  protected readonly patientService = inject(PatientService);
  protected readonly hasApiKey = !!environment.googleMapsApiKey;
  protected readonly selected = signal<Patient | null>(null);

  protected readonly center = signal<google.maps.LatLngLiteral>({ lat: 7.8731, lng: 80.7718 }); // Sri Lanka centroid, adjust as needed
  protected readonly zoom = signal(7);

  protected readonly mappable = computed(() =>
    this.patientService.patients().filter((p) => p.latitude != null && p.longitude != null)
  );

  ngOnInit(): void {
    if (!this.hasApiKey) return;
    void this.loadGoogleMapsScript();
  }

  private loadGoogleMapsScript(): Promise<void> {
    return new Promise((resolve) => {
      if ((window as unknown as { google?: unknown }).google) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${environment.googleMapsApiKey}`;
      script.async = true;
      script.onload = () => resolve();
      document.head.appendChild(script);
    });
  }

  protected markerIcon(p: Patient): google.maps.Icon {
    const color = p.classification === 'MB' ? '#b5532c' : '#b08900';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26">
      <circle cx="13" cy="13" r="10" fill="${color}" stroke="white" stroke-width="2"/>
    </svg>`;
    return {
      url: `data:image/svg+xml;base64,${btoa(svg)}`,
      scaledSize: { width: 26, height: 26 } as google.maps.Size
    };
  }

  protected select(p: Patient): void {
    this.selected.set(p);
    this.center.set({ lat: p.latitude!, lng: p.longitude! });
    this.zoom.set(13);
  }
}
