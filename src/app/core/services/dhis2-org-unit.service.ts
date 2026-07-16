import { environment } from "../../../environments/environment";
import { OrgUnitDto, OrgUnitListResponseDto } from "../models/dhis2-org-unit.dto";


/**
 * Fetches organisation units from DHIS2 at runtime instead of hardcoding one.
 *
 * Assumes the DHIS2 instance is reachable at environment.dhis2.baseUrl and
 * that auth (basic auth header / cookie / bearer token) is attached via
 * `authHeaders` — plug in whatever your app already uses for DHIS2 auth.
 */
export class Dhis2OrgUnitService {
  constructor(
    private readonly baseUrl: string = environment.dhis2.baseUrl,
    private readonly authHeaders: Record<string, string> = {},
  ) {}

  /**
   * Fetch ALL org units (paged internally, results concatenated).
   * Use sparingly on large instances — prefer getOrgUnitsByLevel or
   * searchOrgUnits when possible to avoid pulling the entire tree.
   */
  async getAllOrgUnits(pageSize = 500): Promise<OrgUnitDto[]> {
    const all: OrgUnitDto[] = [];
    let page = 1;
    let pageCount = 1;

    do {
      const url =
        `${this.baseUrl}${environment.dhis2.endpoints.organisationUnits}.json` +
        `?fields=id,name,displayName,level,path,parent[id,name]` +
        `&paging=true&pageSize=${pageSize}&page=${page}`;

      const res = await fetch(url, { headers: this.authHeaders });
      if (!res.ok) {
        throw new Error(`Failed to fetch org units: ${res.status} ${res.statusText}`);
      }

      const data: OrgUnitListResponseDto = await res.json();
      all.push(...data.organisationUnits);
      pageCount = data.pager?.pageCount ?? 1;
      page += 1;
    } while (page <= pageCount);

    return all;
  }

  /**
   * Fetch the direct children of a given org unit (e.g. the 6 facilities
   * under "Ratnapura RDHS"). This is what powers the GUI filter dropdown —
   * do NOT hardcode the facility list, since it can change.
   */
  async getChildOrgUnits(parentId: string): Promise<OrgUnitDto[]> {
    const url =
      `${this.baseUrl}${environment.dhis2.endpoints.organisationUnits}.json` +
      `?filter=parent.id:eq:${parentId}` +
      `&fields=id,name,displayName,level,path,parent[id,name]` +
      `&paging=false`;

    const res = await fetch(url, { headers: this.authHeaders });
    if (!res.ok) {
      throw new Error(`Failed to fetch child org units: ${res.status} ${res.statusText}`);
    }
    const data: OrgUnitListResponseDto = await res.json();
    return data.organisationUnits;
  }

  /**
   * Convenience wrapper: facilities (level 4) under the configured district
   * (defaults to environment.dhis2.district.id — e.g. "Ratnapura RDHS").
   * This is the direct source for your GUI's org unit filter options.
   */
  async getFacilitiesForDistrict(
    districtId: string = environment.dhis2.district.id,
  ): Promise<OrgUnitDto[]> {
    return this.getChildOrgUnits(districtId);
  }

  /** Fetch org units at a specific hierarchy level (e.g. 4 = facility level). */
  async getOrgUnitsByLevel(level: number): Promise<OrgUnitDto[]> {
    const url =
      `${this.baseUrl}${environment.dhis2.endpoints.organisationUnits}.json` +
      `?filter=level:eq:${level}` +
      `&fields=id,name,displayName,level,path,parent[id,name]` +
      `&paging=false`;

    const res = await fetch(url, { headers: this.authHeaders });
    if (!res.ok) {
      throw new Error(`Failed to fetch org units by level: ${res.status} ${res.statusText}`);
    }
    const data: OrgUnitListResponseDto = await res.json();
    return data.organisationUnits;
  }

  /** Search org units by name (typeahead / dropdown filtering). */
  async searchOrgUnits(query: string): Promise<OrgUnitDto[]> {
    const url =
      `${this.baseUrl}${environment.dhis2.endpoints.organisationUnits}.json` +
      `?query=${encodeURIComponent(query)}` +
      `&fields=id,name,displayName,level,path,parent[id,name]` +
      `&paging=false`;

    const res = await fetch(url, { headers: this.authHeaders });
    if (!res.ok) {
      throw new Error(`Failed to search org units: ${res.status} ${res.statusText}`);
    }
    const data: OrgUnitListResponseDto = await res.json();
    return data.organisationUnits;
  }

  /** Fetch a single org unit by UID (e.g. to resolve the one in the sample payload). */
  async getOrgUnitById(id: string): Promise<OrgUnitDto> {
    const url =
      `${this.baseUrl}${environment.dhis2.endpoints.organisationUnits}/${id}.json` +
      `?fields=id,name,displayName,level,path,parent[id,name],children[id,name]`;

    const res = await fetch(url, { headers: this.authHeaders });
    if (!res.ok) {
      throw new Error(`Failed to fetch org unit ${id}: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  /** Fetch children of the org units assigned to the current authenticated user. */
  async getMyOrgUnits(): Promise<OrgUnitDto[]> {
    const url = `${this.baseUrl}/me.json?fields=organisationUnits[id,name,displayName,level,path]`;
    const res = await fetch(url, { headers: this.authHeaders });
    if (!res.ok) {
      throw new Error(`Failed to fetch current user org units: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return data.organisationUnits ?? [];
  }
}
