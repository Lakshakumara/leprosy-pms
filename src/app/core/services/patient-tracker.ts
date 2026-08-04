import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
export interface AppointmentReport {
  appointedPatients: Array<any>;
  defaulters: Array<any>;
}
export interface VisitData {
  visitNumber: number;
  visitDate?: string;
  scheduledDate?: string;
  dataValues?: Array<{ dataElement: string; value: any }>;
}

export interface PatientVisitRecord {
  patient: any;
  enrollmentId: string;
  orgUnitId: string;
  visits: Array<{
    eventId: string;
    programStageId: string;
    visitNumber: number;
    status: 'COMPLETED' | 'ACTIVE' | 'SCHEDULE' | 'SKIPPED';
    eventDate?: string;
    scheduledDate?: string;
    dataValues: Array<{ dataElement: string; value: any }>;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class PatientTrackerService {
  private base = 'https://phsmis.health.gov.lk/api';
  private programId = 'sqsddKuTGlJ'; // Your DHIS2 Program UID

  // Map visit numbers to their respective DHIS2 Program Stage UIDs
  // Extend this mapping beyond 12 if special cases arise
  private visitStageMap: Record<number, string> = {
    1: 'STAGE_1_UID',
    2: 'STAGE_2_UID',
    3: 'U6IkW19zK7J', // 3rd Visit Stage UID
    4: 'STAGE_4_UID',
    5: 'STAGE_5_UID',
    6: 'STAGE_6_UID',
    7: 'STAGE_7_UID',
    8: 'STAGE_8_UID',
    9: 'STAGE_9_UID',
    10: 'STAGE_10_UID',
    11: 'STAGE_11_UID',
    12: 'STAGE_12_UID',
    // 13: 'STAGE_13_UID', // Easily extendable for special cases
  };
 /* const doseDateMap: Record<number, string> = {
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
};*/

  constructor(private http: HttpClient) { }

  /**
   * Get Stage UID dynamically by visit number
   */
  public getStageIdForVisit(visitNumber: number): string {
    const stageId = this.visitStageMap[visitNumber];
    if (!stageId) {
      throw new Error(`No program stage configured for visit number: ${visitNumber}`);
    }
    return stageId;
  }

  /**
   * CREATE OR UPDATE a Visit Event (Handles dynamic visit numbers 1 to 12+)
   */
  async saveOrUpdateVisit(
    patientTeiId: string,
    enrollmentId: string,
    orgUnitId: string,
    visit: VisitData,
    existingEventId?: string
  ): Promise<{ eventId: string; success: boolean }> {
    const stageId = this.getStageIdForVisit(visit.visitNumber);

    // If updating an existing event UID via Events API (PUT)
    if (existingEventId) {
      const updatePayload = {
        event: existingEventId,
        trackedEntity: patientTeiId,
        program: this.programId,
        programStage: stageId,
        orgUnit: orgUnitId,
        eventDate: visit.visitDate,
        status: visit.visitDate ? 'COMPLETED' : 'SCHEDULE',
        dataValues: visit.dataValues || []
      };

      await firstValueFrom(
        this.http.put(`${this.base}/events/${existingEventId}`, updatePayload)
      );
      return { eventId: existingEventId, success: true };
    }

    // Otherwise, create a new Event via Tracker API (POST)
    const isSchedule = !visit.visitDate && !!visit.scheduledDate;
    const createPayload = {
      events: [
        {
          trackedEntity: patientTeiId,
          enrollment: enrollmentId,
          program: this.programId,
          programStage: stageId,
          orgUnit: orgUnitId,
          status: isSchedule ? 'SCHEDULE' : 'COMPLETED',
          ...(isSchedule
            ? { scheduledAt: visit.scheduledDate }
            : { occurredAt: visit.visitDate }),
          dataValues: visit.dataValues || []
        }
      ]
    };

    const response: any = await firstValueFrom(
      this.http.post(`${this.base}/tracker?async=false`, createPayload)
    );

    const createdEventId = response.bundleReport?.typeReportMap?.EVENT?.objectReports[0]?.uid;
    if (!createdEventId) {
      throw new Error('Failed to create visit event in DHIS2');
    }

    return { eventId: createdEventId, success: true };
  }

  /**
   * FETCH ALL DATA: Patient Profile + All Visits (Completed & Scheduled)
   */
  async getPatientWithAllVisits(patientTeiId: string): Promise<PatientVisitRecord> {
    // 1. Fetch Patient details and active enrollment
    const patientUrl = `${this.base}/tracker/trackedEntities/${patientTeiId}?program=${this.programId}&fields=trackedEntity,orgUnit,attributes[attribute,displayName,value],enrollments[enrollment,program,status,orgUnit]`;

    // 2. Fetch ALL events explicitly (includes completed + scheduled slots)
    const eventsUrl = `${this.base}/tracker/events?trackedEntity=${patientTeiId}&program=${this.programId}&includeDeleted=false&fields=event,programStage,status,occurredAt,scheduledAt,dataValues[dataElement,value]`;

    const [patientRes, eventsRes] = await Promise.all([
      firstValueFrom(this.http.get<any>(patientUrl)),
      firstValueFrom(this.http.get<any>(eventsUrl))
    ]);

    const activeEnrollment = patientRes.enrollments?.find((e: any) => e.program === this.programId);
    const rawEvents = eventsRes.instances || eventsRes.events || [];

    // Reverse lookup stage UID to visit number
    const reverseStageMap = Object.entries(this.visitStageMap).reduce(
      (acc, [visitNo, stageUid]) => {
        acc[stageUid] = Number(visitNo);
        return acc;
      },
      {} as Record<string, number>
    );

    // Map raw events into clean visit structure
    const mappedVisits = rawEvents.map((evt: any) => ({
      eventId: evt.event,
      programStageId: evt.programStage,
      visitNumber: reverseStageMap[evt.programStage] || 0,
      status: evt.status,
      eventDate: evt.occurredAt,
      scheduledDate: evt.scheduledAt,
      dataValues: evt.dataValues || []
    }));

    // Sort visits by visit number ascending
    mappedVisits.sort((a: any, b: any) => a.visitNumber - b.visitNumber);

    return {
      patient: {
        teiId: patientRes.trackedEntity,
        orgUnit: patientRes.orgUnit,
        attributes: patientRes.attributes
      },
      enrollmentId: activeEnrollment?.enrollment || '',
      orgUnitId: patientRes.orgUnit,
      visits: mappedVisits
    };
  }



  // Inside your PatientTrackerService class:

  /**
   * 1. Schedule an Appointment (Future Visit Slot)
   */
  async scheduleAppointment(
    patientTeiId: string,
    enrollmentId: string,
    orgUnitId: string,
    visitNumber: number,
    scheduledDate: string // YYYY-MM-DD
  ): Promise<string> {
    const stageId = this.getStageIdForVisit(visitNumber);
    const payload = {
      events: [{
        trackedEntity: patientTeiId,
        enrollment: enrollmentId,
        program: this.programId,
        programStage: stageId,
        orgUnit: orgUnitId,
        status: 'SCHEDULE',
        scheduledAt: scheduledDate
      }]
    };

    const res: any = await firstValueFrom(
      this.http.post(`${this.base}/tracker?async=false`, payload)
    );
    return res.bundleReport?.typeReportMap?.EVENT?.objectReports[0]?.uid;
  }

  /**
   * 2. Mark Appointment as Visited (Patient Arrived & Clinical Data Recorded)
   */
  async markAppointmentAsVisited(
    eventId: string,
    patientTeiId: string,
    orgUnitId: string,
    visitNumber: number,
    visitDate: string, // YYYY-MM-DD
    dataValues: Array<{ dataElement: string; value: any }> = []
  ): Promise<void> {
    const stageId = this.getStageIdForVisit(visitNumber);
    const payload = {
      event: eventId,
      trackedEntity: patientTeiId,
      program: this.programId,
      programStage: stageId,
      orgUnit: orgUnitId,
      eventDate: visitDate,
      status: 'COMPLETED',
      dataValues: dataValues
    };

    await firstValueFrom(
      this.http.put(`${this.base}/events/${eventId}`, payload)
    );
  }

  /**
   * 3. Generate Reports: Appointed Patients vs Defaulters for a Given Date Range
   */
  async generateClinicReport(orgUnitId: string, startDate: string, endDate: string): Promise<AppointmentReport> {
    // Query events across the organization unit or program
    const url = `${this.base}/tracker/events?orgUnit=${orgUnitId}&program=${this.programId}&startDate=${startDate}&endDate=${endDate}&includeDeleted=false&fields=event,trackedEntity,programStage,status,scheduledAt,occurredAt`;

    const res: any = await firstValueFrom(this.http.get<any>(url));
    const events = res.instances || res.events || [];

    const today = new Date().toISOString().split('T')[0];
    const appointedPatients: any[] = [];
    const defaulters: any[] = [];

    events.forEach((evt: any) => {
      if (evt.status === 'SCHEDULE' || evt.status === 'ACTIVE') {
        // Check if scheduled date has passed without completion (Defaulter)
        if (evt.scheduledAt && evt.scheduledAt < today) {
          defaulters.push(evt);
        } else {
          appointedPatients.push(evt);
        }
      }
    });

    return { appointedPatients, defaulters };
  }
}