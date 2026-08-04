import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, expand, reduce, EMPTY, map, tap, catchError, throwError, forkJoin, of } from 'rxjs';
import { Patient } from './patient.model';
import { environment } from '../../../environments/environment';
import { OrgScopeService } from './org-scope.service';
import { firstValueFrom } from 'rxjs';

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

export interface OrgUnitGeometry {
  id: string;
  name: string;
  geometry: {
    type: 'Point' | 'Polygon' | 'MultiPolygon';
    coordinates: any;
  } | null;
}

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

  userDistrict() {
    return this.orgScope.healthDistricts()[0].trim();
  }

  healthDistricts() {
    return this.orgScope.healthDistrictsNew();
  }
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
      return of([]);
    }
    if (years.length === 0) {
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
      .set('pageSize', '2000')
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

    const patient: Patient = {
      // ── Identifiers ──────────────────────────────────────────────
      id: tei.trackedEntity || '',
      teiId: tei.trackedEntity || '',
      enrollmentId: enrollment?.enrollment || '',

      // ── TEI Attributes (Demographics) ────────────────────────────
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

      // ── Enrollment ──────────────────────────────────────────────
      orgUnitId: enrollment?.orgUnit ?? tei.orgUnit ?? '',
      orgUnitName: enrollment?.orgUnitName ?? '',
      enrolledAt: enrollment?.enrolledAt ?? '',
      enrollmentStatus: enrollment?.status ?? 'ACTIVE',

      // ── FIRST_VISIT Clinical Data ──────────────────────────────
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

      // ── Deformities ─────────────────────────────────────────────
      clawHand: dvMap.get(D.CLAW_HAND.uid) ?? '',
      footDrop: dvMap.get(D.FOOT_DROP.uid) ?? '',
      footUlcer: dvMap.get(D.FOOT_ULCER.uid) ?? '',
      eyeInvolvement: dvMap.get(D.EYE_INVOLVEMENT.uid) ?? '',
      faceInvolvement: dvMap.get(D.FACE_INVOLVEMENT.uid) ?? '',

      // ── GPS ─────────────────────────────────────────────────────
      latitude: latitude,
      longitude: longitude,

      // ── Visit Tracking (New Fields) ────────────────────────────
      visits: [],

      treatmentStartDate: enrollment?.enrolledAt ?? '',
      treatmentEndDate: (() => {
        const regimen = this.inferTreatmentRegimen(dvMap.get(D.TREATMENT_CLASSIFICATION.uid) ?? '');
        const start = enrollment?.enrolledAt ?? '';
        if (regimen === 'MDT-PB') return this.addMonthsIso(start, 6);
        if (regimen === 'MDT-MB') return this.addMonthsIso(start, 12);
        return '';
      })(),
      nextVisitDate: '',
      treatmentStatus: 'ongoing',
      defaultedDate: '',
      defaultReason: '',
      treatmentRegimen: this.inferTreatmentRegimen(dvMap.get(D.TREATMENT_CLASSIFICATION.uid) ?? ''),
      regimenNotes: '',
      lastVisitDate: '',

      // ── Metadata ────────────────────────────────────────────────
      createdAt: enrollment?.enrolledAt ?? now,
      updatedAt: now,
      syncStatus: 'synced'
    };

    return patient;
    /*{
      id: tei.trackedEntity,
      teiId: tei.trackedEntity,
      enrollmentId: enrollment.enrollment,
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

      clawHand: dvMap.get(D.CLAW_HAND.uid) ?? '',
      footDrop: dvMap.get(D.FOOT_DROP.uid) ?? '',
      footUlcer: dvMap.get(D.FOOT_ULCER.uid) ?? '',
      eyeInvolvement: dvMap.get(D.EYE_INVOLVEMENT.uid) ?? '',
      faceInvolvement: dvMap.get(D.FACE_INVOLVEMENT.uid) ?? '',

      latitude,
      longitude,

      createdAt: enrollment?.enrolledAt ?? now,
      updatedAt: now,
      syncStatus: 'synced'
    };*/
  }

  /**
 * Splice these methods into your existing Dhis2Service class.
 */

  /** Fetch a single org unit's boundary geometry (e.g. a district). */
  fetchOrgUnitGeometry(orgUnitId: string): Observable<OrgUnitGeometry> {
    return this.http.get<OrgUnitGeometry>(`${this.base}/organisationUnits/${orgUnitId}.json`, {
      params: { fields: 'id,name,geometry' }
    });
    //curl -i "https://dhis2-proxy.lakshakumara.workers.dev/dhis2-api/organisationUnits/Sa955F8q271?fields=id,name,geometry"
  }

  /**
   * Fetch every direct child of a given org unit (e.g. all MOH areas under
   * a district), with geometry if present. Many may come back with
   * geometry: null if PHSMIS hasn't had polygon data loaded for that level -
   * callers should handle that gracefully rather than assuming it's there.
   */
  fetchChildOrgUnitsWithGeometry(parentOrgUnitId: string): Observable<OrgUnitGeometry[]> {
    return this.http
      .get<{ organisationUnits: OrgUnitGeometry[] }>(`${this.base}/organisationUnits`, {
        params: {
          filter: `parent.id:eq:${parentOrgUnitId}`,
          fields: 'id,name,geometry',
          paging: 'false'
        }
      })
      .pipe(map((res) => res.organisationUnits ?? []));
  }

  async changePatientOrgUnit(patient: Patient, newOrgUnitId: string, newOrgUnitName: string) {

    // 1. Update TEI owner orgUnit
    const teiPayload = {
      trackedEntities: [{
        trackedEntity: patient.teiId || patient.id,
        orgUnit: newOrgUnitId
      }]
    };

    await firstValueFrom(
      this.http.post(`${this.base}/tracker?async=false&importStrategy=UPDATE`, teiPayload)
    );

    // 2. Update Enrollment orgUnit - you need enrollmentId
    // If you don't have it, fetch it first:
    // GET /api/tracker/enrollments?trackedEntity=TEI_ID&fields=enrollment,orgUnit
    const enrollmentId = await this.getEnrollmentIdForTei(patient.teiId || patient.id);

    const enrollmentPayload = {
      enrollments: [{
        enrollment: enrollmentId,
        orgUnit: newOrgUnitId,
        trackedEntity: patient.teiId || patient.id,
        program: 'YOUR_PROGRAM_UID' // e.g. leprosy program UID
      }]
    };

    await firstValueFrom(
      this.http.post(`${this.base}/tracker?async=false&importStrategy=UPDATE`, enrollmentPayload)
    );

    // 3. Update local
    patient.orgUnitId = newOrgUnitId;
    patient.orgUnitName = newOrgUnitName;
    patient.syncStatus = 'synced';
  }

  private async getEnrollmentIdForTei(teiId: string): Promise<string> {
    const res: any = await firstValueFrom(
      this.http.get(`${this.base}/tracker/enrollments?trackedEntity=${teiId}&fields=enrollment`)
    );
    return res.instances[0].enrollment; // v2.40+ returns instances
    // for old api: res.enrollments[0].enrollment
  }


  //clinic visit update


  ///111111111
  /**
   * Save a visit event to DHIS2 using Tracker API (Recommended)
   */
  async saveVisitEventWithTracker(
    patient: Patient,
    visitData: {
      visitNumber: number;
      visitDate: string;
      doseDate?: string;
      reaction?: boolean;
      reactionType?: string;
      reactionTreatment?: string;
      notes?: string;
    }
  ): Promise<{ eventId: string; success: boolean }> {
    try {
      const stageId = this.getStageIdForVisit(visitData.visitNumber);
      const dataValues = this.buildVisitDataValues(visitData);

      // Build the event object for Tracker API
      const event = {
        event: '', // Let DHIS2 generate the ID
        program: environment.dhis2.program,
        programStage: stageId,
        orgUnit: patient.orgUnitId,
        enrollment: patient.enrollmentId,
        trackedEntity: patient.teiId || patient.id,
        eventDate: visitData.visitDate,
        occurredAt: visitData.visitDate + 'T00:00:00.000Z', // ← CRITICAL: Add occurredAt
        status: 'ACTIVE',
        dataValues: dataValues
      };

      // Tracker API payload
      const payload = {
        events: [event]
      };

      console.log('Saving visit via Tracker API:', JSON.stringify(payload, null, 2));

      const response = await firstValueFrom(
        this.http.post<{
          status: string;
          importSummaries?: { reference: string; status: string; description?: string }[];
          validationReport?: {
            errorReports?: { message: string; errorCode: string; trackerType: string; uid: string }[];
          };
          stats?: { created: number; updated: number; deleted: number; ignored: number; total: number };
        }>(
          `${this.base}/tracker?async=false&importStrategy=CREATE_AND_UPDATE`,
          payload
        )
      );

      // Check for validation errors
      if (response.validationReport?.errorReports?.length) {
        const errors = response.validationReport.errorReports.map(e => e.message).join(', ');
        throw new Error(`Validation error: ${errors}`);
      }

      if (response.status === 'ERROR') {
        const error = response.importSummaries?.[0]?.description || 'Failed to save visit';
        throw new Error(error);
      }

      const eventId = response.importSummaries?.[0]?.reference;

      if (!eventId) {
        throw new Error('No event ID returned from DHIS2');
      }

      return { eventId, success: true };

    } catch (error) {
      console.error('Failed to save visit to DHIS2:', error);
      throw error;
    }
  }

  /**
   * Build data values for a visit event
   */
  private buildVisitDataValues(visitData: {
    visitNumber: number;
    visitDate: string;
    doseDate?: string;
    reaction?: boolean;
    reactionType?: string;
    reactionTreatment?: string;
    notes?: string;
  }): { dataElement: string; value: string }[] {
    const dataValues: { dataElement: string; value: string }[] = [];

    // Reaction fields (common across all visits)
    if (visitData.reaction !== undefined && visitData.reaction !== null) {
      dataValues.push({
        dataElement: 'wO4A0MXJC14', // Lep - Reaction
        value: visitData.reaction ? 'true' : 'false'
      });
    }

    if (visitData.reactionType) {
      dataValues.push({
        dataElement: 'QzRjf3Htgbn', // Lep - Type of Reaction
        value: visitData.reactionType
      });
    }

    if (visitData.reactionTreatment) {
      dataValues.push({
        dataElement: 'XsDkJS8T7D2', // Lep - Rx For reaction
        value: visitData.reactionTreatment
      });
    }

    // Dose date for visits 5-12
    const doseDateMap: Record<number, string> = {
      2: 'MJHs4by4KDD',   // Lep - Date of 2nd dose
      3: 'iUmTtQ7Ns2e',   // Lep - Date of 3rd dose
      4: 'Q9yfNalp7Zx',   // Lep - Date of 4th dose
      5: 'OrjHDf1HxkM',   // Lep - Date of 5th dose
      6: 'Aqbn33c8zhC',   // Lep - Date of 6th dose
      7: 'gZYy0bxCe4z',   // Lep - Date of 7th dose
      8: 'cT00vhW7acW',   // Lep - Date of 8th dose
      9: 'V0wKlPaB5Tl',   // Lep - Date of 9th dose
      10: 'MJY4wcQLvsG',  // Lep - Date of 10th dose
      11: 'FELbL4uIrz4',  // Lep - Date of 11th dose
      12: 'xw1t4z8CXvF',  // Lep - Date of 12th dose
    };

    const doseDateDE = doseDateMap[visitData.visitNumber];
    if (doseDateDE && visitData.doseDate) {
      dataValues.push({
        dataElement: doseDateDE,
        value: visitData.doseDate
      });
    }

    return dataValues;
  }


  /**
   * Get stage ID for a specific visit number
   */
  private getStageIdForVisit(visitNumber: number): string {
    // Map visit numbers to program stage IDs
    const stageMap: Record<number, string> = {
      1: environment.PROGRAM_STAGES.FIRST_VISIT,
      2: 'MJHs4by4KDD',   // 2nd visit (may be empty - use fallback)
      3: 'U6IkW19zK7J',   // 3rd Visit
      4: 'LxB9ArHmMGC',   // 4th Visit
      5: 'z6AnZV6phI8',   // 5th Visit
      6: 'x95G5bOeDN1',   // 6th Visit
      7: 'DhtWICcZhwK',   // 7th Visit
      8: 'xSGWfQwwD93',   // 8th Visit
      9: 'iE4QnfmTuKe',   // 9th Visit
      10: 'QdVsBuNTCrm',  // 10th Visit
      11: 'SYJtmQu4E30',  // 11th Visit
      12: 'h1TrdlCaFSc',  // 12th visit
    };

    const stageId = stageMap[visitNumber];

    if (!stageId) {
      throw new Error(`No stage found for visit number ${visitNumber}`);
    }

    // If it's visit 2 (empty stage), use extended visit as fallback
    if (visitNumber === 2) {
      console.warn('Visit 2 stage is empty in DHIS2, using Extended visit stage as fallback');
      return 'jpvOb2i5Jai'; // Extended visit stage
    }

    return stageId;
  }


  /**
   * Update patient with new visit data in DHIS2 (TEI attributes)
   */
  async updatePatientVisitsInDHIS2(patient: Patient): Promise<void> {
    try {
      // Update the patient's visit-related attributes
      // Since visit data is stored as events, we only need to update the TEI
      // if there are visit-related attributes at the TEI level

      // If you have a "current visit number" attribute, update it
      const currentVisitNumber = patient.visits?.length || 0;
      const nextVisitDate = patient.nextVisitDate || '';

      const attributes: any = [];

      // Add current visit number if you have such an attribute
      // attributes.push({
      //   attribute: 'CURRENT_VISIT_UID',
      //   value: String(currentVisitNumber)
      // });

      // Add next visit date if you have such an attribute
      // attributes.push({
      //   attribute: 'NEXT_VISIT_DATE_UID',
      //   value: nextVisitDate
      // });

      if (attributes.length > 0) {
        const payload = {
          trackedEntities: [{
            trackedEntity: patient.teiId || patient.id,
            orgUnit: patient.orgUnitId,
            attributes: attributes
          }]
        };

        await firstValueFrom(
          this.http.post(`${this.base}/tracker?async=false&importStrategy=UPDATE`, payload)
        );
      }

    } catch (error) {
      console.error('Failed to update patient visit data in DHIS2:', error);
      throw error;
    }
  }

  /**
   * Get all visits for a patient from DHIS2
   */
  async fetchPatientVisits(patientId: string): Promise<TrackerEvent[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<TrackerInstance>(`${this.base}/tracker/trackedEntities/${patientId}`, {
          params: {
            program: environment.dhis2.program,
            fields: 'enrollments[events[event,programStage,programStageName,eventDate,dataValues[dataElement,value]]]'
          }
        })
      );

      const enrollment = response?.enrollments?.[0];
      return enrollment?.events || [];

    } catch (error) {
      console.error('Failed to fetch patient visits:', error);
      return [];
    }
  }

  /**
   * Check if a visit stage is configured in DHIS2
   */
  async checkVisitStage(stageId: string): Promise<{ exists: boolean; hasDataElements: boolean }> {
    try {
      const response = await firstValueFrom(
        this.http.get<any>(`${this.base}/programStages/${stageId}`)
      );

      const hasDataElements = response?.programStageDataElements?.length > 0;

      return {
        exists: true,
        hasDataElements: hasDataElements
      };

    } catch (error) {
      return {
        exists: false,
        hasDataElements: false
      };
    }

  }
  /**
   * Save a visit event with conflict handling
   * Uses Events API for updates (simpler, fewer validation issues)
   */
  async saveVisitEventSafe(
    patient: Patient,
    visitData: {
      visitNumber: number;
      visitDate: string;
      doseDate?: string;
      reaction?: boolean;
      reactionType?: string;
      reactionTreatment?: string;
      notes?: string;
    }
  ): Promise<{ eventId: string; success: boolean }> {
    try {
      // Check if visit already exists
      const existing = await this.checkVisitExists(
        patient.enrollmentId || patient.id,
        visitData.visitNumber
      );

      if (existing.exists && existing.eventId) {
        //console.log(`Visit ${visitData.visitNumber} exists, updating via Events API...`);
        return await this.updateVisitEventViaEventsAPI(patient, existing.eventId, visitData);
      }

      //console.log(`Visit ${visitData.visitNumber} does not exist, creating via Tracker API...`);
      return await this.createVisitEventViaTrackerAPI(patient, visitData);

    } catch (error) {
      //console.error('Failed to save visit:', error);
      throw error;
    }
  }

  /**
   * Create a new visit event using Tracker API (CREATE_AND_UPDATE)
   */
  private async createVisitEventViaTrackerAPI(
    patient: Patient,
    visitData: {
      visitNumber: number;
      visitDate: string;
      doseDate?: string;
      reaction?: boolean;
      reactionType?: string;
      reactionTreatment?: string;
      notes?: string;
    }
  ): Promise<{ eventId: string; success: boolean }> {
    try {
      const stageId = this.getStageIdForVisit(visitData.visitNumber);
      const dataValues = this.buildVisitDataValues(visitData);

      const event = {
        event: '',
        program: environment.dhis2.program,
        programStage: stageId,
        orgUnit: patient.orgUnitId,
        enrollment: patient.enrollmentId,
        trackedEntity: patient.teiId || patient.id,
        eventDate: visitData.visitDate,
        occurredAt: visitData.visitDate + 'T00:00:00.000Z',
        status: 'ACTIVE',
        dataValues: dataValues
      };

      const payload = { events: [event] };
      const response = await firstValueFrom(
        this.http.post<{
          status: string;
          importSummaries?: { reference: string; status: string; description?: string }[];
          validationReport?: {
            errorReports?: { message: string; errorCode: string; trackerType: string; uid: string }[];
          };
        }>(
          `${this.base}/tracker?async=false&importStrategy=CREATE_AND_UPDATE`,
          payload
        )
      );

      if (response.validationReport?.errorReports?.length) {
        const errors = response.validationReport.errorReports.map(e => e.message).join(', ');
        throw new Error(`Validation error: ${errors}`);
      }

      if (response.status === 'ERROR') {
        const error = response.importSummaries?.[0]?.description || 'Failed to create visit';
        throw new Error(error);
      }

      const eventId = response.importSummaries?.[0]?.reference;
      if (!eventId) {
        throw new Error('No event ID returned from DHIS2');
      }

      console.log(`Visit created successfully with ID: ${eventId}`);
      return { eventId, success: true };

    } catch (error) {
      console.error('Failed to create visit:', error);
      throw error;
    }
  }

  /**
   * Update an existing visit using Events API (RECOMMENDED)
   * This avoids Tracker API's strict validation issues
   */
  private async updateVisitEventViaEventsAPI(
    patient: Patient,
    eventId: string,
    visitData: {
      visitNumber: number;
      visitDate: string;
      doseDate?: string;
      reaction?: boolean;
      reactionType?: string;
      reactionTreatment?: string;
      notes?: string;
    }
  ): Promise<{ eventId: string; success: boolean }> {
    try {
      const stageId = this.getStageIdForVisit(visitData.visitNumber);
      const dataValues = this.buildVisitDataValues(visitData);

      // Build payload for Events API
      const eventPayload = {
        event: eventId,
        program: environment.dhis2.program,
        programStage: stageId,
        orgUnit: patient.orgUnitId,
        eventDate: visitData.visitDate,
        status: 'ACTIVE',
        dataValues: dataValues
      };

      console.log('Updating visit via Events API:', JSON.stringify(eventPayload, null, 2));

      // Use PUT for Events API update
      const response = await firstValueFrom(
        this.http.put<{
          status: string;
          response?: {
            importSummaries?: Array<{
              reference: string;
              status: string;
              description?: string;
            }>;
          };
        }>(
          `${this.base}/events/${eventId}`,
          eventPayload
        )
      );

      console.log(`Visit updated successfully via Events API: ${eventId}`);
      return { eventId, success: true };

    } catch (error: any) {
      console.error('Failed to update visit via Events API:', error);

      // If Events API fails with 404, create instead
      if (error.status === 404) {
        console.log('Event not found, creating new...');
        return await this.createVisitEventViaTrackerAPI(patient, visitData);
      }

      // For other errors, try Tracker API as last resort
      try {
        console.log('Falling back to Tracker API for update...');
        return await this.updateVisitEventViaTrackerAPI(patient, eventId, visitData);
      } catch (fallbackError) {
        console.error('Tracker API fallback also failed:', fallbackError);
        throw error;
      }
    }
  }

  /**
   * Update via Tracker API (fallback - should rarely be used)
   */
  private async updateVisitEventViaTrackerAPI(
    patient: Patient,
    eventId: string,
    visitData: {
      visitNumber: number;
      visitDate: string;
      doseDate?: string;
      reaction?: boolean;
      reactionType?: string;
      reactionTreatment?: string;
      notes?: string;
    }
  ): Promise<{ eventId: string; success: boolean }> {
    try {
      const stageId = this.getStageIdForVisit(visitData.visitNumber);
      const dataValues = this.buildVisitDataValues(visitData);

      const event = {
        event: eventId,
        program: environment.dhis2.program,
        programStage: stageId,
        orgUnit: patient.orgUnitId,
        eventDate: visitData.visitDate,
        occurredAt: visitData.visitDate + 'T00:00:00.000Z',
        status: 'ACTIVE',
        dataValues: dataValues
      };

      const payload = { events: [event] };

      console.log('Updating visit via Tracker API (fallback):', JSON.stringify(payload, null, 2));

      const response = await firstValueFrom(
        this.http.post<{
          status: string;
          importSummaries?: { reference: string; status: string; description?: string }[];
          validationReport?: {
            errorReports?: { message: string; errorCode: string; trackerType: string; uid: string }[];
          };
        }>(
          `${this.base}/tracker?async=false&importStrategy=UPDATE`,
          payload
        )
      );

      if (response.validationReport?.errorReports?.length) {
        const errors = response.validationReport.errorReports.map(e => e.message).join(', ');
        throw new Error(`Validation error: ${errors}`);
      }

      if (response.status === 'ERROR') {
        const error = response.importSummaries?.[0]?.description || 'Failed to update visit';
        throw new Error(error);
      }

      return { eventId, success: true };

    } catch (error) {
      console.error('Failed to update visit via Tracker API:', error);
      throw error;
    }
  }

  /**
   * Check if a visit already exists for a patient
   */
  private async checkVisitExists(
    enrollmentId: string,
    visitNumber: number
  ): Promise<{ exists: boolean; eventId?: string }> {
    try {
      const stageId = this.getStageIdForVisit(visitNumber);

      const params = new HttpParams()
        .set('program', environment.dhis2.program)
        .set('programStage', stageId)
        .set('enrollment', enrollmentId)
        .set('fields', 'event')
        .set('pageSize', '1');

      const response = await firstValueFrom(
        this.http.get<{ events: { event: string }[] }>(
          `${this.base}/events`,
          { params }
        )
      );

      if (response.events && response.events.length > 0) {
        return { exists: true, eventId: response.events[0].event };
      }

      return { exists: false };

    } catch (error) {
      console.error('Failed to check if visit exists:', error);
      return { exists: false };
    }
  }

  ///kkkkkkkk
  /**
   * Create a new visit event (use CREATE_AND_UPDATE strategy)
   */
  private async createVisitEvent(
    patient: Patient,
    visitData: {
      visitNumber: number;
      visitDate: string;
      doseDate?: string;
      reaction?: boolean;
      reactionType?: string;
      reactionTreatment?: string;
      notes?: string;
    }
  ): Promise<{ eventId: string; success: boolean }> {
    try {
      const stageId = this.getStageIdForVisit(visitData.visitNumber);
      const dataValues = this.buildVisitDataValues(visitData);

      // Build the event object for Tracker API
      const event = {
        event: '', // Let DHIS2 generate the ID
        program: environment.dhis2.program,
        programStage: stageId,
        orgUnit: patient.orgUnitId,
        enrollment: patient.enrollmentId,
        trackedEntity: patient.teiId || patient.id,
        eventDate: visitData.visitDate,
        occurredAt: visitData.visitDate + 'T00:00:00.000Z',
        status: 'ACTIVE',
        dataValues: dataValues
      };

      const payload = { events: [event] };

      console.log('Creating new visit via Tracker API:', JSON.stringify(payload, null, 2));

      const response = await firstValueFrom(
        this.http.post<{
          status: string;
          importSummaries?: { reference: string; status: string; description?: string }[];
          validationReport?: {
            errorReports?: { message: string; errorCode: string; trackerType: string; uid: string }[];
          };
          stats?: { created: number; updated: number; deleted: number; ignored: number; total: number };
        }>(
          `${this.base}/tracker?async=false&importStrategy=CREATE_AND_UPDATE`,
          payload
        )
      );

      // Check for validation errors
      if (response.validationReport?.errorReports?.length) {
        const errors = response.validationReport.errorReports.map(e => e.message).join(', ');
        throw new Error(`Validation error: ${errors}`);
      }

      if (response.status === 'ERROR') {
        const error = response.importSummaries?.[0]?.description || 'Failed to create visit';
        throw new Error(error);
      }

      const eventId = response.importSummaries?.[0]?.reference;

      if (!eventId) {
        throw new Error('No event ID returned from DHIS2');
      }

      console.log(`Visit created successfully with ID: ${eventId}`);
      return { eventId, success: true };

    } catch (error) {
      console.error('Failed to create visit:', error);
      throw error;
    }
  }


  // dhis2.service.ts - Fixed updateVisitEvent with required fields

  /**
   * Update an existing visit event (use UPDATE strategy)
   * NOTE: Even though enrollment is immutable, DHIS2 requires orgUnit in the payload
   */
  private async updateVisitEvent(
    patient: Patient,
    eventId: string,
    visitData: {
      visitNumber: number;
      visitDate: string;
      doseDate?: string;
      reaction?: boolean;
      reactionType?: string;
      reactionTreatment?: string;
      notes?: string;
    }
  ): Promise<{ eventId: string; success: boolean }> {
    try {
      const stageId = this.getStageIdForVisit(visitData.visitNumber);
      const dataValues = this.buildVisitDataValues(visitData);

      // For UPDATE via Tracker API, include required fields
      // orgUnit IS required, but enrollment should NOT be included
      const event = {
        event: eventId,
        program: environment.dhis2.program,
        programStage: stageId,
        orgUnit: patient.orgUnitId, // Required field
        eventDate: visitData.visitDate,
        occurredAt: visitData.visitDate + 'T00:00:00.000Z',
        status: 'ACTIVE',
        dataValues: dataValues
        // enrollment: NOT included - immutable
        // trackedEntity: NOT included - immutable
      };

      const payload = { events: [event] };

      console.log('Updating visit in DHIS2:', JSON.stringify(payload, null, 2));

      const response = await firstValueFrom(
        this.http.post<{
          status: string;
          importSummaries?: { reference: string; status: string; description?: string }[];
          validationReport?: {
            errorReports?: { message: string; errorCode: string; trackerType: string; uid: string }[];
          };
        }>(
          `${this.base}/tracker?async=false&importStrategy=UPDATE`,
          payload
        )
      );

      if (response.validationReport?.errorReports?.length) {
        const errors = response.validationReport.errorReports.map(e => e.message).join(', ');
        throw new Error(`Validation error: ${errors}`);
      }

      if (response.status === 'ERROR') {
        const error = response.importSummaries?.[0]?.description || 'Failed to update visit';
        throw new Error(error);
      }

      console.log(`Visit updated successfully: ${eventId}`);
      return { eventId, success: true };

    } catch (error) {
      console.error('Failed to update visit:', error);
      throw error;
    }
  }

  /** yyyy-MM-dd + months -> yyyy-MM-dd. Returns '' if dateIso is empty/unparseable. */
  private addMonthsIso(dateIso: string, months: number): string {
    if (!dateIso) return '';
    const [y, m, d] = dateIso.split('-').map(Number);
    if (!y || !m || !d) return '';
    const dt = new Date(y, m - 1 + months, d);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }

  /**
   * treatmentClassification's real DHIS2 values are the full option-set
   * strings ("PB (1-5 lesions)" / "MB (>5 lesions)"), not bare "PB"/"MB" —
   * substring match against them, same rule as the classification filter.
   */
  private inferTreatmentRegimen(classification: string): Patient['treatmentRegimen'] {
    const c = classification.toLowerCase();
    if (c.includes('pb')) return 'MDT-PB';
    if (c.includes('mb')) return 'MDT-MB';
    return undefined;
  }


}
