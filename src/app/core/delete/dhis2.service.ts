import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, expand, reduce, EMPTY, map, tap, catchError, throwError } from 'rxjs';
import { Patient } from './patient.model';
import { environment } from '../../../environments/environment';

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

// ── UIDs from environment (shorthand) ─────────────────────────────────────────
const A = environment.TRACKED_ENTITY_ATTRIBUTES;
const D = environment.DATA_ELEMENTS;

/**
 * Fetches ALL leprosy patients under the Ratnapura RDHS district from the
 * DHIS2 Tracker API (new endpoint: /api/tracker/trackedEntities).
 *
 * Auth is handled by the dhis2AuthInterceptor (ApiToken header).
 * Requests are proxied through /dhis2-api → https://phsmis.health.gov.lk/api.
 *
 * Results are paginated — all pages are fetched and merged automatically.
 */
@Injectable({ providedIn: 'root' })
export class Dhis2Service {
  private readonly http = inject(HttpClient);
  private readonly base = environment.dhis2.baseUrl;

  /**
   * Fetch all patients enrolled in the Leprosy program under the district.
   * Returns a single Observable that emits the full list once all pages are done.
   */
  fetchPatients(orgUnitId = environment.dhis2.district.id): Observable<Patient[]> {
    return this.fetchPage(orgUnitId, 1).pipe(
      expand(response => {
        console.log('responsex', response)
        if (response.page < response.pageCount) {
          return this.fetchPage(orgUnitId, response.page + 1);
        }
        return EMPTY;
      }),
      reduce((acc: Patient[], response: TrackerListResponse) => {
        const mapped = (response.instances ?? []).map(tei => this.fromDhis2(tei));
        return [...acc, ...mapped];
      }, []),
      tap(patients => console.info(`[Dhis2Service] fetched ${patients.length} patient(s) total`)),
      catchError(err => {
        console.error('[Dhis2Service] fetchPatients failed:', err);
        return throwError(() => err);
      })
    );
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private fetchPage(orgUnitId: string, page: number): Observable<TrackerListResponse> {
    const fields = [
      'trackedEntity,',
      'orgUnit,',
      'enrollments[',
      'enrollment,status,enrolledAt,orgUnit,orgUnitName,',
      'attributes[attribute,value],',
      'events[event,programStage,status,occurredAt,dataValues[dataElement,value]]',
      ']',
    ].join('');
    console.log('orgUnitID', orgUnitId)
    const params = new HttpParams()
      .set('program', environment.dhis2.program)
      .set('orgUnit', orgUnitId)
      .set('ouMode', 'DESCENDANTS')
      .set('fields', fields)
      .set('pageSize', '250')
      .set('page', String(1))
      .set('attribute', 'hGbU1zkkxH8');

    return this.http
      .get<TrackerListResponse>(`${this.base}/tracker/trackedEntities`, { params })
      .pipe(
        tap(r => console.info(`[Dhis2Service] page ${page}/${r?.pageCount ?? '?'} — ${r.instances?.length ?? 0} records`))
      );
  }

  private fromDhis2(tei: TrackerInstance): Patient {
    // Attributes may live on the enrollment (new tracker API preferred) or on the TEI root
    const enrollment = (tei.enrollments ?? [])[0];
    const attributes: TrackerAttribute[] = enrollment?.attributes?.length
      ? enrollment.attributes
      : (tei.attributes ?? []);

    const attrMap = new Map(attributes.map(a => [a.attribute, a.value]));

    // Find the confirmed FIRST_VISIT event
    const firstVisitEvent = (enrollment?.events ?? []).find(
      e => e.programStage === environment.PROGRAM_STAGES.FIRST_VISIT
    );
    const dvMap = new Map((firstVisitEvent?.dataValues ?? []).map(d => [d.dataElement, d.value]));

    // Parse GPS coordinates (stored as GeoJSON [lng, lat])
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
      } catch { /* ignore malformed GPS data */ }
    }

    const now = new Date().toISOString();

    return {
      id: tei.trackedEntity,
      teiId: tei.trackedEntity,

      // TEI Attributes
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

      // Enrollment
      orgUnitId: enrollment?.orgUnit ?? tei.orgUnit ?? '',
      orgUnitName: enrollment?.orgUnitName ?? '',
      enrolledAt: enrollment?.enrolledAt ?? '',
      enrollmentStatus: enrollment?.status ?? '',

      // FIRST_VISIT data elements
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

      // Deformity
      clawHand: dvMap.get(D.CLAW_HAND.uid) === 'true',
      footDrop: dvMap.get(D.FOOT_DROP.uid) ?? '',
      footUlcer: dvMap.get(D.FOOT_ULCER.uid) ?? '',
      eyeInvolvement: dvMap.get(D.EYE_INVOLVEMENT.uid) ?? '',
      faceInvolvement: dvMap.get(D.FACE_INVOLVEMENT.uid) ?? '',

      latitude,
      longitude,

      createdAt: enrollment?.enrolledAt ?? now,
      updatedAt: now,
      syncStatus: 'synced',
    };
  }
}
