import { Component, inject, computed, signal, OnInit, AfterViewInit, ElementRef, ViewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PatientService } from '../../core/services/patient.service';
import { Dhis2Service, OrgUnitGeometry } from '../../core/services/dhis2.service';
import { OrgScopeService } from '../../core/services/org-scope.service';
import { Patient } from '../../core/services/patient.model';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { debounce } from 'lodash';

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
 * Install: npm install leaflet @types/leaflet leaflet.markercluster @types/leaflet.markercluster --save
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
  protected readonly searchQuery = signal<string>('');
  protected readonly filteredPatients = signal<Patient[]>([]);

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
  private markerClusterGroup: any;
  private allPatientMarkers: Map<string, any> = new Map();
  private searchControl: any;
  private searchInput: HTMLInputElement | null = null;
  private isMapInitialized = false;

  // Debounced search to avoid performance issues
  private debouncedSearch = debounce(() => {
    this.applySearchFilter();
  }, 300);

  constructor() {
    // React to patient data changes
    effect(() => {
      const patients = this.mappable();
      if (this.isMapInitialized && patients.length > 0) {
        this.updatePatientMarkers(patients);
      }
    });
  }

  ngOnInit(): void { }

  async ngAfterViewInit(): Promise<void> {
    const leafletModule: any = await import('leaflet');
    this.L = (leafletModule.default ?? leafletModule) as typeof import('leaflet');
    const L = this.L;

    // Import markercluster
    await import('leaflet.markercluster');
    
    this.map = L.map(this.mapContainer.nativeElement, {
      minZoom: 9
    }).setView([7.8731, 80.7718], 7);

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
    
    // ── Create cluster group ─────────────────────────────────────
    this.markerClusterGroup = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (cluster: any) => {
        const childCount = cluster.getChildCount();
        let size = 'medium';
        let color = '#0b4f4a';
        
        if (childCount < 10) {
          size = 'small';
          color = '#3b82f6';
        } else if (childCount < 50) {
          size = 'medium';
          color = '#f59e0b';
        } else {
          size = 'large';
          color = '#ef4444';
        }
        
        return L.divIcon({
          html: `<div style="background:${color};color:white;border-radius:50%;width:${size === 'small' ? 30 : size === 'medium' ? 40 : 50}px;height:${size === 'small' ? 30 : size === 'medium' ? 40 : 50}px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:${size === 'small' ? 12 : size === 'medium' ? 14 : 16}px;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);">${childCount}</div>`,
          className: 'cluster-marker',
          iconSize: [size === 'small' ? 30 : size === 'medium' ? 40 : 50, size === 'small' ? 30 : size === 'medium' ? 40 : 50]
        });
      }
    });
    
    // Add cluster group to map
    this.markerClusterGroup.addTo(this.map);
    
    // ── Build patient markers with clustering ─────────────────────
    const allPatients = this.mappable();
    this.updatePatientMarkers(allPatients);
    
    // ── Add search control ─────────────────────────────────────
    this.addSearchControl(L);
    
    // ── Layer control ─────────────────────────────────────
    L.control.layers(undefined, overlays, { collapsed: false }).addTo(this.map);
    
    this.isMapInitialized = true;
  }

  /**
   * Updates patient markers with clustering and filtering
   */
  private updatePatientMarkers(patients: Patient[]): void {
    if (!this.markerClusterGroup || !this.L) return;
    
    // Clear existing markers
    this.markerClusterGroup.clearLayers();
    this.allPatientMarkers.clear();
    
    // Apply search filter if active
    const searchQuery = this.searchQuery().toLowerCase().trim();
    let filteredPatients = patients;
    
    if (searchQuery) {
      filteredPatients = patients.filter(p => 
        p.patientName?.toLowerCase().includes(searchQuery) ||
        p.patientHomeAddress?.toLowerCase().includes(searchQuery) ||
        p.alcNum?.toLowerCase().includes(searchQuery) ||
        p.patientMohArea?.toLowerCase().includes(searchQuery)
      );
    }
    
    this.filteredPatients.set(filteredPatients);
    
    // Group patients by year for color coding
    const patientsByYear = this.groupPatientsByYear(filteredPatients);
    
    // Create markers for each year group
    for (const [year, yearPatients] of Object.entries(patientsByYear)) {
      const color = this.yearColors[Number(year)] || '#6b7280';
      
      for (const p of yearPatients) {
        const marker = this.createPatientMarker(p, color);
        this.markerClusterGroup.addLayer(marker);
        this.allPatientMarkers.set(p.id!, marker);
      }
    }
    
    // If no markers, show a message
    if (filteredPatients.length === 0) {
      console.log('No patients match the search criteria');
    }
  }

  /**
   * Group patients by enrollment year
   */
  private groupPatientsByYear(patients: Patient[]): Record<string, Patient[]> {
    const groups: Record<string, Patient[]> = {};
    
    for (const p of patients) {
      let year = '2024'; // default
      if (p.enrolledAt) {
        const extractedYear = p.enrolledAt.slice(0, 4);
        if (extractedYear && !isNaN(Number(extractedYear))) {
          year = extractedYear;
        }
      }
      
      if (!groups[year]) {
        groups[year] = [];
      }
      groups[year].push(p);
    }
    
    return groups;
  }

  /**
   * Create a single patient marker
   */
  private createPatientMarker(patient: Patient, color: string): any {
    const L = this.L;
    
    const icon = L.divIcon({
      className: 'patient-marker',
      html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);transition:transform 0.2s;"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });

    const marker = L.marker([patient.latitude!, patient.longitude!], { icon });
    marker.bindPopup(this.popupHtml(patient));
    marker.on('click', () => this.selected.set(patient));
    
    return marker;
  }

  /**
   * Add search control to the map
   */
  private addSearchControl(L: typeof import('leaflet')): void {
    const SearchControl = L.Control.extend({
      options: {
        position: 'topleft'
      },
      
      onAdd: () => {
        const container = L.DomUtil.create('div', 'search-control-container');
        container.style.background = 'white';
        container.style.padding = '10px';
        container.style.borderRadius = '4px';
        container.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
        container.style.minWidth = '220px';
        
        const wrapper = L.DomUtil.create('div', 'search-wrapper');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '8px';
        
        const icon = L.DomUtil.create('span', 'search-icon');
        icon.innerHTML = '🔍';
        icon.style.fontSize = '16px';
        wrapper.appendChild(icon);
        
        const input = L.DomUtil.create('input', 'search-input') as HTMLInputElement;
        input.type = 'text';
        input.placeholder = 'Search patients...';
        input.style.border = '1px solid #e2e8f0';
        input.style.borderRadius = '4px';
        input.style.padding = '6px 10px';
        input.style.width = '100%';
        input.style.fontSize = '14px';
        input.style.outline = 'none';
        
        input.addEventListener('focus', () => {
          input.style.borderColor = '#0b4f4a';
        });
        
        input.addEventListener('blur', () => {
          input.style.borderColor = '#e2e8f0';
        });
        
        input.addEventListener('input', (e) => {
          const value = (e.target as HTMLInputElement).value;
          this.searchQuery.set(value);
          this.debouncedSearch();
        });
        
        wrapper.appendChild(input);
        container.appendChild(wrapper);
        
        // Add clear button
        const clearBtn = L.DomUtil.create('button', 'search-clear');
        clearBtn.textContent = '✕';
        clearBtn.style.cssText = `
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          color: #9ca3af;
          font-size: 14px;
          padding: 4px;
          display: none;
        `;
        
        clearBtn.addEventListener('click', () => {
          input.value = '';
          this.searchQuery.set('');
          this.applySearchFilter();
          clearBtn.style.display = 'none';
          input.focus();
        });
        
        container.style.position = 'relative';
        container.appendChild(clearBtn);
        
        // Show/hide clear button
        input.addEventListener('input', () => {
          clearBtn.style.display = input.value.length > 0 ? 'block' : 'none';
        });
        
        this.searchInput = input;
        
        return container;
      }
    });
    
    this.searchControl = new SearchControl();
    this.searchControl.addTo(this.map);
  }

  /**
   * Apply search filter to markers
   */
  private applySearchFilter(): void {
    const patients = this.mappable();
    this.updatePatientMarkers(patients);
    
    // Zoom to show filtered patients if any
    const filtered = this.filteredPatients();
    if (filtered.length > 0) {
      const bounds = this.getBoundsFromPatients(filtered);
      if (bounds) {
        this.map.fitBounds(bounds, { padding: [30, 30] });
      }
    }
  }

  /**
   * Get bounds from a list of patients
   */
  private getBoundsFromPatients(patients: Patient[]): any {
    if (!this.L || patients.length === 0) return null;
    
    const lats = patients.map(p => p.latitude!).filter(lat => lat != null);
    const lngs = patients.map(p => p.longitude!).filter(lng => lng != null);
    
    if (lats.length === 0 || lngs.length === 0) return null;
    
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    
    return this.L.latLngBounds(
      this.L.latLng(minLat, minLng),
      this.L.latLng(maxLat, maxLng)
    );
  }

  /**
   * Clear search and reset view
   */
  protected clearSearch(): void {
    this.searchQuery.set('');
    if (this.searchInput) {
      this.searchInput.value = '';
    }
    this.applySearchFilter();
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
    const moh = p.patientMohArea || 'N/A';
    const phone = p.mobileNum || p.telNum;
    
    return `
      <div style="font-family: var(--font-body, sans-serif); font-size: 0.85rem; line-height: 1.5; min-width: 200px;">
        <div style="font-weight: 600; font-size: 1rem; margin-bottom: 4px;">${this.escapeHtml(name)}</div>
        <div style="color: #6b7280; margin-bottom: 2px;">ALC: ${this.escapeHtml(alc)}</div>
        <div style="color: #6b7280; margin-bottom: 2px;">${this.escapeHtml(address)}</div>
        <div style="color: #6b7280; font-size: 0.75rem; margin-top: 4px; border-top: 1px solid #e5e7eb; padding-top: 4px;">
          MOH: ${this.escapeHtml(moh)} | ${this.escapeHtml(phone)}
        </div>
      </div>
    `;
  }

  private escapeHtml(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
}