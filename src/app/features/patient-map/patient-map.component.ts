import { Component, inject, computed, signal, OnInit, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PatientService } from '../../core/services/patient.service';
import { Dhis2Service, OrgUnitGeometry } from '../../core/services/dhis2.service';
import { OrgScopeService } from '../../core/services/org-scope.service';
import { Patient } from '../../core/services/patient.model';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';

/**
 * Free map view using Leaflet + OpenStreetMap tiles - no API key, no
 * billing account required.
 *
 * Layers:
 *  - District boundary (real polygon geometry pulled live from DHIS2 -
 *    confirmed Ratnapura RDHS has this; other districts may or may not,
 *    handled gracefully if geometry is missing)
 *  - MOH area layer - attempts to fetch geometry per MOH-area org unit
 *    under the district. If DHIS2 doesn't have polygon data for these yet,
 *    this layer is simply empty (no error) - manualDsGeoJson below is the
 *    slot for dropping in real boundary data later from any source
 *    (Survey Dept, HDX, etc.) without touching the rest of this component.
 *  - One layer per year (2022-2026), color-coded, each patient marker has
 *    a popup with ALC number / name / address. Leaflet's layer control
 *    renders as a toggle menu in the map corner.
 *
 * Install: npm install leaflet @types/leaflet --save
 * Also add "node_modules/leaflet/dist/leaflet.css" to angular.json's styles array.
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

  protected readonly patientService = inject(PatientService);
  private readonly dhis2 = inject(Dhis2Service);
  private readonly orgScope = inject(OrgScopeService);
  private readonly http = inject(HttpClient);

  protected readonly selected = signal<Patient | null>(null);
  protected readonly districtLoadError = signal<string | null>(null);

  protected readonly mappable = computed(() =>
    this.patientService.districtPatients().filter((p) => p.latitude != null && p.longitude != null)
  );

  /**
   * SLOT FOR MANUALLY-SUPPLIED MOH BOUNDARY DATA.
   * If DHIS2 doesn't have MOH-area geometry yet, paste real GeoJSON
   * FeatureCollection here (each Feature needs a `name` property) and it
   * will render exactly like DHIS2-sourced boundaries would. Leave as null
   * until you have real data - the layer will just be empty, no error.
   */
  private readonly manualDsGeoJson: GeoJSON.FeatureCollection | null = null;
  private manualMohGeoJson: GeoJSON.FeatureCollection | null = null;

  private readonly yearColors: Record<number, string> = {
    2026: '#1d4ed8', // blue
    2025: '#b5532c', // clay red
    2024: '#b08900', // gold
    2023: '#0d9488', // teal
    2022: '#7c3aed'  // purple
  };
  private readonly dsAreaPalette = [
    '#1d4ed8', '#b5532c', '#b08900', '#0d9488', '#7c3aed',
    '#dc2626', '#059669', '#ea580c', '#4f46e5', '#0891b2'
  ];

  private readonly mohAreaPalette = [
    '#1d4ed8', '#b5532c', '#b08900', '#0d9488', '#7c3aed',
    '#dc2626', '#059669', '#ea580c', '#4f46e5', '#0891b2'
  ];
  private map: any;
  private L!: typeof import('leaflet');

  ngOnInit(): void { }

  async ngAfterViewInit(): Promise<void> {
    // Leaflet is a CommonJS/UMD package. Angular's dev server and its
    // production esbuild bundler can resolve `await import('leaflet')`
    // differently - dev may return the Leaflet namespace directly, while
    // the production bundle can wrap it as { default: <namespace> }
    // instead. Normalizing here handles both shapes, rather than assuming
    // one - this is exactly why "L.map is not a function" only showed up
    // after deploying, not in `ng serve`.
    const leafletModule: any = await import('leaflet');
    this.L = (leafletModule.default ?? leafletModule) as typeof import('leaflet');
    const L = this.L;

    this.map = L.map(this.mapContainer.nativeElement, {
      // Prevent zooming out to see the whole world/country - keeps focus
      // on the district once we fit bounds to it below.
      minZoom: 9
    }).setView([7.8731, 80.7718], 7); // temporary fallback center until district loads

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(this.map);

    const overlays: Record<string, any> = {};

    // ── District boundary + cutout mask ─────────────────────────────────
    const districtLayer = await this.loadDistrictBoundary(L);
    if (districtLayer) {
      const dot = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background-color:#0b4f4a;margin-right:6px;vertical-align:middle;"></span>`;
      overlays[`${dot}District boundary`] = districtLayer;
      districtLayer.addTo(this.map);
    }

    // ── MOH area layer (DHIS2 geometry if available, else manual) ──
    const dsLayer = await this.loadDsAreaLayer(L);
    if (dsLayer) {
      const dot = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background-color:#4f46e5;margin-right:6px;vertical-align:middle;"></span>`;
      overlays[`${dot}MOH areas`] = dsLayer;
      dsLayer.addTo(this.map);
    }
    const mohLayer = await this.loadMOHAreaLayer(L);
    if (mohLayer) {
      const dot = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background-color:#4f46e5;margin-right:6px;vertical-align:middle;"></span>`;
      overlays[`${dot}MOH areas`] = mohLayer;
      mohLayer.addTo(this.map);
    }
    // ── Year-colored patient layers ─────────────────────────────────────
    const yearLayers = this.buildYearLayers(L);
    for (const [label, layer] of Object.entries(yearLayers)) {
      overlays[label] = layer;
      layer.addTo(this.map); // default: all years visible, user can untick
    }

    L.control.layers(undefined, overlays, { collapsed: false }).addTo(this.map);
  }

  /**
   * Pulls the user's assigned district's real polygon from DHIS2 (not
   * hardcoded - uses whichever district(s) OrgScopeService resolved for
   * the logged-in user), draws its outline, and builds a "cutout" mask
   * (a world-covering polygon with the district shape as a hole) so
   * everything outside the district is visually dimmed. Also fits the map
   * view to the district and constrains panning to roughly its bounds.
   */
  private async loadDistrictBoundary(L: typeof import('leaflet')): Promise<any | null> {
    const district = this.orgScope.assignedDistricts()[0];
    if (!district) {
      this.districtLoadError.set('No assigned district found - showing default Sri Lanka view.');
      return null;
    }

    try {
      const geo = await firstValueFrom(this.dhis2.fetchOrgUnitGeometry(district.id));
      if (!geo.geometry || geo.geometry.type !== 'Polygon') {
        this.districtLoadError.set(`"${district.name}" has no boundary polygon in DHIS2 yet.`);
        return null;
      }

      const districtGroup = L.layerGroup();

      // Outline of the district itself
      const boundaryLayer = L.geoJSON(
        { type: 'Feature', properties: {}, geometry: geo.geometry } as any,
        { style: { color: '#0b4f4a', weight: 2, fill: false } }
      );
      boundaryLayer.addTo(districtGroup);

      // Cutout mask: world rectangle with the district as a hole, so
      // everything outside the district dims out visually.
      const worldRing: [number, number][] = [
        [-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]
      ];
      const maskFeature = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [worldRing, geo.geometry.coordinates[0]]
        }
      } as any;
      L.geoJSON(maskFeature, {
        style: { fillColor: '#f6f5f1', fillOpacity: 0.85, stroke: false },
        interactive: false
      }).addTo(districtGroup);

      const bounds = boundaryLayer.getBounds();
      this.map.fitBounds(bounds, { padding: [20, 20] });
      this.map.setMaxBounds(bounds.pad(0.3));

      return districtGroup;
    } catch (err) {
      console.error('[PatientMapComponent] Failed to load district boundary:', err);
      this.districtLoadError.set('Could not load district boundary from DHIS2.');
      return null;
    }
  }

  /**
   * Tries DHIS2 first (MOH-area org units under the district, if any have
   * geometry populated). Falls back to manualDsGeoJson if DHIS2 comes back
   * empty. Returns null (layer simply omitted) if neither source has data -
   * this is expected until either DHIS2 gets polygon data loaded for this
   * level, or you paste real GeoJSON into manualDsGeoJson above.
   */
  private async loadDsAreaLayer(L: typeof import('leaflet')): Promise<any | null> {
    const district = this.orgScope.assignedDistricts()[0];
    let features: OrgUnitGeometry[] = [];

    if (district) {
      try {
        features = await firstValueFrom(this.dhis2.fetchChildOrgUnitsWithGeometry(district.id));
        features = features.filter((f) => f.geometry && f.geometry.type !== 'Point');
      } catch (err) {
        console.warn('[PatientMapComponent] Could not fetch MOH-area geometry from DHIS2:', err);
      }
    }

    if (features.length === 0 && !this.manualDsGeoJson) {
      return null; // nothing from either source - omit the layer entirely
    }

    const group = L.layerGroup();

    features.forEach((f, i) => {
      const color = this.dsAreaPalette[i % this.dsAreaPalette.length];
      L.geoJSON({ type: 'Feature', properties: { name: f.name }, geometry: f.geometry as any } as any, {
        style: { color, weight: 1.5, fillColor: color, fillOpacity: 0.15 }
      })
        .bindTooltip(f.name)
        .addTo(group);
    });

    if (this.manualDsGeoJson) {
      this.manualDsGeoJson.features.forEach((f, i) => {
        const color = this.dsAreaPalette[i % this.dsAreaPalette.length];
        L.geoJSON(f, { style: { color, weight: 1.5, fillColor: color, fillOpacity: 0.15 } })
          .bindTooltip((f.properties as any)?.['name'] ?? 'MOH area')
          .addTo(group);
      });
    }

    return group;
  }

  private async loadMOHAreaLayer(L: typeof import('leaflet')): Promise<any | null> {
    const district = this.orgScope.assignedDistricts()[0];
    let features: OrgUnitGeometry[] = [];

    // 2. NEW: If DHIS2 gave nothing, load from assets
    if (features.length === 0 && !this.manualMohGeoJson) {
      try {
        console.log('[PatientMapComponent] Loading MOH boundaries from assets...');
        // this is your extracted file
        const assetGeoJson = await firstValueFrom(
          this.http.get<any>('assets/geo/moh.geojson')
        );
        this.manualMohGeoJson = assetGeoJson;
      } catch (err) {
        console.warn('Could not load asset geojson', err);
      }
    }

    if (features.length === 0 && !this.manualMohGeoJson) {
      return null;
    }

    const group = L.layerGroup();

    features.forEach((f, i) => {
      const color = this.dsAreaPalette[i % this.dsAreaPalette.length];
      L.geoJSON({ type: 'Feature', properties: { name: f.name }, geometry: f.geometry as any } as any, {
        style: { color, weight: 1.5, fillColor: color, fillOpacity: 0.15 }
      })
        .bindTooltip(f.name)
        .addTo(group);
    });

    if (this.manualMohGeoJson) {
      this.manualMohGeoJson.features.forEach((f: any, i: number) => {
        const color = this.mohAreaPalette[i % this.mohAreaPalette.length];
        // handle both Feature and FeatureCollection
        const geo = f.type === 'FeatureCollection' ? f.features : f;
        L.geoJSON(geo, {
          style: { color, weight: 1.5, fillColor: color, fillOpacity: 0.15 }
        })
          .bindTooltip((f.properties as any)?.['adm3_name'] || (f.properties as any)?.['name'] || 'MOH area')
          .addTo(group);
      });
    }

    return group;
  }


  /** One Leaflet layerGroup per year, each with its own marker color and popups. */
  private buildYearLayers(L: typeof import('leaflet')): Record<string, any> {
    const years = Object.keys(this.yearColors).map(Number).sort((a, b) => b - a);
    const layers: Record<string, any> = {};

    for (const year of years) {
      const group = L.layerGroup();
      const color = this.yearColors[year];

      const patientsThisYear = this.mappable().filter((p) => {
        if (!p.enrolledAt) return false;
        return Number(p.enrolledAt.slice(0, 4)) === year;
      });

      for (const p of patientsThisYear) {
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>`,
          iconSize: [16, 16]
        });

        const marker = L.marker([p.latitude!, p.longitude!], { icon });
        marker.bindPopup(this.popupHtml(p));
        marker.on('click', () => this.selected.set(p));
        marker.addTo(group);
      }

      // Colored dot embedded directly in the label HTML - Leaflet's layer
      // control renders overlay names as raw innerHTML, so this ties the
      // color to this specific entry regardless of layer ordering, rather
      // than relying on fragile CSS nth-child matching.
      const dot = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background-color:${color};margin-right:6px;vertical-align:middle;"></span>`;
      layers[`${dot}${year} (${patientsThisYear.length})`] = group;
    }

    return layers;
  }

  private popupHtml(p: Patient): string {
    const alc = p.alcNum || '—';
    const name = p.patientName || '(no name)';
    const address = p.patientHomeAddress || 'No address on file';
    return `
      <div style="font-family: var(--font-body, sans-serif); font-size: 0.85rem; line-height: 1.5;">
        <strong>${this.escapeHtml(alc)}</strong> — ${this.escapeHtml(name)}<br>
        <span style="color:#6b7280">${this.escapeHtml(address)}</span>
      </div>
    `;
  }

  private escapeHtml(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
}