import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { STORAGE_KEYS } from '../util/util';
import { DeviceStorageService } from './device-storage.service';

export interface OrgUnitRef {
  id: string;
  name: string;
  level: number;
}

export interface OrgUnitWithAncestors extends OrgUnitRef {
  ancestors?: OrgUnitRef[];
}

export interface CurrentUserOrgScope {
  userId: string;
  username: string;
  assignedFacilities: OrgUnitRef[];
  assignedDistricts: OrgUnitRef[];
  teiSearchScope: OrgUnitRef[];
  cachedAt: string;
}

@Injectable({ providedIn: 'root' })
export class OrgScopeService {
  private readonly http = inject(HttpClient);
  private readonly storage = inject(DeviceStorageService);
  private readonly base = environment.dhis2.baseUrl;

  private readonly DISTRICT_NAME_OVERRIDES: Record<string, string> = {
    'NuwaraEliya': 'Nuwara Eliya'
  };
  private readonly _scope = signal<CurrentUserOrgScope | null>(null);
  readonly scope = this._scope.asReadonly();
  readonly assignedDistricts = computed(() => this._scope()?.assignedDistricts ?? []);
  readonly assignedFacilities = computed(() => this._scope()?.assignedFacilities ?? []);
  readonly hasScope = computed(() => this._scope() !== null);

  readonly healthDistricts = computed(() => {
    const suffixPattern = /\s+(RDHS|RD)\s*$/i;
    return this._scope()?.assignedDistricts
      .map((d) => d.name.replace(suffixPattern, '').trim())
      .map((name) => this.DISTRICT_NAME_OVERRIDES[name] ?? name)
      .filter((name) => name.length > 0)
      ?? [];
  });

  readonly healthDistrictsNew = computed(() => {
    const suffixPattern = /\s+(RDHS|RD)\s*$/i;
    const dis = this._scope()?.assignedDistricts
      .map((d) => {
        const value =d.name.replace(suffixPattern, '').trim();
        return {
          label: this.DISTRICT_NAME_OVERRIDES[d.name.replace(suffixPattern, '').trim()] ?? value, 
          value: value,
        } 
      }) ?? [];

    return dis;
  });
  
  private districtLevelCache: number | null = null;

  restoreFromCache(): boolean {
    const cached = this.storage.getJSON<CurrentUserOrgScope>(STORAGE_KEYS.ORG_SCOPE);
    if (!cached) return false;
    this._scope.set(cached);
    return true;
  }

  async refreshFromServer(): Promise<CurrentUserOrgScope> {
    const districtLevel = await this.resolveDistrictLevel();

    const me = await firstValueFrom(
      this.http.get<{
        id: string;
        username: string;
        organisationUnits: OrgUnitWithAncestors[];
        teiSearchOrganisationUnits: OrgUnitRef[];
      }>(`${this.base}/me`, {
        params: {
          fields:
            'id,username,organisationUnits[id,name,level,ancestors[id,name,level]],teiSearchOrganisationUnits[id,name,level]'
        }
      })
    );

    const districtMap = new Map<string, OrgUnitRef>();
    for (const facility of me.organisationUnits ?? []) {
      if (facility.level === districtLevel) {
        districtMap.set(facility.id, { id: facility.id, name: facility.name, level: facility.level });
        continue;
      }
      const district = facility.ancestors?.find((a) => a.level === districtLevel);
      if (district) districtMap.set(district.id, district);
    }

    const result: CurrentUserOrgScope = {
      userId: me.id,
      username: me.username,
      assignedFacilities: (me.organisationUnits ?? []).map((f) => ({ id: f.id, name: f.name, level: f.level })),
      assignedDistricts: [...districtMap.values()],
      teiSearchScope: me.teiSearchOrganisationUnits ?? [],
      cachedAt: new Date().toISOString()
    };

    this._scope.set(result);
    this.storage.setJSON(STORAGE_KEYS.ORG_SCOPE, result);
    return result;
  }

  async loadCurrentUserScope(): Promise<CurrentUserOrgScope | null> {
    this.restoreFromCache();
    try {
      return await this.refreshFromServer();
    } catch (err) {
      console.warn('[OrgScopeService] refreshFromServer failed, using cached scope if available:', err);
      return this._scope();
    }
  }

  clear(): void {
    this._scope.set(null);
    this.districtLevelCache = null;
    this.storage.remove(STORAGE_KEYS.ORG_SCOPE);
  }

  private async resolveDistrictLevel(): Promise<number> {
    if (this.districtLevelCache != null) return this.districtLevelCache;

    const res = await firstValueFrom(
      this.http.get<{ organisationUnitLevels: { level: number; name: string }[] }>(
        `${this.base}/organisationUnitLevels`,
        { params: { fields: 'level,name', order: 'level:asc' } }
      )
    );

    const match = res.organisationUnitLevels?.find((l) => /district/i.test(l.name));
    if (!match) {
      console.warn('[OrgScopeService] No org unit level named "district" found - falling back to level 3.');
      this.districtLevelCache = 3;
      return 3;
    }

    this.districtLevelCache = match.level;
    return match.level;
  }


}