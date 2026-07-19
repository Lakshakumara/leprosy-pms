
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, expand, reduce, EMPTY, map, tap, catchError, throwError, forkJoin, of } from 'rxjs';
import { Patient } from './patient.model';
import { environment } from '../../../environments/environment';
import { OrgScopeService } from './org-scope.service';

// ── DHIS2 Tracker API response shapes ─────────────────────────────────────────

interface TrackerAttribute {
  attribute: string;
  value: string;
}

interface TrackerDataValue {
  dataElement: string;
  value: string;
}

interface TrackerEvent {
  event: string;
  programStage: string;
  status: string;
  occurredAt?: string;
  dataValues: TrackerDataValue[];
}

interface TrackerEnrollment {
  enrollment: string;
  status: string;
  enrolledAt: string;
  orgUnit: string;
  orgUnitName: string;
  attributes: TrackerAttribute[];
  events: TrackerEvent[];
}

interface TrackerInstance {
  trackedEntity: string;
  orgUnit: string;
  attributes: TrackerAttribute[];
  enrollments: TrackerEnrollment[];
}

interface TrackerListResponse {
  instances: TrackerInstance[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

const A = environment.TRACKED_ENTITY_ATTRIBUTES;
const D = environment.DATA_ELEMENTS;

/**
 * Fetches leprosy patients from the DHIS2 Tracker API
 * (/api/tracker/trackedEntities), scoped to the logged-in user's actual
 * assigned district(s) - resolved via OrgScopeService, NOT read from
 * localStorage directly here (OrgScopeService already owns that caching/
 * parsing logic; duplicating it here would defeat the point of centralizing
 * it there).
 *
 * A user can legitimately be assigned to more than one district (e.g. a
 * regional supervisor role), so the default behavior fetches across ALL
 * of the user's assigned districts and merges the results. Pass an explicit
 * orgUnitId to scope to just one (e.g. a district-filter dropdown in the UI).
 *
 * Auth is handled by the dhis2AuthInterceptor (ApiToken header).
 * Requests are proxied through /dhis2-api -> https://phsmis.health.gov.lk/api.
 */
@Injectable({ providedIn: 'root' })
export class Dhis2Service {
  private readonly http = inject(HttpClient);
  private readonly orgScope = inject(OrgScopeService);
  private readonly base = environment.dhis2.baseUrl;

  /**
   * Fetch all patients under the given org unit, or - if none is passed -
   * across every district the logged-in user is assigned to.
   */
  fetchPatients(orgUnitId?: string): Observable<Patient[]> {
    if (orgUnitId) {
      return this.fetchForOrgUnit(orgUnitId);
    }

    const districts = this.orgScope.assignedDistricts();
    if (districts.length === 0) {
      console.warn('[Dhis2Service] No assigned districts on OrgScopeService - returning empty list. ' +
        'Make sure orgScope.loadCurrentUserScope() has run (e.g. at login) before calling fetchPatients().');
      return of([]);
    }

    // Multiple districts: fetch each in parallel, merge and dedupe by id
    // (a patient enrolled at a facility right on a district boundary
    // shouldn't theoretically appear twice, but dedupe defensively anyway).
    return forkJoin(districts.map((d) => this.fetchForOrgUnit(d.id))).pipe(
      map((perDistrictLists) => {
        const merged = new Map<string, Patient>();
        for (const list of perDistrictLists) {
          for (const p of list) merged.set(p.id, p);
        }
        return [...merged.values()];
      }),
      tap((patients) =>
        console.info(`[Dhis2Service] fetched ${patients.length} patient(s) across ${districts.length} district(s)`)
      )
    );
  }

  /**
   * Follow-up view: a patient LIVING in a given district may have been
   * enrolled at a facility in a completely different district - "Lep -
   * Patient District" (PATIENT_DISTRICT) records where the patient lives,
   * which is independent of which org unit actually registered them.
   * Org-unit-based scoping alone (fetchPatients()) will miss these.
   *
   * This instead searches under the user's broadest DHIS2-authorized scope
   * (teiSearchOrganisationUnits - what DHIS2 itself permits this account to
   * search, e.g. nationally), then filters results by the free-text living
   * district. Only useful if teiSearchOrganisationUnits actually extends
   * beyond the user's own assigned facilities; falls back to
   * assignedDistricts() otherwise, in which case results won't differ
   * from fetchPatients().
   *
   * NOTE: this can be a materially heavier/slower request than
   * fetchPatients() if the search scope is national - consider triggering
   * this from an explicit user action ("Load cross-district follow-ups")
   * rather than on every page load, and caching the result locally.
   */
  fetchPatientsByLivingDistrict(): Observable<Patient[]> {
    const livingDistrict = this.orgScope.healthDistricts()[0].trim();
    const searchScope = this.orgScope.scope()?.teiSearchScope ?? [];
    const searchOrgUnits = searchScope.length > 0 ? searchScope : this.orgScope.assignedDistricts();

    if (searchOrgUnits.length === 0) {
      console.warn('[Dhis2Service] No search scope available - cannot look up by living district.');
      return of([]);
    }

    return forkJoin(searchOrgUnits.map((ou) => this.fetchForOrgUnit(ou.id))).pipe(
      map((perScopeLists) => {
        const merged = new Map<string, Patient>();
        for (const list of perScopeLists) {
          for (const p of list) {
            if (p.patientDistrict?.trim().toLowerCase() === livingDistrict.toLowerCase()) {
              merged.set(p.id, p);
            }
          }
        }
        return [...merged.values()];
      }),
      tap((patients) =>
        console.info(`[Dhis2Service] found ${patients.length} patient(s) living in "${livingDistrict}" across search scope`)
      ),
      catchError((err) => {
        console.error(`[Dhis2Service] fetchPatientsByLivingDistrict("${livingDistrict}") failed:`, err);
        return throwError(() => err);
      })
    );
  }

  /**
   * Same cross-district follow-up search as fetchPatientsByLivingDistrict(),
   * but scoped to specific enrollment year(s) - e.g. [2024, 2025, 2026].
   * Fetches ONE YEAR AT A TIME using DHIS2's enrollmentEnrolledAfter /
   * enrollmentEnrolledBefore range params, so each request pulls only that
   * year's enrollments rather than the entire national history - this is
   * genuinely less data over the wire, not just filtered after the fact.
   *
   * Years don't need to be contiguous (e.g. [2024, 2026] skipping 2025
   * works fine) since each year is its own separate request.
   *
   * NOTE: enrollmentEnrolledAfter/Before are the current tracker API params
   * for this endpoint as of recent DHIS2 versions - worth a quick check
   * against PHSMIS's actual DHIS2 version docs if this 400s, since param
   * names have shifted across DHIS2 releases historically.
   */
  fetchPatientsByLivingDistrictForYears(years: number[]): Observable<Patient[]> {
    const livingDistrict = this.orgScope.healthDistricts()[0].trim();
    const searchScope = this.orgScope.scope()?.teiSearchScope ?? [];
    const searchOrgUnits = searchScope.length > 0 ? searchScope : this.orgScope.assignedDistricts();

    if (searchOrgUnits.length === 0) {
      console.warn('[Dhis2Service] No search scope available - cannot look up by living district.');
      return of([]);
    }
    if (years.length === 0) {
      console.warn('[Dhis2Service] No years provided - call fetchPatientsByLivingDistrict() instead for all-time.');
      return of([]);
    }

    // One request per (year x org unit) combination - typically just
    // "years" requests in total since searchOrgUnits is usually a single
    // national root org unit for accounts with broad teiSearchScope.
    const requests = years.flatMap((year) =>
      searchOrgUnits.map((ou) =>
        this.fetchForOrgUnit(ou.id, {
          enrolledAfter: `${year}-01-01`,
          enrolledBefore: `${year}-12-31`
        })
      )
    );

    return forkJoin(requests).pipe(
      map((perRequestLists) => {
        const merged = new Map<string, Patient>();
        for (const list of perRequestLists) {
          for (const p of list) {
            console.log(p)
            if (p.patientDistrict?.trim().toLowerCase() === livingDistrict.toLowerCase()) {
              merged.set(p.id, p);
            }
          }
        }
        return [...merged.values()];
      }),
      tap((patients) =>
        console.info(
          `[Dhis2Service] found ${patients.length} patient(s) living in "${livingDistrict}" ` +
          `enrolled in ${years.join(', ')}`
        )
      ),
      catchError((err) => {
        console.error(`[Dhis2Service] fetchPatientsByLivingDistrictForYears failed:`, err);
        return throwError(() => err);
      })
    );
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /** Fetches + paginates all patients for a single org unit (district-level, ouMode=DESCENDANTS). */
  private fetchForOrgUnit(
    orgUnitId: string,
    dateRange?: { enrolledAfter: string; enrolledBefore: string }
  ): Observable<Patient[]> {
    return this.fetchPage(orgUnitId, 1, dateRange).pipe(
      expand((response) => {
        if (response.page < response.pageCount) {
          return this.fetchPage(orgUnitId, response.page + 1, dateRange);
        }
        return EMPTY;
      }),
      reduce((acc: Patient[], response: TrackerListResponse) => {
        const mapped = (response.instances ?? []).map((tei) => this.fromDhis2(tei));
        return [...acc, ...mapped];
      }, []),
      catchError((err) => {
        console.error(`[Dhis2Service] fetchForOrgUnit(${orgUnitId}) failed:`, err);
        return throwError(() => err);
      })
    );
  }

  private fetchPage(
    orgUnitId: string,
    page: number,
    dateRange?: { enrolledAfter: string; enrolledBefore: string }
  ): Observable<TrackerListResponse> {
    const fields = [
      'trackedEntity,',
      'orgUnit,',
      'enrollments[',
      'enrollment,status,enrolledAt,orgUnit,orgUnitName,',
      'attributes[attribute,value],',
      'events[event,programStage,status,occurredAt,dataValues[dataElement,value]]',
      ']'
    ].join('');

    let params = new HttpParams()
      .set('program', environment.dhis2.program)
      .set('orgUnit', orgUnitId)
      .set('ouMode', 'DESCENDANTS')
      .set('fields', fields)
      .set('pageSize', '500')
      .set('page', String(page))
      .set('attribute', A.PATIENT_NAME.uid);

    if (dateRange) {
      params = params
        .set('enrollmentEnrolledAfter', dateRange.enrolledAfter)
        .set('enrollmentEnrolledBefore', dateRange.enrolledBefore);
    }

    return this.http.get<TrackerListResponse>(`${this.base}/tracker/trackedEntities`, { params }).pipe(
      tap((r) =>
        console.info(
          `[Dhis2Service] org ${orgUnitId}${dateRange ? ' [' + dateRange.enrolledAfter.slice(0, 4) + ']' : ''} ` +
          `page ${page}/${r?.pageCount ?? '?'} - ${r.instances?.length ?? 0} records`
        )
      )
    );
  }

  private fromDhis2(tei: TrackerInstance): Patient {
    const enrollment = (tei.enrollments ?? [])[0];
    const attributes: TrackerAttribute[] = enrollment?.attributes?.length
      ? enrollment.attributes
      : (tei.attributes ?? []);

    const attrMap = new Map(attributes.map((a) => [a.attribute, a.value]));

    const firstVisitEvent = (enrollment?.events ?? []).find(
      (e) => e.programStage === environment.PROGRAM_STAGES.FIRST_VISIT
    );
    const dvMap = new Map((firstVisitEvent?.dataValues ?? []).map((d) => [d.dataElement, d.value]));

    let latitude: number | undefined;
    let longitude: number | undefined;
    const gpsRaw = dvMap.get(D.PATIENT_GPS_COORDINATES.uid);
    if (gpsRaw) {
      try {
        const coords = JSON.parse(gpsRaw);
        if (Array.isArray(coords) && coords.length >= 2) {
          longitude = coords[0];
          latitude = coords[1];
        }
      } catch {
        /* ignore malformed GPS data */
      }
    }

    const now = new Date().toISOString();

    return {
      id: tei.trackedEntity,
      teiId: tei.trackedEntity,

      alcNum: attrMap.get(A.ALC_NUM.uid) ?? '',
      clinicNum: attrMap.get(A.CLINIC_NUM.uid) ?? '',
      nicNum: attrMap.get(A.NIC_NUM.uid) ?? '',
      guardianName: attrMap.get(A.GUARDIAN_NAME.uid) ?? '',
      mobileNum: attrMap.get(A.MOBILE_NUM.uid) ?? '',
      telNum: attrMap.get(A.TEL_NUM.uid) ?? '',
      patientName: attrMap.get(A.PATIENT_NAME.uid) ?? '',
      patientSex: attrMap.get(A.PATIENT_SEX.uid) ?? '',
      ethnicGroup: attrMap.get(A.ETHNIC_GROUP.uid) ?? '',
      patientAge: attrMap.get(A.PATIENT_AGE.uid) ?? '',

      orgUnitId: enrollment?.orgUnit ?? tei.orgUnit ?? '',
      orgUnitName: enrollment?.orgUnitName ?? '',
      enrolledAt: enrollment?.enrolledAt ?? '',
      enrollmentStatus: enrollment?.status ?? '',

      treatmentClassification: dvMap.get(D.TREATMENT_CLASSIFICATION.uid) ?? '',
      disabilityAtDiagnosis: dvMap.get(D.DISABILITY_AT_DIAGNOSIS.uid) ?? '',
      ehfScore: Number(dvMap.get(D.EHF_SCORE.uid) ?? 0),
      patientMohArea: dvMap.get(D.PATIENT_MOH_AREA.uid) ?? '',
      patientPhiArea: dvMap.get(D.PATIENT_PHI_AREA.uid) ?? '',
      patientGnDivision: dvMap.get(D.PATIENT_GN_DIVISION.uid) ?? '',
      patientDistrict: dvMap.get(D.PATIENT_DISTRICT.uid) ?? '',
      patientHomeAddress: dvMap.get(D.PATIENT_HOME_ADDRESS.uid) ?? '',
      treatmentType: dvMap.get(D.TREATMENT_TYPE.uid) ?? '',
      caseType: dvMap.get(D.CASE_TYPE.uid) ?? '',
      contactHistory: dvMap.get(D.CONTACT_HISTORY.uid) === 'true',
      contactHistorySource: dvMap.get(D.SOURCE_OF_CONTACT_HISTORY.uid) ?? '',
      relapse: dvMap.get(D.RELAPSE.uid) ?? '',
      defaulterRestartingTreatment: dvMap.get(D.DEFAULTER_RESTARTING_TREATMENT.uid) ?? '',
      changeOfTreatmentType: dvMap.get(D.CHANGE_OF_TREATMENT_TYPE.uid) ?? '',
      previousTreatmentType: dvMap.get(D.PREVIOUS_TREATMENT_TYPE.uid) ?? '',
      yearOfTreatmentCompletion: dvMap.get(D.YEAR_OF_TREATMENT_COMPLETION.uid) ?? '',
      timeSinceOnsetMonths: dvMap.get(D.TIME_SINCE_ONSET_MONTHS.uid) ?? '',
      nameOfConsultant: dvMap.get(D.NAME_OF_CONSULTANT.uid) ?? '',
      nameOfMO: dvMap.get(D.NAME_OF_MO.uid) ?? '',
      patientReferredBy: dvMap.get(D.PATIENT_REFERRED_BY.uid) ?? '',

      clawHand: dvMap.get(D.CLAW_HAND.uid) === 'true',
      footDrop: dvMap.get(D.FOOT_DROP.uid) ?? '',
      footUlcer: dvMap.get(D.FOOT_ULCER.uid) ?? '',
      eyeInvolvement: dvMap.get(D.EYE_INVOLVEMENT.uid) ?? '',
      faceInvolvement: dvMap.get(D.FACE_INVOLVEMENT.uid) ?? '',

      latitude,
      longitude,

      createdAt: enrollment?.enrolledAt ?? now,
      updatedAt: now,
      syncStatus: 'synced'
    };
  }
}



/*import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, expand, reduce, EMPTY, map, tap, catchError, throwError, forkJoin, of } from 'rxjs';
import { Patient } from './patient.model';
import { environment } from '../../../environments/environment';
import { OrgScopeService } from './org-scope.service';

// ── DHIS2 Tracker API response shapes ─────────────────────────────────────────

interface TrackerAttribute {
  attribute: string;
  value: string;
}

interface TrackerDataValue {
  dataElement: string;
  value: string;
}

interface TrackerEvent {
  event: string;
  programStage: string;
  status: string;
  occurredAt?: string;
  dataValues: TrackerDataValue[];
}

interface TrackerEnrollment {
  enrollment: string;
  status: string;
  enrolledAt: string;
  orgUnit: string;
  orgUnitName: string;
  attributes: TrackerAttribute[];
  events: TrackerEvent[];
}

interface TrackerInstance {
  trackedEntity: string;
  orgUnit: string;
  attributes: TrackerAttribute[];
  enrollments: TrackerEnrollment[];
}

interface TrackerListResponse {
  instances: TrackerInstance[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

const A = environment.TRACKED_ENTITY_ATTRIBUTES;
const D = environment.DATA_ELEMENTS;

/**
 * Fetches leprosy patients from the DHIS2 Tracker API
 * (/api/tracker/trackedEntities), scoped to the logged-in user's actual
 * assigned district(s) - resolved via OrgScopeService, NOT read from
 * localStorage directly here (OrgScopeService already owns that caching/
 * parsing logic; duplicating it here would defeat the point of centralizing
 * it there).
 *
 * A user can legitimately be assigned to more than one district (e.g. a
 * regional supervisor role), so the default behavior fetches across ALL
 * of the user's assigned districts and merges the results. Pass an explicit
 * orgUnitId to scope to just one (e.g. a district-filter dropdown in the UI).
 *
 * Auth is handled by the dhis2AuthInterceptor (ApiToken header).
 * Requests are proxied through /dhis2-api -> https://phsmis.health.gov.lk/api.
 */
/*@Injectable({ providedIn: 'root' })
export class Dhis2Service {
  private readonly http = inject(HttpClient);
  private readonly orgScope = inject(OrgScopeService);
  private readonly base = environment.dhis2.baseUrl;

  /**
   * Fetch all patients under the given org unit, or - if none is passed -
   * across every district the logged-in user is assigned to.
   
  fetchPatients(orgUnitId?: string): Observable<Patient[]> {
    if (orgUnitId) {
      return this.fetchForOrgUnit(orgUnitId);
    }

    const districts = this.orgScope.assignedDistricts();
    if (districts.length === 0) {
      console.warn('[Dhis2Service] No assigned districts on OrgScopeService - returning empty list. ' +
        'Make sure orgScope.loadCurrentUserScope() has run (e.g. at login) before calling fetchPatients().');
      return of([]);
    }

    // Multiple districts: fetch each in parallel, merge and dedupe by id
    // (a patient enrolled at a facility right on a district boundary
    // shouldn't theoretically appear twice, but dedupe defensively anyway).
    return forkJoin(districts.map((d) => this.fetchForOrgUnit(d.id))).pipe(
      map((perDistrictLists) => {
        const merged = new Map<string, Patient>();
        for (const list of perDistrictLists) {
          for (const p of list) merged.set(p.id, p);
        }
        return [...merged.values()];
      }),
      tap((patients) =>
        console.info(`[Dhis2Service] fetched ${patients.length} patient(s) across ${districts.length} district(s)`)
      )
    );
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /** Fetches + paginates all patients for a single org unit (district-level, ouMode=DESCENDANTS). */
/*private fetchForOrgUnit(orgUnitId: string): Observable<Patient[]> {
  return this.fetchPage(orgUnitId, 1).pipe(
    expand((response) => {
      if (response.page < response.pageCount) {
        return this.fetchPage(orgUnitId, response.page + 1);
      }
      return EMPTY;
    }),
    reduce((acc: Patient[], response: TrackerListResponse) => {
      const mapped = (response.instances ?? []).map((tei) => this.fromDhis2(tei));
      return [...acc, ...mapped];
    }, []),
    catchError((err) => {
      console.error(`[Dhis2Service] fetchForOrgUnit(${orgUnitId}) failed:`, err);
      return throwError(() => err);
    })
  );
}

private fetchPage(orgUnitId: string, page: number): Observable<TrackerListResponse> {
  const fields = [
    'trackedEntity,',
    'orgUnit,',
    'enrollments[',
    'enrollment,status,enrolledAt,orgUnit,orgUnitName,',
    'attributes[attribute,value],',
    'events[event,programStage,status,occurredAt,dataValues[dataElement,value]]',
    ']'
  ].join('');

  const params = new HttpParams()
    .set('program', environment.dhis2.program)
    .set('orgUnit', orgUnitId)
    .set('ouMode', 'DESCENDANTS')
    .set('fields', fields)
    .set('pageSize', '250')
    .set('page', String(page))
    .set('attribute', A.PATIENT_NAME.uid);

  return this.http.get<TrackerListResponse>(`${this.base}/tracker/trackedEntities`, { params }).pipe(
    tap((r) =>
      console.info(`[Dhis2Service] org ${orgUnitId} page ${page}/${r?.pageCount ?? '?'} - ${r.instances?.length ?? 0} records`)
    )
  );
}

private fromDhis2(tei: TrackerInstance): Patient {
  const enrollment = (tei.enrollments ?? [])[0];
  const attributes: TrackerAttribute[] = enrollment?.attributes?.length
    ? enrollment.attributes
    : (tei.attributes ?? []);

  const attrMap = new Map(attributes.map((a) => [a.attribute, a.value]));

  const firstVisitEvent = (enrollment?.events ?? []).find(
    (e) => e.programStage === environment.PROGRAM_STAGES.FIRST_VISIT
  );
  const dvMap = new Map((firstVisitEvent?.dataValues ?? []).map((d) => [d.dataElement, d.value]));

  let latitude: number | undefined;
  let longitude: number | undefined;
  const gpsRaw = dvMap.get(D.PATIENT_GPS_COORDINATES.uid);
  if (gpsRaw) {
    try {
      const coords = JSON.parse(gpsRaw);
      if (Array.isArray(coords) && coords.length >= 2) {
        longitude = coords[0];
        latitude = coords[1];
      }
    } catch {
      
    }
  }

  const now = new Date().toISOString();

  return {
    id: tei.trackedEntity,
    teiId: tei.trackedEntity,

    alcNum: attrMap.get(A.ALC_NUM.uid) ?? '',
    clinicNum: attrMap.get(A.CLINIC_NUM.uid) ?? '',
    nicNum: attrMap.get(A.NIC_NUM.uid) ?? '',
    guardianName: attrMap.get(A.GUARDIAN_NAME.uid) ?? '',
    mobileNum: attrMap.get(A.MOBILE_NUM.uid) ?? '',
    telNum: attrMap.get(A.TEL_NUM.uid) ?? '',
    patientName: attrMap.get(A.PATIENT_NAME.uid) ?? '',
    patientSex: attrMap.get(A.PATIENT_SEX.uid) ?? '',
    ethnicGroup: attrMap.get(A.ETHNIC_GROUP.uid) ?? '',
    patientAge: attrMap.get(A.PATIENT_AGE.uid) ?? '',

    orgUnitId: enrollment?.orgUnit ?? tei.orgUnit ?? '',
    orgUnitName: enrollment?.orgUnitName ?? '',
    enrolledAt: enrollment?.enrolledAt ?? '',
    enrollmentStatus: enrollment?.status ?? '',

    treatmentClassification: dvMap.get(D.TREATMENT_CLASSIFICATION.uid) ?? '',
    disabilityAtDiagnosis: dvMap.get(D.DISABILITY_AT_DIAGNOSIS.uid) ?? '',
    ehfScore: Number(dvMap.get(D.EHF_SCORE.uid) ?? 0),
    patientMohArea: dvMap.get(D.PATIENT_MOH_AREA.uid) ?? '',
    patientPhiArea: dvMap.get(D.PATIENT_PHI_AREA.uid) ?? '',
    patientGnDivision: dvMap.get(D.PATIENT_GN_DIVISION.uid) ?? '',
    patientDistrict: dvMap.get(D.PATIENT_DISTRICT.uid) ?? '',
    patientHomeAddress: dvMap.get(D.PATIENT_HOME_ADDRESS.uid) ?? '',
    treatmentType: dvMap.get(D.TREATMENT_TYPE.uid) ?? '',
    caseType: dvMap.get(D.CASE_TYPE.uid) ?? '',
    contactHistory: dvMap.get(D.CONTACT_HISTORY.uid) === 'true',
    contactHistorySource: dvMap.get(D.SOURCE_OF_CONTACT_HISTORY.uid) ?? '',
    relapse: dvMap.get(D.RELAPSE.uid) ?? '',
    defaulterRestartingTreatment: dvMap.get(D.DEFAULTER_RESTARTING_TREATMENT.uid) ?? '',
    changeOfTreatmentType: dvMap.get(D.CHANGE_OF_TREATMENT_TYPE.uid) ?? '',
    previousTreatmentType: dvMap.get(D.PREVIOUS_TREATMENT_TYPE.uid) ?? '',
    yearOfTreatmentCompletion: dvMap.get(D.YEAR_OF_TREATMENT_COMPLETION.uid) ?? '',
    timeSinceOnsetMonths: dvMap.get(D.TIME_SINCE_ONSET_MONTHS.uid) ?? '',
    nameOfConsultant: dvMap.get(D.NAME_OF_CONSULTANT.uid) ?? '',
    nameOfMO: dvMap.get(D.NAME_OF_MO.uid) ?? '',
    patientReferredBy: dvMap.get(D.PATIENT_REFERRED_BY.uid) ?? '',

    clawHand: dvMap.get(D.CLAW_HAND.uid) === 'true',
    footDrop: dvMap.get(D.FOOT_DROP.uid) ?? '',
    footUlcer: dvMap.get(D.FOOT_ULCER.uid) ?? '',
    eyeInvolvement: dvMap.get(D.EYE_INVOLVEMENT.uid) ?? '',
    faceInvolvement: dvMap.get(D.FACE_INVOLVEMENT.uid) ?? '',

    latitude,
    longitude,

    createdAt: enrollment?.enrolledAt ?? now,
    updatedAt: now,
    syncStatus: 'synced'
  };
}
}*/