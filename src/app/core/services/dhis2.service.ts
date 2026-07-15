import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, tap, catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Patient } from '../models/patient.model';

interface Dhis2Attribute {
  attribute: string;
  displayName?: string;
  value: string;
}

interface Dhis2TrackedEntity {
  trackedEntity?: string;
  trackedEntityType?: string;
  orgUnit: string;
  geometry?: { type: 'Point'; coordinates: [number, number] };
  attributes: Dhis2Attribute[];
}

interface Dhis2TrackerListResponse {
  instances: Dhis2TrackedEntity[];
}

/**
 * Talks to the DHIS2 Tracker API (`/api/tracker`).
 *
 * IMPORTANT — matched to PHSMIS's actual "Individual Patient Form" schema,
 * not generic placeholder names. Update `environment.ts` attribute UIDs if
 * your instance differs. Onset year / MB-PB classification are NOT in this
 * program's tracked entity attributes as currently configured — if those
 * fields live on a program stage (event) instead, fetchPatients() will need
 * a second call to `/api/tracker/events` merged in by trackedEntity id.
 * See README "Locating onset year / classification" section.
 */
@Injectable({ providedIn: 'root' })
export class Dhis2Service {
  private readonly http = inject(HttpClient);
  private readonly base = environment.dhis2.baseUrl;
  private readonly attrs = environment.dhis2.attributes;

  /**
   * DHIS2 requires at least one attribute in the search criteria when
   * querying with ouMode=DESCENDANTS at a high org unit level (district,
   * etc). We use the "patient name" attribute with a broad LIKE filter so
   * this effectively returns everyone, while still satisfying that rule.
   * Swap this for a real search box value if you want user-driven search
   * instead of "fetch everyone under this org unit".
   */
  fetchPatients(orgUnitId = environment.dhis2.orgUnitId, nameContains = 'a'): Observable<Patient[]> {
    const searchAttrId = this.attrs.patientName;

    let params = new HttpParams()
      .set('program', environment.dhis2.programId)
      .set('orgUnit', orgUnitId)
      .set('ouMode', 'DESCENDANTS')
      .set('fields', 'trackedEntity,orgUnit,geometry,attributes[attribute,displayName,value]');

    if (searchAttrId) {
      params = params.set('attribute', searchAttrId).set('filter', `${searchAttrId}:LIKE:${nameContains}`);
    }

    return this.http.get<Dhis2TrackerListResponse>(`${this.base}/tracker/trackedEntities`, { params }).pipe(
      map((res) => (res.instances ?? []).map((tei) => this.fromDhis2(tei))),
      tap((patients) => console.info(`[Dhis2Service] fetched ${patients.length} patient(s) from PHSMIS`)),
      catchError((err) => {
        // Surface the real DHIS2 error instead of silently returning [] —
        // check the console/network tab for the actual status + message
        // (401 = auth, 409 = missing required attribute filter, CORS shows
        // as a network error with no response body at all).
        console.error('[Dhis2Service] fetchPatients failed:', err);
        return throwError(() => err);
      })
    );
  }

  upsertPatient(patient: Patient): Observable<{ teiId: string }> {
    const payload = { trackedEntities: [this.toDhis2(patient)] };

    return this.http.post<any>(`${this.base}/tracker?async=false`, payload).pipe(
      map((res) => {
        const uid = res.bundleReport?.typeReportMap?.TRACKED_ENTITY?.objectReports?.[0]?.uid ?? patient.teiId ?? '';
        return { teiId: uid };
      }),
      catchError((err) => {
        console.error('[Dhis2Service] upsertPatient failed:', err);
        return throwError(() => err);
      })
    );
  }

  private toDhis2(patient: Patient): Dhis2TrackedEntity {
    const attributes: Dhis2Attribute[] = [
      { attribute: this.attrs.patientName, value: `${patient.firstName} ${patient.lastName}`.trim() },
      { attribute: this.attrs.nic, value: patient.nic ?? '' },
      { attribute: this.attrs.classification, value: patient.classification ?? '' },
      { attribute: this.attrs.mobile, value: patient.phoneNumber ?? '' },
      { attribute: this.attrs.sex, value: patient.gender },
      { attribute: this.attrs.age, value: patient.age != null ? String(patient.age) : '' }
    ].filter((a) => !!a.attribute && a.value !== '');

    const entity: Dhis2TrackedEntity = {
      orgUnit: patient.orgUnitId || environment.dhis2.orgUnitId,
      attributes
    };
    if (environment.dhis2.trackedEntityTypeId) entity.trackedEntityType = environment.dhis2.trackedEntityTypeId;
    if (patient.teiId) entity.trackedEntity = patient.teiId;
    if (patient.latitude != null && patient.longitude != null) {
      entity.geometry = { type: 'Point', coordinates: [patient.longitude, patient.latitude] };
    }
    return entity;
  }

  private fromDhis2(tei: Dhis2TrackedEntity): Patient {
    const value = (attrId: string) => tei.attributes.find((a) => a.attribute === attrId)?.value ?? '';
    const fullName = value(this.attrs.patientName);
    const [firstName, ...rest] = fullName.split(' ');
    const now = new Date().toISOString();

    return {
      id: tei.trackedEntity ?? crypto.randomUUID(),
      teiId: tei.trackedEntity,
      //registeredAt:value(this.attrs.registeredAt) || undefined,
      firstName: firstName || fullName || '(no name)',
      lastName: rest.join(' '),
      gender: (value(this.attrs.sex) as 'Male' | 'Female' | 'Other') || 'Other',
      nic: value(this.attrs.nic) || undefined,
      age: value(this.attrs.age) ? Number(value(this.attrs.age)) : undefined,
      // Placeholder until onset year / classification source is confirmed —
      // see README. Defaulting keeps the list rendering instead of erroring.
      onsetYear: new Date().getFullYear(),
      classification:value(this.attrs.classification) as 'MB' | 'PB' || 'PB',
      disabilityGrade: '0',
      phoneNumber: value(this.attrs.mobile) || undefined,
      orgUnitId: tei.orgUnit,
      latitude: tei.geometry?.coordinates?.[1],
      longitude: tei.geometry?.coordinates?.[0],
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced'
    };
  }
}
