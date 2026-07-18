import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

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
  /** The user's actual capture/data-entry org units (usually facility level). */
  assignedFacilities: OrgUnitRef[];
  /** Distinct districts derived from each facility's ancestor chain. */
  assignedDistricts: OrgUnitRef[];
  /** How far this user's TEI search is allowed to reach (from teiSearchOrganisationUnits). */
  teiSearchScope: OrgUnitRef[];
}

/**
 * Resolves a logged-in DHIS2 user's org-unit scope dynamically - no
 * hardcoded UIDs or hierarchy-level numbers. Works against any DHIS2
 * instance because it first asks the instance which level is "district"
 * rather than assuming level 3 (that varies by country/instance).
 */
@Injectable({ providedIn: 'root' })
export class OrgScopeService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.dhis2.baseUrl;

  private readonly _scope = signal<CurrentUserOrgScope | null>(null);
  readonly scope = this._scope.asReadonly();
  readonly assignedDistricts = computed(() => this._scope()?.assignedDistricts ?? []);
  readonly assignedFacilities = computed(() => this._scope()?.assignedFacilities ?? []);

  private districtLevelCache: number | null = null;

  /** Call this once right after login, before the rest of the app needs org scope. */
  async loadCurrentUserScope(): Promise<CurrentUserOrgScope> {
    const districtLevel = await this.resolveDistrictLevel();

    const me = await firstValueFrom(
      this.http.get<{
        id: string;
        username: string;
        organisationUnits: OrgUnitWithAncestors[];
        teiSearchOrganisationUnits: OrgUnitRef[];
      }>(`${this.base}/me`, {
        params: {
          fields: 'id,username,organisationUnits[id,name,level,ancestors[id,name,level]],teiSearchOrganisationUnits[id,name,level]'
        }
      })
    );

    const districtMap = new Map<string, OrgUnitRef>();
    for (const facility of me.organisationUnits ?? []) {
      // The facility itself might already BE the district level (some
      // users are assigned directly at district level, not facility).
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
      teiSearchScope: me.teiSearchOrganisationUnits ?? []
    };
    console.log('result', result)
    this._scope.set(result);
    return result;
  }

  clear(): void {
    this._scope.set(null);
    this.districtLevelCache = null;
  }

  /**
   * Finds which hierarchy level is "district" on THIS instance, by name
   * rather than a hardcoded number. Falls back to level 3 (the common
   * default across most DHIS2 country configs) only if no level name
   * matches - log a warning in that case so it's visible during setup,
   * since silently guessing wrong here would misclassify every user.
   */
  private async resolveDistrictLevel(): Promise<number> {
    if (this.districtLevelCache != null) return this.districtLevelCache;

    const res = await firstValueFrom(
      this.http.get<{ organisationUnitLevels: { level: number; name: string }[] }>(
        `${this.base}/organisationUnitLevels`,
        { params: { fields: 'level,name', order: 'level:asc' } }
      )
    );
console.log('res', res)
    const match = res.organisationUnitLevels?.find((l) => /district/i.test(l.name));
    if (!match) {
      console.warn(
        '[OrgScopeService] No org unit level named "district" found on this instance - ' +
        'falling back to level 3. Verify this against /api/organisationUnitLevels.json for this instance.'
      );
      this.districtLevelCache = 3;
      return 3;
    }

    this.districtLevelCache = match.level;
    return match.level;
  }
}
