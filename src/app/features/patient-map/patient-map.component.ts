import { Component, inject, computed, signal, OnInit, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PatientService } from '../../core/services/patient.service';
import { Patient } from '../../core/services/patient.model';

/**
 * Free map view using Leaflet + OpenStreetMap tiles - no API key, no
 * billing account, no signup required at all. Genuinely free, unlike
 * Google Maps (which needs a billing account on file even for free-tier
 * usage) or Firebase Cloud Functions (needs Blaze plan for external calls).
 *
 * Install: npm install leaflet @types/leaflet --save
 */
@Component({
  selector: 'app-patient-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './patient-map.component.html',
  styleUrl: './patient-map.component.scss'
})
export class PatientMapComponent implements OnInit, AfterViewInit {
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef<HTMLDivElement>;

  public readonly patientService = inject(PatientService);
  protected readonly selected = signal<Patient | null>(null);

  protected readonly mappable = computed(() =>
    this.patientService.patients().filter((p) => p.latitude != null && p.longitude != null)
  );

  private map: any;
  private markers: any[] = [];

  ngOnInit(): void {}

  async ngAfterViewInit(): Promise<void> {
    const L = await import('leaflet');

    // Sri Lanka centroid as default view
    this.map = L.map(this.mapContainer.nativeElement).setView([7.8731, 80.7718], 7);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(this.map);

    this.renderMarkers(L);
  }

  private renderMarkers(L: typeof import('leaflet')): void {
    for (const m of this.markers) m.remove();
    this.markers = [];

    for (const p of this.mappable()) {
      const isMb = p.treatmentClassification?.toUpperCase().startsWith('MB');
      const color = isMb ? '#b5532c' : '#b08900';

      const icon = L.divIcon({
        className: '',
        html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>`,
        iconSize: [16, 16]
      });

      const marker = L.marker([p.latitude!, p.longitude!], { icon }).addTo(this.map);
      marker.on('click', () => this.selected.set(p));
      this.markers.push(marker);
    }
  }
}