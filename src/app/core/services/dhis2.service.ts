import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, expand, reduce, EMPTY, map, tap, catchError, throwError, forkJoin, of } from 'rxjs';
import { Patient, SimplifiedVisit } from './patient.model';
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
const doseDateMap: Record<number, string> = {
  1:'JGChabLUuiU',
      // Lep - Date of 2nd dose is mission in centrsl DHIS@ system the forward one step complete course
      2: 'iUmTtQ7Ns2e',   // Lep - Date of 3rd dose
      3: 'Q9yfNalp7Zx',   // Lep - Date of 4th dose
      4: 'OrjHDf1HxkM',   // Lep - Date of 5th dose
      5: 'Aqbn33c8zhC',   // Lep - Date of 6th dose
      6: 'gZYy0bxCe4z',   // Lep - Date of 7th dose
      7: 'cT00vhW7acW',   // Lep - Date of 8th dose
      8: 'V0wKlPaB5Tl',   // Lep - Date of 9th dose
      9: 'MJY4wcQLvsG',  // Lep - Date of 10th dose
      10: 'FELbL4uIrz4',  // Lep - Date of 11th dose
      11: 'xw1t4z8CXvF',  // Lep - Date of 12th dose
      12: 'QwZQUEWQ5TS',  // Lep - Year of treatment completion
    };

    
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
  console.log('[Dhis2Service] mapping TEI', tei);
  const enrollment = (tei.enrollments?? [])[0];
  const attributes: TrackerAttribute[] = enrollment?.attributes?.length? enrollment.attributes : (tei.attributes?? []);
  const attrMap = new Map(attributes.map(a => [a.attribute, a.value]));

  const firstVisitEvent = (enrollment?.events?? []).find(e => e.programStage === environment.PROGRAM_STAGES.STAGE_1);
  const dvMap = new Map((firstVisitEvent?.dataValues?? []).map(d => [d.dataElement, d.value]));

  let latitude: number | undefined; let longitude: number | undefined;
  const gpsRaw = dvMap.get(D.PATIENT_GPS_COORDINATES.uid);
  if (gpsRaw) { try { const c = JSON.parse(gpsRaw); longitude=c[0]; latitude=c[1]; } catch {} }

  const now = new Date().toISOString();

  // ── BUILD 12 VISITS - ALWAYS 12 ITEMS ─────────────────────
  const STAGE_ORDER = [
    { visitNumber: 1, stageId: environment.PROGRAM_STAGES.STAGE_1 },
    { visitNumber: 2, stageId: environment.PROGRAM_STAGES.STAGE_2 },
    { visitNumber: 3, stageId: environment.PROGRAM_STAGES.STAGE_3 },
    { visitNumber: 4, stageId: environment.PROGRAM_STAGES.STAGE_4 },
    { visitNumber: 5, stageId: environment.PROGRAM_STAGES.STAGE_5 },
    { visitNumber: 6, stageId: environment.PROGRAM_STAGES.STAGE_6 },
    { visitNumber: 7, stageId: environment.PROGRAM_STAGES.STAGE_7 },
    { visitNumber: 8, stageId: environment.PROGRAM_STAGES.STAGE_8 },
    { visitNumber: 9, stageId: environment.PROGRAM_STAGES.STAGE_9 },
    { visitNumber: 10, stageId: environment.PROGRAM_STAGES.STAGE_10 },
    { visitNumber: 11, stageId: environment.PROGRAM_STAGES.STAGE_11 },
    { visitNumber: 12, stageId: environment.PROGRAM_STAGES.STAGE_12 },
  ];

  const DOSE_DATE_DE_MAP: Record<string, string> = {
    'x0vRwubw5S7': '',
    'U6IkW19zK7J': 'iUmTtQ7Ns2e',
    'LxB9ArHmMGC': 'Q9yfNalp7Zx',
    'z6AnZV6phI8': 'OrjHDf1HxkM',
    'x95G5bOeDN1': 'Aqbn33c8zhC',
    'DhtWICcZhwK': 'gZYy0bxCe4z',
    'xSGWfQwwD93': 'cT00vhW7acW',
    'iE4QnfmTuKe': 'V0wKlPaB5Tl',
    'QdVsBuNTCrm': 'MJY4wcQLvsG',
    'SYJtmQu4E30': 'FELbL4uIrz4',
    'h1TrdlCaFSc': 'xw1t4z8CXvF',
    'LqgKGaiwXua': 'QwZQUEWQ5TS'
  };

  const REACTION_DE = 'wO4A0MXJC14';
  const REACTION_TYPE_DE = 'QzRjf3Htgbn';
  const REACTION_RX_DE = 'XsDkJS8T7D2';

  const eventsByStage = new Map((enrollment?.events?? []).map(e => [e.programStage, e]));

  const visits: SimplifiedVisit[] = STAGE_ORDER.map(({ visitNumber, stageId }) => {
    const ev = eventsByStage.get(stageId);

    // NO event yet -> placeholder for UI
    if (!ev) {
      return {
        id: `${tei.trackedEntity}-v${visitNumber}`,
        visitNumber,
        visitDate: '',
        doseDate: '',
        syncStatus: 'synced' as const,
      };
    }

    const evDvMap = new Map((ev.dataValues?? []).map(d => [d.dataElement, d.value]));
    const doseDeId = DOSE_DATE_DE_MAP[stageId];

    // 1. Dose date from DE, 2. occurredAt, 3. scheduledAt
    const doseFromDE = doseDeId? evDvMap.get(doseDeId) : undefined;
    const occurred = ev.occurredAt?.split('T')[0];
    //const scheduled = ev.scheduledAt?.split('T')[0];
    const enrollmentDateStr = (enrollment?.enrolledAt || '').split('T')[0];

    let doseDate = '';
    if (visitNumber === 1) {
      doseDate = enrollmentDateStr || occurred || (doseFromDE? String(doseFromDE).split('T')[0] : '');
    } else {
      doseDate = (doseFromDE? String(doseFromDE).split('T')[0] : '') || occurred || '';
    }

    // If SCHEDULE and no date, keep empty but still return
    // NEVER return empty for visit 1
      if (ev.status === 'SCHEDULE' &&!doseDate) {
        if (visitNumber === 1) {
          return {
            id: ev.event,
            visitNumber,
            visitDate: enrollmentDateStr || '',
            doseDate: enrollmentDateStr || '',
            syncStatus: 'synced' as const,
          };
        }
        return {
          id: ev.event,
          visitNumber,
          visitDate: '',
          doseDate: '',
          syncStatus: 'synced' as const,
        };
      }

    return {
      id: ev.event,
      visitNumber,
      visitDate: doseDate,
      doseDate: doseDate,
      reaction: evDvMap.get(REACTION_DE) === 'true'? true : evDvMap.get(REACTION_DE) === 'false'? false : undefined,
      reactionType: evDvMap.get(REACTION_TYPE_DE),
      reactionTreatment: evDvMap.get(REACTION_RX_DE),
      notes: '',
      syncStatus: 'synced' as const,
    };
  });

  // rest of your patient mapping...
  const patient: Patient = {
    id: tei.trackedEntity || '',
    teiId: tei.trackedEntity || '',
    enrollmentId: enrollment?.enrollment || '',
    alcNum: attrMap.get(A.ALC_NUM.uid)?? '',
    clinicNum: attrMap.get(A.CLINIC_NUM.uid)?? '',
    nicNum: attrMap.get(A.NIC_NUM.uid)?? '',
    guardianName: attrMap.get(A.GUARDIAN_NAME.uid)?? '',
    mobileNum: attrMap.get(A.MOBILE_NUM.uid)?? '',
    telNum: attrMap.get(A.TEL_NUM.uid)?? '',
    patientName: attrMap.get(A.PATIENT_NAME.uid)?? '',
    patientSex: attrMap.get(A.PATIENT_SEX.uid)?? '',
    ethnicGroup: attrMap.get(A.ETHNIC_GROUP.uid)?? '',
    patientAge: attrMap.get(A.PATIENT_AGE.uid)?? '',
    orgUnitId: enrollment?.orgUnit?? tei.orgUnit?? '',
    orgUnitName: enrollment?.orgUnitName?? '',
    enrolledAt: enrollment?.enrolledAt?? '',
    enrollmentStatus: enrollment?.status?? 'ACTIVE',
    treatmentClassification: dvMap.get(D.TREATMENT_CLASSIFICATION.uid)?? '',
    disabilityAtDiagnosis: dvMap.get(D.DISABILITY_AT_DIAGNOSIS.uid)?? '',
    ehfScore: Number(dvMap.get(D.EHF_SCORE.uid)?? 0),
    patientMohArea: dvMap.get(D.PATIENT_MOH_AREA.uid)?? '',
    patientPhiArea: dvMap.get(D.PATIENT_PHI_AREA.uid)?? '',
    patientGnDivision: dvMap.get(D.PATIENT_GN_DIVISION.uid)?? '',
    patientDistrict: dvMap.get(D.PATIENT_DISTRICT.uid)?? '',
    patientHomeAddress: dvMap.get(D.PATIENT_HOME_ADDRESS.uid)?? '',
    treatmentType: dvMap.get(D.TREATMENT_TYPE.uid)?? '',
    caseType: dvMap.get(D.CASE_TYPE.uid)?? '',
    contactHistory: dvMap.get(D.CONTACT_HISTORY.uid) === 'true',
    contactHistorySource: dvMap.get(D.SOURCE_OF_CONTACT_HISTORY.uid)?? '',
    relapse: dvMap.get(D.RELAPSE.uid)?? '',
    defaulterRestartingTreatment: dvMap.get(D.DEFAULTER_RESTARTING_TREATMENT.uid)?? '',
    changeOfTreatmentType: dvMap.get(D.CHANGE_OF_TREATMENT_TYPE.uid)?? '',
    previousTreatmentType: dvMap.get(D.PREVIOUS_TREATMENT_TYPE.uid)?? '',
    yearOfTreatmentCompletion: dvMap.get(D.YEAR_OF_TREATMENT_COMPLETION.uid)?? '',
    timeSinceOnsetMonths: dvMap.get(D.TIME_SINCE_ONSET_MONTHS.uid)?? '',
    nameOfConsultant: dvMap.get(D.NAME_OF_CONSULTANT.uid)?? '',
    nameOfMO: dvMap.get(D.NAME_OF_MO.uid)?? '',
    patientReferredBy: dvMap.get(D.PATIENT_REFERRED_BY.uid)?? '',
    clawHand: dvMap.get(D.CLAW_HAND.uid)?? '',
    footDrop: dvMap.get(D.FOOT_DROP.uid)?? '',
    footUlcer: dvMap.get(D.FOOT_ULCER.uid)?? '',
    eyeInvolvement: dvMap.get(D.EYE_INVOLVEMENT.uid)?? '',
    faceInvolvement: dvMap.get(D.FACE_INVOLVEMENT.uid)?? '',
    latitude, longitude,
    visits,
    treatmentStartDate: enrollment?.enrolledAt?? '',
    treatmentEndDate: (() => { const r = this.inferTreatmentRegimen(dvMap.get(D.TREATMENT_CLASSIFICATION.uid)?? ''); const s = enrollment?.enrolledAt?? ''; if (r === 'MDT-PB') return this.addMonthsIso(s, 6); if (r === 'MDT-MB') return this.addMonthsIso(s, 12); return ''; })(),
    nextVisitDate: '',
    treatmentStatus: 'ongoing',
    defaultedDate: '', defaultReason: '',
    treatmentRegimen: this.inferTreatmentRegimen(dvMap.get(D.TREATMENT_CLASSIFICATION.uid)?? ''),
    regimenNotes: '',
    lastVisitDate: [...visits].reverse().find(v => v.visitDate)?.visitDate?? '',
    createdAt: enrollment?.enrolledAt?? now,
    updatedAt: now,
    syncStatus: 'synced'
  };
  return patient;
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
      console.log(JSON.stringify(response.validationReport, null, 2));

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

    
    console.log('visitData.visitNumber', visitData.visitNumber)
    const doseDateDE = doseDateMap[visitData.visitNumber];
    console.log('doseDateDE', doseDateDE)
    if (doseDateDE && visitData.doseDate) {
      dataValues.push({
        dataElement: doseDateDE,
        value: visitData.doseDate
      });
    }
    console.log('visitData.doseDate', visitData.doseDate)
    console.log('saving dataValues', dataValues)
    return dataValues;
  }


  /**
   * Get stage ID for a specific visit number
   */
  private getStageIdForVisit(visitNumber: number): string {
    const stageMap: Record<number, string> = {
      1: environment.PROGRAM_STAGES.STAGE_1,
      2: environment.PROGRAM_STAGES.STAGE_2,
      3: environment.PROGRAM_STAGES.STAGE_3,
      4: environment.PROGRAM_STAGES.STAGE_4,
      5: environment.PROGRAM_STAGES.STAGE_5,
      6: environment.PROGRAM_STAGES.STAGE_6,
      7: environment.PROGRAM_STAGES.STAGE_7,
      8: environment.PROGRAM_STAGES.STAGE_8,
      9: environment.PROGRAM_STAGES.STAGE_9,
      10: environment.PROGRAM_STAGES.STAGE_10,
      11: environment.PROGRAM_STAGES.STAGE_11,
      12: environment.PROGRAM_STAGES.STAGE_12,
    };

    const stageId = stageMap[visitNumber];

    if (!stageId) {
      throw new Error(`No stage found for visit number ${visitNumber}`);
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
      console.log('events', enrollment?.events)
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
   *Currently using
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
        patient.enrollmentId,
        visitData.visitNumber
      );
///chsck here is ok
console.log('original patient', patient)
console.log('exixting', existing)

      if (existing.exists && existing.eventId) {
        console.log(`Visit ${visitData.visitNumber} exists, updating via Events API...`);
        return await this.updateVisitEventViaEventsAPI(patient, existing?.eventId, visitData);
      }

      console.log(`Visit ${visitData.visitNumber} does not exist, creating via Tracker API...`);
      return await this.createVisitEventViaTrackerAPI(patient, visitData);
      
    } catch (error) {
      //console.error('Failed to save visit:', error);
      throw error;
    }
  }
  private async checkVisitExists(enrollmentId: string, visitNumber: number) {
  const stageId = this.getStageIdForVisit(visitNumber);
  const res = await firstValueFrom(
    this.http.get<any>(`${this.base}/tracker/enrollments/${enrollmentId}?fields=events[event,programStage]`)
  );
  const found = res.events?.find((e: any) => e.programStage === stageId);
  return found ? { exists: true, eventId: found.event } : { exists: false };
}

  /* private async checkVisitExists(
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
  }*/

 /**
   * Update an existing visit using Events API (RECOMMENDED)
   * This avoids Tracker API's strict validation issues
   */
  private async updateVisitEventViaEventsAPI(
    patient: Patient,
    eventId: string,
    visitData: {
      visitNumber: number;
      visitDate: string; // YYYY-MM-DD
      doseDate?: string;
      reaction?: boolean;
      reactionType?: string;
      reactionTreatment?: string;
      notes?: string;
    }
  ): Promise<{ eventId: string; success: boolean }> {
    try {
      //const stageId = this.getStageIdForVisit(visitData.visitNumber);
      const dataValues = this.buildVisitDataValues(visitData);
      /*const eventFromServer = await firstValueFrom(
        this.http.get<any>(`${this.base}/tracker/events/${eventId}?fields=enrollment,trackedEntity,orgUnit`)
      );*/

     // const realEnrollmentId = eventFromServer.enrollment;
     // const realTrackedEntity = eventFromServer.trackedEntity;
      //console.log('trckentity', realTrackedEntity, eventId)
      // CORRECT tracker payload - array inside
     /* const payload = {
        events: [
          {
            event: eventId,
            enrollment: realEnrollmentId, // use the actual enrollment ID from the server
            trackedEntity: realTrackedEntity,
            program: environment.dhis2.program, // sqsddKuTGlJ
            programStage: stageId, // U6IkW19zK7J for 3rd
            orgUnit: patient.orgUnitId, // LCZgWKWn71b
            occurredAt: `${visitData.visitDate}T00:00:00.000Z`, // NOT eventDate
            status: 'COMPLETED', // ACTIVE won't save in some versions
            dataValues: dataValues
          }
        ]
      };*/

      console.log('trckentity', patient.teiId, eventId, 'enrollment', patient.enrollmentId);

  const payload = {
    events: [{
      event: eventId,
      enrollment: patient.enrollmentId, // FORCE CaAkBKj2U1I
      trackedEntity: patient.teiId, // FORCE Bng6nt52hk6
      program: environment.dhis2.program,
      programStage: this.getStageIdForVisit(visitData.visitNumber),
      orgUnit: patient.orgUnitId,
      occurredAt: `${visitData.visitDate}T00:00:00.000Z`,
      status: 'COMPLETED',
      dataValues: dataValues
    }]
  };
      console.log('Updating visit via Tracker:', JSON.stringify(payload, null, 2));

      const response = await firstValueFrom(
        this.http.post<{
          status: string;
          stats?: any;
          validationReport?: any;
        }>(
          `${this.base}/tracker?async=false&importStrategy=CREATE_AND_UPDATE`,
          payload
        )
      );

      console.log('Tracker response:', response);

      // Check validation errors - this is where real error hides
      if (response.validationReport?.errorReports?.length > 0) {
        console.error('Validation failed:', JSON.stringify(response.validationReport.errorReports, null, 2));
        return { eventId: '', success: false };
      }

      console.log(`Visit updated: ${eventId}`);
      return { eventId, success: true };

    } catch (error: any) {
      console.error('Full error:', error.error?.validationReport?.errorReports);
      console.error('First error:', JSON.stringify(error.error?.validationReport?.errorReports?.[0], null, 2));
      return { eventId: '', success: false };
    }
  }


  
