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
  private readonly yearsTop5 = this.patientService.yearsTop5()

  private readonly yearColors: Record<string, string> = {
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
  private clusterControl: any;
  private searchInput: HTMLInputElement | null = null;
  private isMapInitialized = false;

  private yearLayerGroups: Record<string, any> = {};
  private allYearGroup: any; // combined year layers
  private currentMode: 'year' | 'cluster' = 'year';

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

  private activeYears = new Set<number>([2026, 2025, 2024, 2023, 2022]);
  private isSwitching = false;

  async ngAfterViewInit(): Promise<void> {
    const leafletModule: any = await import('leaflet');
    this.L = (leafletModule.default ?? leafletModule) as typeof import('leaflet');
    const L = this.L;
    await import('leaflet.markercluster');


    this.map = L.map(this.mapContainer.nativeElement, { minZoom: 9 }).setView([7.8731, 80.7718], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap', maxZoom: 19
    }).addTo(this.map);

    const overlays: Record<string, any> = {};

    const districtLayer = await this.loadDistrictBoundary(L);
    if (districtLayer) {
      overlays[`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#0b4f4a;margin-right:6px;"></span>District boundary`] = districtLayer;
      districtLayer.addTo(this.map);
    }

    const mohLayer = await this.loadMOHAreaLayerDHIS2(L);
    if (mohLayer) {
      overlays[`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#4f46e5;margin-right:6px;"></span>MOH areas`] = mohLayer;
      mohLayer.addTo(this.map);
    }

    this.allYearGroup = L.layerGroup();
    this.markerClusterGroup = L.markerClusterGroup({
      maxClusterRadius: 50,
      iconCreateFunction: (cluster: any) => {
        const count = cluster.getChildCount();
        const size = count < 10 ? 30 : count < 50 ? 40 : 50;
        const color = count < 10 ? '#3b82f6' : count < 50 ? '#f59e0b' : '#ef4444';
        return L.divIcon({
          html: `<div style="background:${color};color:white;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-weight:bold;border:2px solid white;">${count}</div>`,
          iconSize: [size, size], className: ''
        });
      }
    });

    const top5Years = await this.patientService.getYears(5);
    this.activeYears = new Set(top5Years.map(y => Number(y))); // init here

    top5Years.forEach(year => {
      const yNum = Number(year);
      console.log('ynum', yNum)
      const color = this.yearColors[yNum] || '#6b7280';
      this.yearLayerGroups[yNum] = L.layerGroup();
      console.log('L.layerGroup()', L.layerGroup())
      const dot = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color};margin-right:6px;"></span>`;
      overlays[`${dot}${year} (<span id="count-${year}">0</span>)`] = this.yearLayerGroups[yNum];
    });

    Object.values(this.yearLayerGroups).forEach(g => g.addTo(this.map));

    this.map.on('overlayadd', (e: any) => {
      if (this.isSwitching) return;
      for (const [yStr, group] of Object.entries(this.yearLayerGroups)) {
        if (e.layer === group) {
          this.activeYears.add(Number(yStr));
          this.refreshCluster();
          break;
        }
      }
    });
    this.map.on('overlayremove', (e: any) => {
      if (this.isSwitching) return;
      for (const [yStr, group] of Object.entries(this.yearLayerGroups)) {
        if (e.layer === group) {
          this.activeYears.delete(Number(yStr));
          this.refreshCluster();
          break;
        }
      }
    });

    this.updatePatientMarkers(this.mappable());
    this.addSearchControl(L);
    this.addClusterControl(L);
    L.control.layers(undefined, overlays, { collapsed: false }).addTo(this.map);
    this.isMapInitialized = true;
    this.exportMapImage()

  }

  private addClusterControl(L: typeof import('leaflet')): void {
    const self = this;
    const ClusterControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function () {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        container.style.width = '34px'; container.style.height = '34px'; container.style.background = 'white';
        const btn = L.DomUtil.create('a', '', container);
        btn.href = '#'; btn.innerHTML = '📅'; btn.title = 'Year view';
        btn.style.fontSize = '18px'; btn.style.lineHeight = '34px'; btn.style.textAlign = 'center'; btn.style.textDecoration = 'none';
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(btn, 'click', L.DomEvent.stop);
        L.DomEvent.on(btn, 'click', (e: any) => {
          e.preventDefault();
          self.isSwitching = true;

          if (self.currentMode === 'year') {
            // year -> cluster
            Object.values(self.yearLayerGroups).forEach((g: any) => self.map.removeLayer(g));
            self.map.addLayer(self.markerClusterGroup);
            self.currentMode = 'cluster';
            btn.innerHTML = '🔗';
          } else {
            // cluster -> year
            self.map.removeLayer(self.markerClusterGroup);
            for (const y of self.activeYears) {
              if (self.yearLayerGroups[y]) self.map.addLayer(self.yearLayerGroups[y]);
            }
            self.currentMode = 'year';
            btn.innerHTML = '📅';
          }
          setTimeout(() => self.isSwitching = false, 100);
        });
        return container;
      }
    });
    new ClusterControl().addTo(this.map);
  }

  private refreshCluster() {
    if (!this.L || !this.markerClusterGroup) return;
    this.markerClusterGroup.clearLayers();
    const all = this.mappable();
    for (const p of all) {
      const year = Number(p.enrolledAt?.slice(0, 4)) || 2026;
      if (!this.activeYears.has(year)) continue;
      if (p.latitude == null || p.longitude == null) continue;
      const color = this.yearColors[year] || '#6b7280';
      this.markerClusterGroup.addLayer(this.createPatientMarker(p, color));
    }
  }

  private updatePatientMarkers(patients: Patient[]): void {
    if (!this.L) return;
    Object.values(this.yearLayerGroups).forEach(g => g.clearLayers());

    const counts: Record<number, number> = { 2026: 0, 2025: 0, 2024: 0, 2023: 0, 2022: 0 };
    for (const p of patients) {
      const year = Number(p.enrolledAt?.slice(0, 4)) || 2026;
      if (!this.yearLayerGroups[year]) continue;
      const color = this.yearColors[year] || '#6b7280';
      this.yearLayerGroups[year].addLayer(this.createPatientMarker(p, color));
      counts[year]++;
    }
    Object.entries(counts).forEach(([y, c]) => {
      const el = document.getElementById(`count-${y}`);
      if (el) el.textContent = String(c);
    });
    this.refreshCluster();
  }




  /*
  async ngAfterViewInit(): Promise<void> {
    const leafletModule: any = await import('leaflet');
    this.L = (leafletModule.default?? leafletModule) as typeof import('leaflet');
    const L = this.L;
    await import('leaflet.markercluster');
  
    this.map = L.map(this.mapContainer.nativeElement, { minZoom: 9 }).setView([7.8731, 80.7718], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19
    }).addTo(this.map);
  
    const overlays: Record<string, any> = {};
  
    const districtLayer = await this.loadDistrictBoundary(L);
    if (districtLayer) {
      overlays[`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#0b4f4a;margin-right:6px;"></span>District boundary`] = districtLayer;
      districtLayer.addTo(this.map);
    }
  
    const mohLayer = await this.loadMOHAreaLayer(L);
    if (mohLayer) {
      overlays[`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#4f46e5;margin-right:6px;"></span>MOH areas`] = mohLayer;
      mohLayer.addTo(this.map);
    }
  
    // --- create groups ---
    this.allYearGroup = L.layerGroup();
    this.markerClusterGroup = L.markerClusterGroup({
      maxClusterRadius: 50,
      iconCreateFunction: (cluster: any) => {
        const count = cluster.getChildCount();
        const size = count < 10? 30 : count < 50? 40 : 50;
        const color = count < 10? '#3b82f6' : count < 50? '#f59e0b' : '#ef4444';
        return L.divIcon({
          html: `<div style="background:${color};color:white;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-weight:bold;border:2px solid white;">${count}</div>`,
          iconSize: [size, size], className: ''
        });
      }
    });
  
    // Build year layers initially (empty markers, will fill in updatePatientMarkers)
    [2026,2025,2024,2023,2022].forEach(year => {
      const color = this.yearColors[year] || '#6b7280';
      const group = L.layerGroup();
      this.yearLayerGroups[year] = group;
      const dot = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color};margin-right:6px;"></span>`;
      overlays[`${dot}${year} (<span id="count-${year}">0</span>)`] = group;
    });
  
    this.allYearGroup.addTo(this.map); // DEFAULT = year view
    Object.values(this.yearLayerGroups).forEach(g => g.addTo(this.allYearGroup));
  
    // listen to layer control check/uncheck to sync activeYears
    this.map.on('overlayadd overlayremove', (e: any) => {
      // find which year was toggled by matching layer instance
      for (const [yearStr, group] of Object.entries(this.yearLayerGroups)) {
        if (e.layer === group) {
          const year = Number(yearStr);
          if (e.type === 'overlayadd') this.activeYears.add(year);
          else this.activeYears.delete(year);
          this.refreshClusterFromActiveYears();
          break;
        }
      }
    });
  
    this.updatePatientMarkers(this.mappable());
  
    this.addSearchControl(L);
    this.addClusterControl(L);
    L.control.layers(undefined, overlays, { collapsed: false }).addTo(this.map);
    this.isMapInitialized = true;
  }
  
  private refreshClusterFromActiveYears() {
    this.markerClusterGroup.clearLayers();
    for (const year of this.activeYears) {
      const group = this.yearLayerGroups[year];
      if (!group) continue;
      group.eachLayer((m: any) => {
        // recreate marker for cluster (clone)
        const p = m.options._patientRef;
        const color = m.options._colorRef;
        if (p) this.markerClusterGroup.addLayer(this.createPatientMarker(p, color));
      });
    }
  }
  
  private updatePatientMarkers(patients: Patient[]): void {
    if (!this.L) return;
  
    // clear all
    Object.values(this.yearLayerGroups).forEach(g => g.clearLayers());
    this.markerClusterGroup.clearLayers();
  
    const counts: Record<number, number> = { 2026:0,2025:0,2024:0,2023:0,2022:0 };
  
    for (const p of patients) {
      const year = Number(p.enrolledAt?.slice(0,4)) || 2026;
      if (!this.yearLayerGroups[year]) continue;
      const color = this.yearColors[year] || '#6b7280';
      const marker = this.createPatientMarker(p, color);
      marker.addTo(this.yearLayerGroups[year]);
      counts[year]++;
    }
  
    // update counts in layer control
    Object.entries(counts).forEach(([y,c]) => {
      const el = document.getElementById(`count-${y}`);
      if (el) el.textContent = String(c);
    });
  
    this.refreshClusterFromActiveYears();
  }
  
  private buildYearLayers(L: typeof import('leaflet')) { return this.yearLayerGroups; }
  
  private addClusterControl(L: typeof import('leaflet')): void {
    const self = this;
    const ClusterControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        container.style.width = '34px'; container.style.height = '34px';
        const btn = L.DomUtil.create('a', '', container);
        btn.href = '#'; btn.innerHTML = '📅';
        btn.title = 'Year view - Click for Cluster';
        btn.style.fontSize = '18px'; btn.style.lineHeight = '34px'; btn.style.textAlign = 'center';
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(btn, 'click', L.DomEvent.stop);
        L.DomEvent.on(btn, 'click', (e: any) => {
          e.preventDefault();
          if (self.currentMode === 'year') {
            self.map.removeLayer(self.allYearGroup);
            self.map.addLayer(self.markerClusterGroup);
            self.currentMode = 'cluster';
            btn.innerHTML = '🔗';
          } else {
            self.map.removeLayer(self.markerClusterGroup);
            self.map.addLayer(self.allYearGroup);
            self.currentMode = 'year';
            btn.innerHTML = '📅';
          }
        });
        return container;
      }
    });
    new ClusterControl().addTo(this.map);
  }*/



  private createPatientMarker(patient: Patient, color: string): any {
    const L = this.L;
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });
    const marker = L.marker([patient.latitude!, patient.longitude!], {
      icon,
      // @ts-ignore - store ref for rebuilding
      _patientRef: patient,
      _colorRef: color
    } as any);
    marker.bindPopup(this.popupHtml(patient));
    marker.on('click', () => this.selected.set(patient));
    return marker;
  }

  /**
   * Group patients by enrollment year
   */
  private groupPatientsByYear(patients: Patient[]): Record<string, Patient[]> {
    const groups: Record<string, Patient[]> = {};

    for (const p of patients) {
      let year = '2026'; // default
      if (p.enrolledAt) {
        const extractedYear = p.enrolledAt.slice(0, 4);
        if (extractedYear && !isNaN(Number(extractedYear))) {
          year = extractedYear;
          console.log(extractedYear)
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
  /* private createPatientMarker(patient: Patient, color: string): any {
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
   }*/

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
  private async loadMOHAreaLayerDHIS2(L: typeof import('leaflet')): Promise<any | null> {
    const district = this.orgScope.assignedDistricts()[0];
    let features: OrgUnitGeometry[] = [];

    if (district) {
      console.log(district.name)
      if (district.name === 'Ratnapura RDHS') return this.loadMOHAreaLayer(L)
      try {
        features = await firstValueFrom(this.dhis2.fetchChildOrgUnitsWithGeometry(district.id));
        features = features.filter((f) => f.geometry && f.geometry.type !== 'Point');
      } catch (err) {
        console.warn('[PatientMapComponent] Could not fetch MOH-area geometry from DHIS2:');
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
    try {
      console.info('[PatientMapComponent] Loading MOH boundaries from assets...');
      // this is your extracted file
      const assetGeoJson = await firstValueFrom(
        this.http.get<any>('assets/geo/moh.geojson')
      );
      this.manualMohGeoJson = assetGeoJson;
    } catch (err) {
      console.warn('Could not load asset geojson', err);
    }
    const group = L.layerGroup();
    if (!this.manualMohGeoJson) {
      return null;
    }

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
  // Export map as image
  private exportMapImage(): void {
    /* this.map.once('render', () => {
       const canvas = document.querySelector('.leaflet-map-pane canvas');
       if (canvas) {
         const link = document.createElement('a');
         link.download = 'patient-map.png';
         link.href = (canvas as HTMLCanvasElement).toDataURL('image/png');
         link.click();
       }
     });*/
  }

  /** One Leaflet layerGroup per year, each with its own marker color and popups. */
  /* private buildYearLayers(L: typeof import('leaflet')): Record<string, any> {
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
   }*/


  /*private addClusterControl(L: typeof import('leaflet')): void {
    const self = this;
    const ClusterControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        container.style.background = 'white';
        container.style.width = '34px';
        container.style.height = '34px';
        container.style.cursor = 'pointer';
  
        const btn = L.DomUtil.create('a', '', container);
        btn.href = '#';
        btn.style.fontSize = '18px';
        btn.style.lineHeight = '34px';
        btn.style.textAlign = 'center';
        btn.style.textDecoration = 'none';
        btn.innerHTML = '📅'; // year mode icon
        btn.title = 'Year view - Click for Cluster view';
  
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(btn, 'click', L.DomEvent.stop);
        L.DomEvent.on(btn, 'click', (e: any) => {
          e.preventDefault();
          if (self.currentMode === 'year') {
            // Switch to CLUSTER
            self.map.removeLayer(self.allYearGroup);
            self.map.addLayer(self.markerClusterGroup);
            self.currentMode = 'cluster';
            btn.innerHTML = '🔗';
            btn.title = 'Cluster view - Click for Year view';
            container.style.background = '#e0f2f1';
          } else {
            // Switch to YEAR
            self.map.removeLayer(self.markerClusterGroup);
            self.map.addLayer(self.allYearGroup);
            self.currentMode = 'year';
            btn.innerHTML = '📅';
            btn.title = 'Year view - Click for Cluster view';
            container.style.background = 'white';
          }
        });
        return container;
      }
    });
    this.clusterControl = new ClusterControl();
    this.clusterControl.addTo(this.map);
  }*/

}