/**
 * DTOs for DHIS2 Organisation Units (`/api/organisationUnits`).
 *
 * Org units form a hierarchy (e.g. Country -> Province -> District ->
 * Facility). `LCZgWKWn71b` ("TH-Rathnapura") from the sample payload is just
 * ONE leaf node in that tree — it should never be hardcoded since the actual
 * org unit depends on which facility/user is submitting data.
 */

export interface OrgUnitDto {
  id: string;
  name: string;
  displayName: string;
  level: number;
  path: string;              // e.g. '/ImspTQPwCqd/.../LCZgWKWn71b'
  parent?: {
    id: string;
    name: string;
  };
  children?: OrgUnitDto[];
}

/** Shape returned by GET /api/organisationUnits.json?... (paged list) */
export interface OrgUnitListResponseDto {
  pager?: {
    page: number;
    pageCount: number;
    total: number;
    pageSize: number;
  };
  organisationUnits: OrgUnitDto[];
}