private async createVisitEventViaTrackerAPI(
  patient: Patient,
  visitData: any
): Promise<{ eventId: string; success: boolean }> {
  try {
    const stageId = this.getStageIdForVisit(visitData.visitNumber);
    const dataValues = this.buildVisitDataValues(visitData);
console.log('Creating visit for patient:', patient.id, 'visitNumber:', visitData.visitNumber, 'stageId:', stageId);
    const payload = {
      events: [{
        enrollment: patient.enrollmentId, // CaAkBKj2U1I
        trackedEntity: patient.teiId, // Bng6nt52hk6
        program: environment.dhis2.program,
        programStage: stageId,
        orgUnit: patient.orgUnitId,
        occurredAt: `${visitData.visitDate}T00:00:00.000Z`,
        status: 'COMPLETED',
        dataValues: dataValues
      }]
    };

    console.log('Creating visit via Tracker:', JSON.stringify(payload, null, 2));

    const response: any = await firstValueFrom(
      this.http.post(`${this.base}/tracker?async=false&importStrategy=CREATE_AND_UPDATE`, payload)
    );

    console.log('Tracker CREATE response:', response);

    // DHIS2 returns event ID in bundleReport for CREATE
    const eventReport = response.bundleReport?.typeReportMap?.EVENT?.objectReports?.[0];
    const eventId = eventReport?.uid || response?.events?.[0]?.event || response?.bundleReport?.typeReportMap?.EVENT?.stats;

    // Also check stats
    if (response.stats?.created === 1 || response.bundleReport?.typeReportMap?.EVENT?.stats?.created === 1) {
      const createdUid = eventReport?.uid;
      if (createdUid) {
        console.log(`Visit created: ${createdUid}`);
        return { eventId: createdUid, success: true };
      }
    }

    // Fallback: if status OK and no error, try to get from enrollment
    if (response.status === 'OK') {
      // Re-query enrollment to get new event ID
      const enrollmentRes: any = await firstValueFrom(
        this.http.get(`${this.base}/tracker/enrollments/${patient.enrollmentId}?fields=events[event,programStage]`)
      );
      const newEvent = enrollmentRes.events?.find((e: any) => e.programStage === stageId);
      if (newEvent?.event) {
        console.log(`Visit created (fallback): ${newEvent.event}`);
        return { eventId: newEvent.event, success: true };
      }
    }

    throw new Error('No event ID returned from DHIS2 - response: ' + JSON.stringify(response));

  } catch (error: any) {
    console.error('Failed to create visit:', error);
    // Check if it's actually duplicate that now exists
    if (error?.error?.message?.includes('already exists')) {
      const enrollmentRes: any = await firstValueFrom(
        this.http.get(`${this.base}/tracker/enrollments/${patient.enrollmentId}?fields=events[event,programStage]`)
      );
      const stageId = this.getStageIdForVisit(visitData.visitNumber);
      const newEvent = enrollmentRes.events?.find((e: any) => e.programStage === stageId);
      if (newEvent?.event) {
        return { eventId: newEvent.event, success: true };
      }
    }
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

  /**
 * Sets the enrollment's own status field — a native Tracker field, no
 * metadata change needed. COMPLETED = course finished; CANCELLED =
 * treatment stopped before completion (defaulted/died/transferred — DHIS2
 * doesn't distinguish which; the specific reason stays in
 * Patient.defaultReason locally).
 */
async setEnrollmentOutcome(patient: Patient, status: 'COMPLETED' | 'CANCELLED'): Promise<void> {
  const payload = {
    enrollments: [{
      enrollment: patient.enrollmentId,
      trackedEntity: patient.teiId || patient.id,
      program: environment.dhis2.program,
      orgUnit: patient.orgUnitId,
      status,
    }],
  };

  await firstValueFrom(
    this.http.post(`${this.base}/tracker?async=false&importStrategy=UPDATE`, payload)
  );
}

}

 /**
   * Update via Tracker API (fallback - should rarely be used)
   
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
*/
  /**
   * Check if a visit already exists for a patient
   */


/**
   * Update an existing visit event (use UPDATE strategy)
   * NOTE: Even though enrollment is immutable, DHIS2 requires orgUnit in the payload
   
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
      console.log('saving result', response)
      return { eventId, success: true };

    } catch (error) {
      console.error('Failed to update visit:', error);
      throw error;
    }
  }*/

    /**
   * Create a new visit event using Tracker API (CREATE_AND_UPDATE)
   
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
*/
  
  ///kkkkkkkk
  /**
   * Create a new visit event (use CREATE_AND_UPDATE strategy)
   
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
*/

  // dhis2.service.ts - Fixed updateVisitEvent with required fields
