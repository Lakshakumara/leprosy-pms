import { Component, inject, computed, signal, OnInit, AfterViewInit, ElementRef, ViewChild, effect, NgZone, ChangeDetectorRef, OnDestroy, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PatientService } from '../../core/services/patient.service';
import { Dhis2Service, OrgUnitGeometry } from '../../core/services/dhis2.service';
import { OrgScopeService } from '../../core/services/org-scope.service';
import { Patient } from '../../core/services/patient.model';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { debounce } from 'lodash';
import { LocalStorageService } from '../../core/services/local-storage.service';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog'
import { FormsModule } from '@angular/forms';
import { SpeedDialModule } from 'primeng/speeddial';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { Dhis2UpdaterService } from '../../core/services/dhis2-updater.service';
import type { SyncStatus } from '../../core/services/patient.model';
import { MobileHeaderService } from '../../core/services/mobile-header.service';
import { DrawerModule } from 'primeng/drawer';

@Component({
  selector: 'app-patient-map',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, 
    DialogModule, SpeedDialModule, ConfirmDialogModule, DrawerModule],
 
  templateUrl: './patient-map.component.html',
  styleUrl: './patient-map.component.scss'
})
export class PatientMapComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef<HTMLDivElement>;
  private mobileHeader = inject(MobileHeaderService);
  private readonly ngZone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef); // Add this
  protected readonly patientService = inject(PatientService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly dhis2 = inject(Dhis2Service);
  private readonly orgScope = inject(OrgScopeService);
  private readonly dhis2Updater = inject(Dhis2UpdaterService);
  private readonly http = inject(HttpClient);
  private readonly messageService = inject(MessageService); // For notifications
  private readonly confirmationService = inject(ConfirmationService);

  protected readonly selected = signal<Patient | null>(null);
  protected readonly districtLoadError = signal<string | null>(null);
  protected readonly searchQuery = signal<string>('');
  protected readonly filteredPatients = signal<Patient[]>([]);
  speedDialItems: MenuItem[] = [];
  isMobileView = signal(false);

  isSavingLocation = signal(false);

  protected readonly mappable = computed(() =>
    this.patientService.districtPatients().filter((p) => {

      if (p.latitude != null && p.longitude != null) {
        return true
      }
      else {
        console.log('patient withoutlatlang ', p)
        return false
      }
    })
  );

  protected readonly nonMappable = computed(() =>
  this.patientService.districtPatients().filter(
    (p) => p.latitude == null || p.longitude == null
  )
);

  private readonly manualDsGeoJson: GeoJSON.FeatureCollection | null = null;
  private manualMohGeoJson: GeoJSON.FeatureCollection | null = null;
  private yearsLast5: string[] = [];

 private readonly colorPalette: string[] = [
  '#0a0a0a', // blue
  '#b5532c', // clay red
  '#b08900', // gold
  '#0d9488', // teal
  '#7c3aed', // purple
  '#db2777', // pink - add more for safety
  '#059669',
  '#ea580c'
];

yearColors: Record<string, string> = {}; // NOT readonly, we build it

  private readonly mohAreaPalette = [
    '#1d4ed8', '#b5532c', '#b08900', '#0d9488', '#7c3aed',
    '#dc2626', '#059669', '#ea580c', '#4f46e5', '#0891b2'
  ];

  private map: any;
  private L!: typeof import('leaflet');
  private markerClusterGroup: any;
  private searchControl: any;
  private searchInput: HTMLInputElement | null = null;
  private isMapInitialized = false;

  private yearLayerGroups: Record<string, any> = {};
  public currentMode= signal<string>('year');

  private activeYears: Set<string> = new Set<string>()
  private isSwitching = false;
  private districtBounds: any = null; // stored for resetView()

  // Debounced search to avoid performance issues
  private debouncedSearch = debounce(() => {
    this.applySearchFilter();
  }, 300);

  // Edit Drawer State
  showEditDrawer = signal<boolean>(false);
  //isPickingLocation = signal<boolean>(false);
  //selectedPatient = signal<any | null>(null);
 // editLat = signal<number | null>(null);
  //editLng = signal<number | null>(null);
  
  selectedPatient = signal<Patient | null>(null);
  showEditDialog = signal(false);
  editLat = signal<number>(0);
  editLng = signal<number>(0);
  isPickingLocation = signal(false);
  // Map marker for selected location
  private tempMarker: any = null;
  private mapClickHandler: any = null;
 constructor() {
  // 1. marker update
  effect(() => {
    const patients = this.mappable();
    if (this.isMapInitialized && patients.length > 0) {
      this.updatePatientMarkers(patients);
    }
  });

  // 2. mobile toolbar - put HERE, not in method
  effect(() => {
    const countMapped = this.mappable().length;
    const countTotal = this.patientService.districtPatients().length;
    const exporting = this.exporting();

    /*untracked(() => {
      this.mobileHeader.set({
        title: 'Patient Map',
        count: `${countMapped} / ${countTotal}`,
        actions: [
          { icon: 'pi pi-download', label: 'Export', command: () => this.exportMapImage(), disabled: exporting }
        ],
        overflow: [
          { label: 'Refresh map', icon: 'pi pi-refresh', command: () => this.refreshMap() },
        ]
      });
    });*/
  });
}
  
  async ngOnInit(): Promise<void> {
    try {
      this.yearsLast5 = await this.patientService.getYears(5);
      this.activeYears = new Set<string>(this.yearsLast5);
      this.yearsLast5.forEach((year, index) => {
    this.yearColors[year] = this.colorPalette[index % this.colorPalette.length];
  });

    } catch (e) {
      console.error(e);
    }

    this.isMobileView.set(window.innerWidth < 769);

    // Listen for resize events
    window.addEventListener('resize', () => {
      this.isMobileView.set(window.innerWidth < 769);
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy(): void {
    this.mobileHeader.clear();
    if (this.map && this.mapClickHandler) {
      this.map.off('click', this.mapClickHandler);
    }
    if (this.tempMarker && this.map) {
      this.map.removeLayer(this.tempMarker);
    }
  }

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
      overlays[`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#0b4f4a;margin-right:6px;"></span>Crop District`] = districtLayer;
      districtLayer.addTo(this.map);
    }

    const mohLayer = await this.loadMOHAreaLayerDHIS2(L);
    if (mohLayer) {
      overlays[`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#4f46e5;margin-right:6px;"></span>MOH areas`] = mohLayer;
      mohLayer.addTo(this.map);
    }

    this.activeYears.forEach((year: string) => {
      const yNum = year;
      const color = this.yearColors[yNum] || '#6b7280';
      this.yearLayerGroups[yNum] = L.layerGroup();
      const dot = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color};margin-right:6px;"></span>`;
      overlays[`${dot}${year} (<span id="count-${year}">0</span>)`] = this.yearLayerGroups[yNum];
    });

    Object.values(this.yearLayerGroups).forEach(g => g.addTo(this.map));

    this.markerClusterGroup = L.markerClusterGroup({
      maxClusterRadius: 50,
      iconCreateFunction: (cluster: any) => {
        const children = cluster.getAllChildMarkers();
        const count = children.length;

        // Tally each child's year color (stored on the marker when created -
        // see createPatientMarker's _colorRef) and pick the most common one.
        const colorCounts = new Map<string, number>();
        for (const child of children) {
          const color = child.options?._colorRef ?? '#6b7280';
          colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
        }
        let dominantColor = '#6b7280';
        let maxCount = 0;
        for (const [color, c] of colorCounts) {
          if (c > maxCount) {
            maxCount = c;
            dominantColor = color;
          }
        }

        // Size still scales with count for readability, but color now reflects
        // the actual selected-year composition of that cluster.
        const size = count < 10 ? 30 : count < 50 ? 40 : 50;

        return L.divIcon({
          html: `<div style="background:${dominantColor};color:white;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-weight:bold;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);">${count}</div>`,
          iconSize: [size, size],
          className: ''
        });
      }
    });

    this.map.on('overlayadd', (e: any) => {
      if (this.isSwitching) return;
      for (const [yStr, group] of Object.entries(this.yearLayerGroups)) {
        if (e.layer === group) {
          this.activeYears.add(yStr);
          this.refreshCluster();
          if (this.currentMode() === 'cluster') {
            // In cluster mode: year layers must stay off the map –
            // Leaflet's control just added it, so remove it again.
            this.isSwitching = true;
            this.map.removeLayer(group);
            setTimeout(() => (this.isSwitching = false), 50);
          }
          break;
        }
      }
    });
    this.map.on('overlayremove', (e: any) => {
      if (this.isSwitching) return;
      for (const [yStr, group] of Object.entries(this.yearLayerGroups)) {
        if (e.layer === group) {
          this.activeYears.delete(yStr);
          this.refreshCluster();
          // In cluster mode Leaflet already removed the year layer; nothing extra needed.
          break;
        }
      }
    });


    this.map.on('popupopen', (e: any) => {
      const btn = e.popup.getElement()?.querySelector('[data-edit]') as HTMLElement;
      if (!btn) return;
      L.DomEvent.disableClickPropagation(btn);
      btn.onclick = () => {
        const id = btn.getAttribute('data-edit');
        const patient = this.mappable().find(x => x.id === id);
        if (patient) {
          // Close popup and open dialog
          this.map.closePopup();
          //this.openEditDialog(patient);
          this.openEditLocation(patient);
        }
      };
    });
    // Setup map click for location picking
    this.mapClickHandler = (e: any) => {
      // Fix: accept clicks when either the dialog OR the drawer is open
      if ((this.showEditDialog() || this.showEditDrawer()) && this.isPickingLocation()) {
        this.ngZone.run(() => {
          this.editLat.set(e.latlng.lat);
          this.editLng.set(e.latlng.lng);
          this.updateTempMarker(e.latlng.lat, e.latlng.lng);
          this.isPickingLocation.set(false);
          this.cdr.detectChanges();
        });
      }
    };
    this.map.on('click', this.mapClickHandler);

//this.addCustomControl(L);
    L.control.layers(undefined, overlays, { collapsed: false }).addTo(this.map);
    this.isMapInitialized = true;
    this.updatePatientMarkers(this.mappable());


    queueMicrotask(() => {
      this.setupMobileHeader();
    });
  }

  private setupMobileHeader(): void {
    const totalCount = this.patientService.districtPatients()?.length || 0;

    this.mobileHeader.set({
      title: 'Patient Map',
      subtitle: `${this.mappable().length} / ${totalCount} mapped`,
      
      // 2. Search integration
      //showSearch: true,
      searchPlaceholder: 'Search location or patient…',
      onSearch: (query: string) => this.onMapSearch(query),

      // 3. Cluster Toggle & Action Buttons
      actions: [
        {
          icon: this.enableClustering() ? 'pi pi-objects-column' : 'pi pi-circle-fill',
          label: 'Cluster',
          tooltip: 'Toggle Clustering',
          command: () => this.toggleClustering()
        }
      ],

      // 4. Export & Refresh in Overflow Menu
      overflow: [
        {
          icon: 'pi pi-download',
          label: this.exporting() ? 'Exporting…' : 'Export Image',
          command: () => this.exportMapImage()
        },
        {
          icon: 'pi pi-refresh',
          label: 'Refresh Map',
          command: () => this.refreshMap()
        }
      ]
    });
  }

  // --- Header Action Handlers ---

  // Cluster Toggle State
  enableClustering = signal<boolean>(true);
  
  toggleClustering(): void {
    this.isSwitching = true;

    if (this.currentMode() === 'year') {
      // → Cluster mode: remove all year layers, rebuild & show cluster group
      Object.values(this.yearLayerGroups).forEach((g: any) => this.map.removeLayer(g));
      this.refreshCluster();
      this.map.addLayer(this.markerClusterGroup);
      this.currentMode.set('cluster');
      this.enableClustering.set(true);
    } else {
      // → Year mode: remove cluster group, restore active year layers
      this.map.removeLayer(this.markerClusterGroup);
      for (const y of this.activeYears) {
        if (this.yearLayerGroups[y]) this.map.addLayer(this.yearLayerGroups[y]);
      }
      this.currentMode.set('year');
      this.enableClustering.set(false);
    }

    setTimeout(() => (this.isSwitching = false), 100);
    this.setupMobileHeader();
  }

  onMapSearch(query: string): void {
    this.searchQuery.set(query);
    this.debouncedSearch();
  }


  openAddPatientLocationDialog() {
    this.messageService.add({
        severity: 'info',
        summary: 'Comming Soon',
        detail: 'Module is not yet added',
        life: 3000
      });
  }

  private refreshCluster() {
    if (!this.L || !this.markerClusterGroup) return;



    this.markerClusterGroup.clearLayers();
    const all = this.mappable();
    for (const p of all) {
      const year = p.enrolledAt?.slice(0, 4) || '';
      if (!this.activeYears.has(year)) continue;
      if (p.latitude == null || p.longitude == null) continue;
      const color = this.yearColors[year] || '#6b7280';
      this.markerClusterGroup.addLayer(this.createPatientMarker(p, color));
    }
  }

  private updatePatientMarkers(patients: Patient[]): void {
    if (!this.L) return;
    Object.values(this.yearLayerGroups).forEach(g => g.clearLayers());

    const counts: Record<string, number> = Object.fromEntries(this.yearsLast5.map(year =>[year,0]));
    for (const p of patients) {
      const year =(p.enrolledAt?.slice(0, 4)|| '');
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

  private applySearchFilter(): void {
    console.log('apply filter ')
    const patients = this.mappable();

    const searchQuery = this.searchQuery().toLowerCase().trim();
    let filteredPatients = patients;
    
    if (searchQuery) {
      filteredPatients = patients.filter(p => 
        p.patientName?.toLowerCase().includes(searchQuery) ||
        p.patientHomeAddress?.toLowerCase().includes(searchQuery) ||
        p.alcNum?.toLowerCase().includes(searchQuery) ||
        p.patientMohArea?.toLowerCase().includes(searchQuery) ||
        p.patientPhiArea?.toLowerCase().includes(searchQuery)
      );
    }
    
    this.updatePatientMarkers(filteredPatients);

    // Zoom to show filtered patients if any
    if (filteredPatients.length > 0) {
      const bounds = this.getBoundsFromPatients(filteredPatients);
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

  private async loadDistrictBoundary(L: typeof import('leaflet')): Promise<any | null> {
    const district = this.orgScope.assignedDistricts()[0];
    if (!district) {
      this.districtLoadError.set('No assigned district found');
      return null;
    }

    const CACHE_KEY = `district-geo-${district.id}`;
    let geometry: any = null;

    // 1. Try offline cache first (Instant load)
    try {
      const cached = await this.localStorage.getMeta<any>(CACHE_KEY);
      if (cached) {
        geometry = cached;
        console.log('[District] from IndexedDB cache');
      } else {
        console.log('no cash district map')
      }
    } catch (error) {
      console.log('error', error)
    }

    // 2. If not cached, fetch from DHIS2
    if (!geometry) {
      try {
        const geo = await firstValueFrom(this.dhis2.fetchOrgUnitGeometry(district.id));
        if (!geo.geometry) throw new Error('No geometry');

        geometry = geo.geometry;

        // 3. Cache for offline
        if (geometry) {
          await this.localStorage.setMeta(CACHE_KEY, geometry);
          await this.localStorage.setMeta(`${CACHE_KEY}-updated`, new Date().toISOString());
          console.log('[District] cached to IndexedDB');
        }
      } catch (err) {
        // 4. Offline & no cache -> fail
        console.error('District load failed & no cache', err);
        this.districtLoadError.set('Could not load district boundary (offline & no cache).');
        return null;
      }
    } else {
      // Optional: background refresh when online
      if (navigator.onLine) {
        firstValueFrom(this.dhis2.fetchOrgUnitGeometry(district.id))
          .then(g => {
            if (g.geometry) this.localStorage.setMeta(CACHE_KEY, g.geometry);
          }).catch(() => { });
      }
    }

    // 5. Build layer (same as before)
    const districtGroup = L.layerGroup();
    const boundaryLayer = L.geoJSON(
      { type: 'Feature', properties: {}, geometry } as any,
      { style: { color: '#0b4f4a', weight: 2, fill: false } }
    );
    boundaryLayer.addTo(districtGroup);

    const worldRing: [number, number][] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
    L.geoJSON({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [worldRing, geometry.coordinates[0]] } } as any, {
      style: { fillColor: '#f6f5f1', fillOpacity: 0.85, stroke: false },
      interactive: false
    }).addTo(districtGroup);

    const bounds = boundaryLayer.getBounds();
    this.districtBounds = bounds; // store for resetView()
    this.map.fitBounds(bounds, { padding: [20, 20] });
    this.map.setMaxBounds(bounds.pad(0.3));

    return districtGroup;
  }

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
      const color = this.mohAreaPalette[i % this.mohAreaPalette.length];
      L.geoJSON({ type: 'Feature', properties: { name: f.name }, geometry: f.geometry as any } as any, {
        style: { color, weight: 1.5, fillColor: color, fillOpacity: 0.15 }
      })
        .bindTooltip(f.name)
        .addTo(group);
    });

    if (this.manualDsGeoJson) {
      this.manualDsGeoJson.features.forEach((f, i) => {
        const color = this.mohAreaPalette[i % this.mohAreaPalette.length];
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
    const phone = p.mobileNum || p.telNum || '—';
    return `
    <div style="font-family: var(--font-body, sans-serif); font-size: 0.85rem; line-height: 1.5; min-width: 220px;">
      <div style="font-weight: 600; font-size: 1rem; margin-bottom: 4px;">${this.escapeHtml(name)}</div>
      <div style="color: #6b7280; margin-bottom: 2px;">${this.escapeHtml(alc)}</div>
      <div style="color: #6b7280; margin-bottom: 2px;">${this.escapeHtml(address)}</div>
      <div style="color: #6b7280; font-size: 0.75rem; margin-top: 4px; border-top: 1px solid #e5e7eb; padding-top: 4px; margin-bottom:10px;">
        MOH: ${this.escapeHtml(moh)} | ${this.escapeHtml(phone)}
      </div>
      <button data-edit="${this.escapeHtml(p.id)}" 
        style="display:inline-flex; align-items:center; gap:6px; padding:6px 12px; font-size:0.8rem; font-weight:600; background:#0b4f4a; color:white; border:none; border-radius:6px; cursor:pointer; width:100%; justify-content:center;">
        <i class="pi pi-pencil" style="font-size:0.8rem"></i> Edit Location
      </button>
    </div>
    `;
  }

  private escapeHtml(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }


  private updateTempMarker(lat: number, lng: number): void {
    const L = this.L;
    if (this.tempMarker) {
      this.map.removeLayer(this.tempMarker);
    }

    const icon = L.divIcon({
      className: '',
      html: `<div style="width:20px;height:20px;border-radius:50%;background:#ef4444;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    this.tempMarker = L.marker([lat, lng], { icon }).addTo(this.map);
  }

  openEditDialog(p: Patient) {
    this.selectedPatient.set(p);
    this.editLat.set(p.latitude || 7.0);
    this.editLng.set(p.longitude || 81.0);
    this.isPickingLocation.set(false);

    // Remove any temp marker
    if (this.tempMarker) {
      this.map.removeLayer(this.tempMarker);
      this.tempMarker = null;
    }

    this.showEditDialog.set(true);
    this.cdr.detectChanges();
  }
openEditLocation(patient: any): void {
    this.selectedPatient.set(patient);
    this.editLat.set(patient.latitude ?? 0);
    this.editLng.set(patient.longitude ?? 0);
    this.isPickingLocation.set(false);

    // Show existing location as a temp pin so user sees current position before picking
    if (patient.latitude != null && patient.longitude != null) {
      this.updateTempMarker(patient.latitude, patient.longitude);
    } else if (this.tempMarker && this.map) {
      this.map.removeLayer(this.tempMarker);
      this.tempMarker = null;
    }

    this.showEditDrawer.set(true);
  }
  pickLocationFromMap() {
    this.isPickingLocation.set(true);
    // Add a visual hint on the map
    if (this.tempMarker) {
      this.map.removeLayer(this.tempMarker);
      this.tempMarker = null;
    }
    this.cdr.detectChanges();
  }

  cancelPicking() {
    this.isPickingLocation.set(false);
    if (this.tempMarker) {
      this.map.removeLayer(this.tempMarker);
      this.tempMarker = null;
    }
    // Reset to original location
    const p = this.selectedPatient();
    if (p) {
      this.editLat.set(p.latitude || 7.0);
      this.editLng.set(p.longitude || 81.0);
    }
    this.cdr.detectChanges();
  }

  cancelEdit() {
    this.showEditDialog.set(false);
    this.showEditDrawer.set(false); // Fix: also close the drawer
    this.isPickingLocation.set(false);
    if (this.tempMarker && this.map) {
      this.map.removeLayer(this.tempMarker);
      this.tempMarker = null;
    }
    this.cdr.detectChanges();
  }

 

  protected readonly exporting = signal(false);

protected async exportMapImage(): Promise<void> {
  this.exporting.set(true);
  try {
    const html2canvas = (await import('html2canvas')).default;
    const mapElement = this.mapContainer.nativeElement;

    const canvas = await html2canvas(mapElement, {
      useCORS: true,
      allowTaint: false,
      logging: false,
      onclone: (clonedDoc: Document) => {
        // Flatten CSS transforms on every Leaflet pane so nothing shifts in the screenshot.
        // Leaflet positions panes with translate3d(); html2canvas does not handle that well.
        const paneSelectors = [
          '.leaflet-map-pane',
          '.leaflet-tile-pane',
          '.leaflet-overlay-pane',
          '.leaflet-shadow-pane',
          '.leaflet-marker-pane',
          '.leaflet-tooltip-pane',
          '.leaflet-popup-pane'
        ];
        clonedDoc.querySelectorAll(paneSelectors.join(', ')).forEach((pane) => {
          const el = pane as HTMLElement;
          const t = el.style.transform;
          if (t && t !== 'none') {
            try {
              const m = new DOMMatrix(t);
              el.style.transform = 'none';
              el.style.left = `${(parseFloat(el.style.left) || 0) + m.m41}px`;
              el.style.top  = `${(parseFloat(el.style.top)  || 0) + m.m42}px`;
            } catch {
              el.style.transform = 'none';
            }
          }
        });

        // Fix the SVG inside the overlay pane: it carries its own transform
        // attribute which positions boundary layers independently.
        clonedDoc.querySelectorAll('.leaflet-overlay-pane svg').forEach((svgEl) => {
          const svg = svgEl as SVGSVGElement;
          // Handle CSS transform
          if (svg.style.transform && svg.style.transform !== 'none') {
            try {
              const m = new DOMMatrix(svg.style.transform);
              svg.style.transform = 'none';
              // Shift viewBox to compensate
              const vb = svg.getAttribute('viewBox');
              if (vb) {
                const [vx, vy, vw, vh] = vb.split(' ').map(Number);
                svg.setAttribute('viewBox', `${vx - m.m41} ${vy - m.m42} ${vw} ${vh}`);
              }
            } catch { svg.style.transform = 'none'; }
          }
          // Handle SVG transform attribute (Leaflet 1.x)
          const attr = svg.getAttribute('transform');
          if (attr) {
            try {
              const m = new DOMMatrix(attr);
              svg.removeAttribute('transform');
              const vb = svg.getAttribute('viewBox');
              if (vb) {
                const [vx, vy, vw, vh] = vb.split(' ').map(Number);
                svg.setAttribute('viewBox', `${vx - m.m41} ${vy - m.m42} ${vw} ${vh}`);
              }
            } catch { svg.removeAttribute('transform'); }
          }
        });
      }
    });

    const link = document.createElement('a');
    link.download = `patient-map-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error('[PatientMapComponent] Map export failed:', err);
    this.messageService.add({
      severity: 'error',
      summary: 'Export Failed',
      detail: 'Could not export the map image. See console for details.',
      life: 4000
    });
  } finally {
    this.exporting.set(false);
  }
}
  protected refreshMap(): void {
    setTimeout(() => {
      this.updatePatientMarkers(this.mappable());
    }, 100);
  }

  /** Fit map back to the district boundary (reset pan/zoom). */
  protected resetView(): void {
    if (this.districtBounds && this.map) {
      this.map.fitBounds(this.districtBounds, { padding: [20, 20] });
    }
  }

  async saveLocation() {
   
    const p = this.selectedPatient();
    //const p = this.nonMappable().filter(p => p.alcNum === 'ALC 47371')[0];
    if (!p) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No patient selected',
        life: 3000
      });
      return;
    }

    // Check if location actually changed
    const currentLat = p.latitude || 0;
    const currentLng = p.longitude || 0;
    const newLat = this.editLat();
    const newLng = this.editLng();
    if (Math.abs(currentLat - newLat) < 0.000001 && Math.abs(currentLng - newLng) < 0.000001) {
      this.messageService.add({
        severity: 'info',
        summary: 'No Change',
        detail: 'Location coordinates are the same',
        life: 3000
      });
      this.showEditDialog.set(false);
      return;
    }
    // Show confirmation dialog
    this.confirmationService.confirm({
      message: `
        <div style="margin: 10px 0;">
          <p><strong>Patient:</strong> ${p.patientName || 'Unknown'}</p>
          <p><strong>ALC:</strong> ${p.alcNum || 'N/A'}</p>
          <p style="margin-top: 10px;"><strong>Current Location:</strong></p>
          <p style="font-size: 0.9rem; color: #6b7280;">
            Lat: ${currentLat.toFixed(6)}<br>
            Lng: ${currentLng.toFixed(6)}
          </p>
          <p style="margin-top: 10px;"><strong>New Location:</strong></p>
          <p style="font-size: 0.9rem; color: #0b4f4a;">
            Lat: ${newLat.toFixed(6)}<br>
            Lng: ${newLng.toFixed(6)}
          </p>
          <p style="margin-top: 10px; color: #dc2626; font-size: 0.85rem;">
            ⚠️ This will update the GPS coordinates in DHIS2
          </p>
        </div>
      `,
      header: 'Confirm Location Update',
      icon: 'pi pi-map-marker',
      acceptButtonStyleClass: 'p-button-success',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: async () => {
        await this.performLocationUpdate(p);
      },
      reject: () => {
        this.showEditDialog.set(false);
      }
    });
  }

  // ============================================
  // PERFORM LOCATION UPDATE
  // ============================================

  private async performLocationUpdate(p: Patient) {
    this.isSavingLocation.set(true);

    try {
      const newLat = this.editLat();
      const newLng = this.editLng();

      // 1. Update local storage first (optimistic update)
      const updated = {
        ...p,
        latitude: newLat,
        longitude: newLng,
        syncStatus: 'pending' as SyncStatus,
        updatedAt: new Date().toISOString()
      };

      await this.localStorage.savePatient(updated);

      // 2. Try to sync to DHIS2
      if (navigator.onLine) {
        try {
          // Update the GPS coordinates in DHIS2
          await this.dhis2Updater.updatePatientGpsCoordinates(updated, newLat, newLng);

          // Mark as synced
          updated.syncStatus = 'synced' as SyncStatus;
          await this.localStorage.savePatient(updated);

          this.messageService.add({
            severity: 'success',
            summary: '✅ Location Updated',
            detail: `${p.patientName || 'Patient'} location synced to DHIS2`,
            life: 4000
          });
        } catch (error) {
          console.error('DHIS2 sync failed:', error);

          // Mark as pending sync
          updated.syncStatus = 'pending' as SyncStatus;
          await this.localStorage.savePatient(updated);

          this.messageService.add({
            severity: 'warn',
            summary: '📱 Offline Save',
            detail: 'Location saved locally. Will sync to DHIS2 when online.',
            life: 4000
          });
        }
      } else {
        // Offline - save locally
        updated.syncStatus = 'pending' as SyncStatus;
        await this.localStorage.savePatient(updated);

        this.messageService.add({
          severity: 'info',
          summary: '📱 Offline Save',
          detail: 'Location saved locally. Will sync when online.',
          life: 3000
        });
      }

      // 3. Refresh the map (year layers + cluster group)
      this.updatePatientMarkers(this.mappable());

      // 4. Update the selected patient in the UI
      this.selected.set(updated);
      this.selectedPatient.set(updated);

      this.showEditDialog.set(false);
      this.isPickingLocation.set(false);

      if (this.tempMarker) {
        this.map.removeLayer(this.tempMarker);
        this.tempMarker = null;
      }

    } catch (error) {
      console.error('Failed to save location:', error);
      this.messageService.add({
        severity: 'error',
        summary: '❌ Update Failed',
        detail: 'Failed to save location. Please try again.',
        life: 4000
      });
    } finally {
      this.isSavingLocation.set(false);
      this.cdr.detectChanges();
    }
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
}
 /*

  private setupMapClickForEditing(): void {
    if (!this.map) return;

    this.map.on('click', (e: any) => {
      if (this.showEditDialog() && this.isPickingLocation()) {
        this.ngZone.run(() => {
          this.editLat.set(e.latlng.lat);
          this.editLng.set(e.latlng.lng);
          this.isPickingLocation.set(false);
          this.cdr.detectChanges();
        });
      }
    });
  }

  private addCustomControl(L: typeof import('leaflet')): void {
    const self = this;

  const CustomControl = L.Control.extend({
    options: { position: 'topleft' },

    onAdd: function () {
      // Single unified control bar container
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control custom-map-controls');
      L.DomEvent.disableClickPropagation(container);

      // ==========================================
      // 1. VIEW SWITCHER BUTTON (Cluster / Year)
      // ==========================================
      const btnToggle = L.DomUtil.create('a', '', container);
      btnToggle.href = '#';
      btnToggle.style.display = 'flex';
      btnToggle.style.alignItems = 'center';
      btnToggle.style.justifyContent = 'center';
      btnToggle.style.width = '34px';
      btnToggle.style.height = '34px';
      btnToggle.style.textDecoration = 'none';
      btnToggle.style.color = '#374151';

      const iconToggle = L.DomUtil.create('i', '', btnToggle);
      iconToggle.style.fontSize = '1.1rem';

      if (self.currentMode === 'year') {
        iconToggle.className = 'pi pi-calendar';
        btnToggle.title = 'Switch to Cluster View';
      } else {
        iconToggle.className = 'pi pi-sitemap';
        btnToggle.title = 'Switch to Year View';
      }

      L.DomEvent.disableClickPropagation(btnToggle);
      L.DomEvent.on(btnToggle, 'click', L.DomEvent.stop);
      L.DomEvent.on(btnToggle, 'click', (e: Event) => {
        e.preventDefault();
        self.isSwitching = true;

        if (self.currentMode === 'year') {
          Object.values(self.yearLayerGroups).forEach((g: any) => self.map.removeLayer(g));
          self.map.addLayer(self.markerClusterGroup);
          self.currentMode = 'cluster';

          iconToggle.className = 'pi pi-sitemap';
          btnToggle.title = 'Switch to Year View';
        } else {
          self.map.removeLayer(self.markerClusterGroup);
          for (const y of self.activeYears) {
            if (self.yearLayerGroups[y]) self.map.addLayer(self.yearLayerGroups[y]);
          }
          self.currentMode = 'year';

          iconToggle.className = 'pi pi-calendar';
          btnToggle.title = 'Switch to Cluster View';
        }

        setTimeout(() => (self.isSwitching = false), 100);
      });

      // ==========================================
      // 2. ADD / UPDATE PATIENT LOCATION BUTTON
      // ==========================================
      const btnAddLocation = L.DomUtil.create('a', '', container);
      btnAddLocation.href = '#';
      btnAddLocation.style.display = 'flex';
      btnAddLocation.style.alignItems = 'center';
      btnAddLocation.style.justifyContent = 'center';
      btnAddLocation.style.width = '34px';
      btnAddLocation.style.height = '34px';
      btnAddLocation.style.textDecoration = 'none';
      btnAddLocation.style.color = '#0b4f4a';
      btnAddLocation.title = 'Add Patient Location';

      const iconAdd = L.DomUtil.create('i', 'pi pi-map-marker', btnAddLocation);
      iconAdd.style.fontSize = '1.1rem';

      L.DomEvent.disableClickPropagation(btnAddLocation);
      L.DomEvent.on(btnAddLocation, 'click', L.DomEvent.stop);
      L.DomEvent.on(btnAddLocation, 'click', (e: Event) => {
        e.preventDefault();
        self.openAddPatientLocationDialog();
      });

      // ==========================================
      // 3. COLLAPSIBLE SEARCH CONTROL
      // ==========================================
      const searchContainer = L.DomUtil.create('div', 'search-control-container search-control-container--collapsed', container);

      // Icon-only trigger button
      const iconBtn = L.DomUtil.create('button', 'search-icon-btn', searchContainer) as HTMLButtonElement;
      iconBtn.innerHTML = '<i class="pi pi-search"></i>';
      iconBtn.type = 'button';
      iconBtn.title = 'Search patients';

      // Expandable input wrapper
      const wrapper = L.DomUtil.create('div', 'search-wrapper', searchContainer);
      const input = L.DomUtil.create('input', 'search-input', wrapper) as HTMLInputElement;
      input.type = 'text';
      input.placeholder = 'Search patients…';

      const clearBtn = L.DomUtil.create('button', 'search-clear', wrapper) as HTMLButtonElement;
      clearBtn.type = 'button';
      clearBtn.innerHTML = '<i class="pi pi-times"></i>';

      const collapse = () => {
        if (input.value.length > 0) return; // Don't collapse while actively searching
        searchContainer.classList.add('search-control-container--collapsed');
      };

      const expand = () => {
        searchContainer.classList.remove('search-control-container--collapsed');
        setTimeout(() => input.focus(), 50);
      };

      iconBtn.addEventListener('click', expand);

      input.addEventListener('input', (e) => {
        const value = (e.target as HTMLInputElement).value;
        self.searchQuery.set(value);
        self.debouncedSearch();
        clearBtn.style.display = value.length > 0 ? 'flex' : 'none';
      });

      input.addEventListener('blur', () => setTimeout(collapse, 150));

      clearBtn.addEventListener('click', () => {
        input.value = '';
        self.searchQuery.set('');
        self.applySearchFilter();
        clearBtn.style.display = 'none';
        collapse();
      });

      self.searchInput = input;

      return container;
    }
  });

  new CustomControl().addTo(this.map);
}


    private popupHtml(p: Patient): string {
      const alc = p.alcNum || '—';
      const name = p.patientName || '(no name)';
      const address = p.patientHomeAddress || 'No address on file';
      const moh = p.patientMohArea || 'N/A';
      const phone = p.mobileNum || p.telNum || '—';
  
      return `
      <div style="font-family: var(--font-body, sans-serif); font-size: 0.85rem; line-height: 1.5; min-width: 220px;">
        <div style="font-weight: 600; font-size: 1rem; margin-bottom: 4px;">${this.escapeHtml(name)}</div>
        <div style="color: #6b7280; margin-bottom: 2px;">${this.escapeHtml(alc)}</div>
        <div style="color: #6b7280; margin-bottom: 2px;">${this.escapeHtml(address)}</div>
        <div style="color: #6b7280; font-size: 0.75rem; margin-top: 4px; border-top: 1px solid #e5e7eb; padding-top: 4px; margin-bottom:10px;">
          MOH: ${this.escapeHtml(moh)} | ${this.escapeHtml(phone)}
        </div>
        <button data-edit="${this.escapeHtml(p.id)}" 
          style="display:inline-flex; align-items:center; gap:6px; padding:6px 12px; font-size:0.8rem; font-weight:600; background:#0b4f4a; color:white; border:none; border-radius:6px; cursor:pointer; width:100%; justify-content:center;">
          <i class="pi pi-pencil" style="font-size:0.8rem"></i> Edit Location
        </button>
      </div>
    `;
    }*/

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

  // Replace your existing addSearchControl() method entirely with this.
