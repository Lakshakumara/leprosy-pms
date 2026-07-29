// dhis2-updater.service.ts - COMPLETE FIXED VERSION
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Patient } from '../../core/services/patient.model';
import { environment } from '../../../environments/environment';

export const TEI_ATTRIBUTE_MAP: Record<string, string> = {
    alcNum: 'AujHTe3nXx4',
    clinicNum: 'Sn6LwDqapMU',
    nicNum: 'B6au8evTRWl',
    guardianName: 'UBWQy1GFOee',
    mobileNum: 'Y4H01gi8N2M',
    telNum: 'g71IALGz9U8',
    patientName: 'hGbU1zkkxH8',
    patientSex: 'C9FV3HiPEkA',
    ethnicGroup: 'cw1sJo3q9UF',
    patientAge: 'C0ZoykFjsTP',
    latitude: 'gm91XYLCpsS',  // This is the GPS coordinates attribute
    longitude: 'gm91XYLCpsS',
};

export const FIRST_VISIT_DE_MAP: Record<string, string> = {
    treatmentClassification: 'Rten0X02zxy',
    disabilityAtDiagnosis: 'ijKomxeLSWM',
    ehfScore: 'i3RUk9EeSaZ',
    patientMohArea: 'RsUDxHKh2w4',
    patientPhiArea: 'PgVeByg4SgG',
    patientGnDivision: 'tkCFwCc74QL',
    patientDistrict: 'iB1RHZOqhhb',
    patientHomeAddress: 'zGdT30K7Gf2',
    treatmentType: 'bs5NPrHfdsB',
    caseType: 'WyQFv86DRDm',
    contactHistory: 'hEJbywu7U6T',
    contactHistorySource: 'nUhyMVGZCwp',
    relapse: 'UBX6sBorlFy',
    defaulterRestartingTreatment: 'UGYkKdtiW3L',
    changeOfTreatmentType: 'o18RSOmhyi4',
    previousTreatmentType: 'cBm44wyUsJ6',
    yearOfTreatmentCompletion: 'QwZQUEWQ5TS',
    timeSinceOnsetMonths: 'XDAadR1AiAg',
    nameOfConsultant: 'XLvfoGQFPs7',
    nameOfMO: 'pJVd9qUrc82',
    patientReferredBy: 'JGChabLUuiU',
    clawHand: 'CNme2qNFYpn',
    footDrop: 'JCrTNTvDAWi',
    footUlcer: 'hkCk03W7xWH',
    eyeInvolvement: 'OUWZVXF3zty',
    faceInvolvement: 'IYtg3pRjQk6',
};

@Injectable({ providedIn: 'root' })
export class Dhis2UpdaterService {
    private readonly baseUrl = environment.dhis2.baseUrl;
    private readonly programId = environment.dhis2.program;
    private readonly trackedEntityTypeId = environment.dhis2.trackedEntityType || 'S2afGQZ5tDu';
    private patientService: any;

    constructor(private http: HttpClient) { }

    setPatientService(service: any): void {
        this.patientService = service;
    }

    /**
     * Update ONE field of a patient directly to DHIS2 server
     */
    async updateSingleField(patient: any, field: keyof Patient, newValue: any): Promise<void> {
        const value = String(newValue ?? '');

        if (TEI_ATTRIBUTE_MAP[field as string]) {
            const orgUnitId = patient.orgUnitId || patient.orgUnit;
            if (!orgUnitId) {
                throw new Error('Patient has no orgUnit. Cannot update attributes.');
            }
            return this.updateTeiAttribute(patient.teiId || patient.id, field as string, value, orgUnitId);
        }

        if (FIRST_VISIT_DE_MAP[field as string]) {
            if (!patient.firstVisitEventId) {
                throw new Error('firstVisitEventId is missing. Fetch enrollment events first.');
            }
            return this.updateEventDataElement(patient.firstVisitEventId, field as string, value);
        }

        throw new Error(`Field ${String(field)} is not mapped to DHIS2`);
    }

    /**
     * Change orgUnit - SIMPLIFIED VERSION (recommended)
     * Updates only the enrollment which is what matters for program data
     */
    // dhis2-updater.service.ts - Use this method instead

/**
 * Change orgUnit - Updates ENROLLMENT (this is what matters)
 */
async changeOrgUnit(patient: any, newOrgUnitId: string, newOrgUnitName?: string): Promise<void> {
    const teiId = patient.teiId || patient.id;
    const enrollmentId = patient.enrollmentId;

    if (!enrollmentId) {
        throw new Error('Patient has no enrollmentId. Cannot change orgUnit.');
    }

    try {
        // 1. Get current enrollment details to preserve required fields
        console.log(`Fetching enrollment details for: ${enrollmentId}`);
        const enrollmentDetails = await this.getEnrollmentDetails(enrollmentId);
        
        if (!enrollmentDetails) {
            throw new Error(`Could not fetch enrollment details for ${enrollmentId}`);
        }

        // 2. Update the ENROLLMENT orgUnit (THIS IS WHAT MATTERS)
        const payload = {
            enrollments: [{
                enrollment: enrollmentId,
                trackedEntity: teiId,
                program: this.programId,
                orgUnit: newOrgUnitId,
                status: enrollmentDetails.status || 'ACTIVE',
                enrolledAt: enrollmentDetails.enrolledAt || new Date().toISOString(),
                occurredAt: enrollmentDetails.occurredAt || new Date().toISOString()
            }]
        };

        console.log('Updating ENROLLMENT with payload:', JSON.stringify(payload, null, 2));

        const response = await firstValueFrom(
            this.http.post(
                `${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`,
                payload
            )
        );
        
        console.log('Enrollment update response:', response);

        // 3. Also update TEI orgUnit (optional, for consistency)
        try {
            const teiPayload = {
                trackedEntities: [{
                    trackedEntity: teiId,
                    trackedEntityType: this.trackedEntityTypeId,
                    orgUnit: newOrgUnitId
                }]
            };
            
            console.log('Updating TEI with payload:', JSON.stringify(teiPayload, null, 2));
            
            await firstValueFrom(
                this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, teiPayload)
            );
        } catch (teiError) {
            console.warn('TEI update failed but enrollment was updated:', teiError);
        }

        // 4. Update local object
        patient.orgUnitId = newOrgUnitId;
        if (newOrgUnitName) patient.orgUnitName = newOrgUnitName;
        patient.syncStatus = 'synced';
        patient.updatedAt = new Date().toISOString();

        // 5. TRANSFER PROGRAM OWNERSHIP - THE KEY STEP!
        console.log('Transferring program ownership...');
        await this.transferProgramOwnership(teiId, this.programId, newOrgUnitId);

        

        if (this.patientService) {
            await this.patientService.updateLocalPatient(patient);
        }

        console.log('✅ Org unit changed successfully!');

    } catch (error) {
        console.error('❌ Failed to change org unit:', error);
        throw error;
    }
}

/**
 * Get complete enrollment details with ALL required fields
 */
private async getEnrollmentDetails(enrollmentId: string): Promise<any> {
    try {
        const response = await firstValueFrom(
            this.http.get(`${this.baseUrl}/tracker/enrollments/${enrollmentId}`, {
                params: {
                    fields: 'enrollment,program,orgUnit,status,enrolledAt,occurredAt,geometry,trackedEntity'
                }
            })
        );
        return response;
    } catch (error) {
        console.error('Failed to get enrollment details:', error);
        // Return minimal required data as fallback
        return {
            status: 'ACTIVE',
            enrolledAt: new Date().toISOString(),
            occurredAt: new Date().toISOString()
        };
    }
}

    /**
     * Alternative: Update only TEI orgUnit (simpler, might be sufficient)
     */
    async changeOrgUnitSimple(patient: any, newOrgUnitId: string, newOrgUnitName?: string): Promise<void> {
        const teiId = patient.teiId || patient.id;

        try {
            const payload = {
                trackedEntities: [{
                    trackedEntity: teiId,
                    trackedEntityType: this.trackedEntityTypeId,
                    orgUnit: newOrgUnitId
                }]
            };

            console.log('Updating TEI orgUnit with payload:', JSON.stringify(payload, null, 2));

            await firstValueFrom(
                this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, payload)
            );

            // Update local object
            patient.orgUnitId = newOrgUnitId;
            if (newOrgUnitName) patient.orgUnitName = newOrgUnitName;
            patient.syncStatus = 'synced';
            patient.updatedAt = new Date().toISOString();

            if (this.patientService) {
                await this.patientService.updateLocalPatient(patient);
            }

            console.log('✅ Org unit changed via TEI successfully!');

        } catch (error) {
            console.error('❌ Failed to change org unit via TEI:', error);
            throw error;
        }
    }

    /**
     * Alternative: Full update with both TEI and Enrollment
     */
    async changeOrgUnitFull(patient: any, newOrgUnitId: string, newOrgUnitName?: string): Promise<void> {
        const teiId = patient.teiId || patient.id;
        const enrollmentId = patient.enrollmentId;

        if (!enrollmentId) {
            throw new Error('Patient has no enrollmentId. Cannot change orgUnit.');
        }

        try {
            // Get current enrollment details
            const enrollmentDetails = await this.getEnrollmentDetails(enrollmentId);
            const teiData = await this.getTrackedEntity(teiId);

            const payload = {
                trackedEntities: [{
                    trackedEntity: teiId,
                    trackedEntityType: this.trackedEntityTypeId,
                    orgUnit: newOrgUnitId,
                    attributes: teiData?.attributes || []
                }],
                enrollments: [{
                    enrollment: enrollmentId,
                    trackedEntity: teiId,
                    program: this.programId,
                    orgUnit: newOrgUnitId,
                    status: enrollmentDetails.status || 'ACTIVE',
                    enrolledAt: enrollmentDetails.enrolledAt || new Date().toISOString(),
                    occurredAt: enrollmentDetails.occurredAt || new Date().toISOString()
                }]
            };

            console.log('Full update payload:', JSON.stringify(payload, null, 2));

            await firstValueFrom(
                this.http.post(
                    `${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`,
                    payload
                )
            );

            // Update local object
            patient.orgUnitId = newOrgUnitId;
            if (newOrgUnitName) patient.orgUnitName = newOrgUnitName;
            patient.syncStatus = 'synced';
            patient.updatedAt = new Date().toISOString();

            if (this.patientService) {
                await this.patientService.updateLocalPatient(patient);
            }

            console.log('✅ Org unit changed via full update successfully!');

        } catch (error) {
            console.error('❌ Failed to change org unit via full update:', error);
            throw error;
        }
    }

    // ── Private Helpers ────────────────────────────────────────────

    private async updateTeiAttribute(teiId: string, field: string, value: string, orgUnitId: string): Promise<void> {
        const attributeId = TEI_ATTRIBUTE_MAP[field];

        const currentTei = await this.getTrackedEntity(teiId);
        const existingAttributes = currentTei?.attributes || [];

        const attributeIndex = existingAttributes.findIndex(
            (a: any) => a.attribute === attributeId
        );

        if (attributeIndex >= 0) {
            existingAttributes[attributeIndex].value = value;
        } else {
            existingAttributes.push({ attribute: attributeId, value });
        }

        const payload = {
            trackedEntities: [{
                trackedEntity: teiId,
                trackedEntityType: this.trackedEntityTypeId,
                orgUnit: orgUnitId,
                attributes: existingAttributes
            }]
        };

        console.log('Updating TEI attribute with payload:', JSON.stringify(payload, null, 2));

        await firstValueFrom(
            this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, payload)
        );
    }

    private async updateEventDataElement(eventId: string, field: string, value: string): Promise<void> {
        const dataElementId = FIRST_VISIT_DE_MAP[field];

        const eventData = await this.getEvent(eventId);
        const dataValues = eventData?.dataValues || [];
        const valueIndex = dataValues.findIndex(
            (dv: any) => dv.dataElement === dataElementId
        );

        if (valueIndex >= 0) {
            dataValues[valueIndex].value = value;
        } else {
            dataValues.push({ dataElement: dataElementId, value });
        }

        const payload = {
            events: [{
                event: eventId,
                program: this.programId,
                programStage: eventData.programStage,
                orgUnit: eventData.orgUnit,
                trackedEntity: eventData.trackedEntity,
                dataValues: dataValues
            }]
        };

        console.log('Updating event with payload:', JSON.stringify(payload, null, 2));

        await firstValueFrom(
            this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, payload)
        );
    }

    private async getTrackedEntity(teiId: string): Promise<any> {
        try {
            const response = await firstValueFrom(
                this.http.get(`${this.baseUrl}/tracker/trackedEntities/${teiId}`, {
                    params: {
                        fields: 'trackedEntity,trackedEntityType,orgUnit,attributes[attribute,value]'
                    }
                })
            );
            return response;
        } catch (error) {
            console.error('Failed to fetch tracked entity:', error);
            return { attributes: [] };
        }
    }

    private async getEvent(eventId: string): Promise<any> {
        try {
            const response = await firstValueFrom(
                this.http.get(`${this.baseUrl}/tracker/events/${eventId}`, {
                    params: {
                        fields: 'event,program,programStage,orgUnit,trackedEntity,dataValues[dataElement,value]'
                    }
                })
            );
            return response;
        } catch (error) {
            console.error('Failed to fetch event:', error);
            throw error;
        }
    }

   /* private async getEnrollmentDetails(enrollmentId: string): Promise<any> {
        try {
            const response = await firstValueFrom(
                this.http.get(`${this.baseUrl}/tracker/enrollments/${enrollmentId}`, {
                    params: {
                        fields: 'enrollment,program,orgUnit,status,enrolledAt,occurredAt,geometry,trackedEntity'
                    }
                })
            );
            return response;
        } catch (error) {
            console.error('Failed to get enrollment details:', error);
            return {
                status: 'ACTIVE',
                enrolledAt: new Date().toISOString(),
                occurredAt: new Date().toISOString()
            };
        }
    }*/

    private async getEnrollmentId(teiId: string): Promise<string> {
        try {
            const url = `${this.baseUrl}/tracker/trackedEntities/${teiId}/enrollments`;

            const res: any = await firstValueFrom(
                this.http.get(url, {
                    params: {
                        program: this.programId,
                        fields: 'enrollment,status,orgUnit',
                        pageSize: 1
                    }
                })
            );

            const enrollment = res?.enrollments?.[0]?.enrollment ||
                res?.instances?.[0]?.enrollment ||
                res?.[0]?.enrollment;

            if (!enrollment) {
                throw new Error(`No enrollment found for TEI: ${teiId}`);
            }

            return enrollment;
        } catch (error) {
            console.error('Failed to get enrollment:', error);
            throw new Error(`Could not find enrollment for patient.`);
        }
    }

    async verifyOrgUnitInDHIS2(teiId: string): Promise<{ teiOrgUnit: string, enrollmentOrgUnit: string }> {
        try {
            const teiData = await this.getTrackedEntity(teiId);

            const enrollments = await firstValueFrom(
                this.http.get(`${this.baseUrl}/tracker/trackedEntities/${teiId}/enrollments`, {
                    params: {
                        program: this.programId,
                        fields: 'enrollment,orgUnit,status',
                        pageSize: 1
                    }
                })
            );

            const enrollment = (enrollments as any)?.enrollments?.[0];

            return {
                teiOrgUnit: teiData?.orgUnit || 'unknown',
                enrollmentOrgUnit: enrollment?.orgUnit || 'unknown'
            };
        } catch (error) {
            console.error('Failed to verify orgUnit:', error);
            return { teiOrgUnit: 'error', enrollmentOrgUnit: 'error' };
        }
    }



    // dhis2-updater.service.ts - Add this complete method

/**
 * Change orgUnit for EVERYTHING including Program Owner
 * This ensures the patient appears in the new facility everywhere in DHIS2
 */
async changeOrgUnitComplete(patient: any, newOrgUnitId: string, newOrgUnitName?: string): Promise<void> {
    const teiId = patient.teiId || patient.id;
    const enrollmentId = patient.enrollmentId;

    if (!enrollmentId) {
        throw new Error('Patient has no enrollmentId. Cannot change orgUnit.');
    }

    try {
        // 1. Get current enrollment details with all events
        console.log(`Fetching complete enrollment details for: ${enrollmentId}`);
        const enrollmentDetails = await this.getCompleteEnrollmentDetails(enrollmentId);
        
        if (!enrollmentDetails) {
            throw new Error(`Could not fetch enrollment details for ${enrollmentId}`);
        }

        // 2. Update ENROLLMENT
        const enrollmentPayload = {
            enrollments: [{
                enrollment: enrollmentId,
                trackedEntity: teiId,
                program: this.programId,
                orgUnit: newOrgUnitId,
                status: enrollmentDetails.status || 'ACTIVE',
                enrolledAt: enrollmentDetails.enrolledAt || new Date().toISOString(),
                occurredAt: enrollmentDetails.occurredAt || new Date().toISOString()
            }]
        };

        console.log('Updating ENROLLMENT with payload:', JSON.stringify(enrollmentPayload, null, 2));

        await firstValueFrom(
            this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, enrollmentPayload)
        );

        // 3. Update ALL EVENTS with the new orgUnit
        const events = enrollmentDetails.events || [];
        console.log(`Found ${events.length} events to update`);

        for (const event of events) {
            if (event.event) {
                const eventPayload = {
                    events: [{
                        event: event.event,
                        program: this.programId,
                        programStage: event.programStage,
                        orgUnit: newOrgUnitId,
                        trackedEntity: teiId,
                        enrollment: enrollmentId,
                        status: event.status || 'COMPLETED',
                        occurredAt: event.occurredAt || new Date().toISOString(),
                        scheduledAt: event.scheduledAt || new Date().toISOString(),
                        dataValues: event.dataValues || []
                    }]
                };

                console.log(`Updating EVENT ${event.event} with payload:`, JSON.stringify(eventPayload, null, 2));

                await firstValueFrom(
                    this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, eventPayload)
                );
            }
        }

        // 4. Update TEI orgUnit
        const teiPayload = {
            trackedEntities: [{
                trackedEntity: teiId,
                trackedEntityType: this.trackedEntityTypeId,
                orgUnit: newOrgUnitId
            }]
        };

        console.log('Updating TEI with payload:', JSON.stringify(teiPayload, null, 2));

        await firstValueFrom(
            this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, teiPayload)
        );

        // 5. UPDATE PROGRAM OWNER - THIS IS THE KEY FIX!
        // Program Owner determines where the patient appears in Tracker Capture
        console.log('Updating Program Owner...');
        
        const programOwnerPayload = {
            programOwners: [{
                trackedEntity: teiId,
                program: this.programId,
                orgUnit: newOrgUnitId
            }]
        };

        console.log('Updating Program Owner with payload:', JSON.stringify(programOwnerPayload, null, 2));

        await firstValueFrom(
            this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, programOwnerPayload)
        );

        // 6. Update local object
        patient.orgUnitId = newOrgUnitId;
        if (newOrgUnitName) patient.orgUnitName = newOrgUnitName;
        patient.syncStatus = 'synced';
        patient.updatedAt = new Date().toISOString();

        if (this.patientService) {
            await this.patientService.updateLocalPatient(patient);
        }

        console.log('✅ Complete org unit change successful!');
        console.log(`   - Enrollment: ${newOrgUnitId}`);
        console.log(`   - ${events.length} Events: ${newOrgUnitId}`);
        console.log(`   - TEI: ${newOrgUnitId}`);
        console.log(`   - Program Owner: ${newOrgUnitId} (FIXED!)`);

    } catch (error) {
        console.error('❌ Failed to change org unit completely:', error);
        throw error;
    }
}

/**
 * Alternative: Simplified method - just update Program Owner
 * Use this if you want to update only the Program Owner
 */
async changeProgramOwner(patient: any, newOrgUnitId: string): Promise<void> {
    const teiId = patient.teiId || patient.id;

    try {
        const payload = {
            programOwners: [{
                trackedEntity: teiId,
                program: this.programId,
                orgUnit: newOrgUnitId
            }]
        };

        console.log('Updating Program Owner with payload:', JSON.stringify(payload, null, 2));

        await firstValueFrom(
            this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, payload)
        );

        console.log('✅ Program Owner updated successfully!');

    } catch (error) {
        console.error('❌ Failed to update Program Owner:', error);
        throw error;
    }
    
}


async transferProgramOwnership(teiId: string, programId: string, newOrgUnitId: string): Promise<void> {
    try {
        const url = `${this.baseUrl}/tracker/ownership/transfer`;
        const params = {
            trackedEntityInstance: teiId,
            program: programId,
            ou: newOrgUnitId
        };

        console.log('Transferring program ownership with params:', params);

        const response = await firstValueFrom(
            this.http.put(url, null, { params: params })
        );
        
        console.log('✅ Program ownership transferred successfully!', response);
        //return response;

    } catch (error) {
        console.error('❌ Failed to transfer program ownership:', error);
        throw error;
    }
}















/**
 * Get complete enrollment details with ALL events
 */
private async getCompleteEnrollmentDetails(enrollmentId: string): Promise<any> {
    try {
        const response = await firstValueFrom(
            this.http.get(`${this.baseUrl}/tracker/enrollments/${enrollmentId}`, {
                params: {
                    fields: 'enrollment,program,orgUnit,status,enrolledAt,occurredAt,geometry,trackedEntity,events[*]'
                }
            })
        );
        return response;
    } catch (error) {
        console.error('Failed to get complete enrollment details:', error);
        throw error;
    }
}

/**
 * Simplified: Change orgUnit for enrollment only (for comparison)
 */
async changeOrgUnitEnrollmentOnly(patient: any, newOrgUnitId: string, newOrgUnitName?: string): Promise<void> {
    const teiId = patient.teiId || patient.id;
    const enrollmentId = patient.enrollmentId;

    if (!enrollmentId) {
        throw new Error('Patient has no enrollmentId. Cannot change orgUnit.');
    }

    try {
        const enrollmentDetails = await this.getEnrollmentDetails(enrollmentId);
        
        const payload = {
            enrollments: [{
                enrollment: enrollmentId,
                trackedEntity: teiId,
                program: this.programId,
                orgUnit: newOrgUnitId,
                status: enrollmentDetails.status || 'ACTIVE',
                enrolledAt: enrollmentDetails.enrolledAt || new Date().toISOString(),
                occurredAt: enrollmentDetails.occurredAt || new Date().toISOString()
            }]
        };

        console.log('Updating ENROLLMENT only:', JSON.stringify(payload, null, 2));

        await firstValueFrom(
            this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, payload)
        );

        // Update local object
        patient.orgUnitId = newOrgUnitId;
        if (newOrgUnitName) patient.orgUnitName = newOrgUnitName;
        patient.syncStatus = 'synced';
        patient.updatedAt = new Date().toISOString();

        if (this.patientService) {
            await this.patientService.updateLocalPatient(patient);
        }

        console.log('✅ Enrollment org unit changed successfully!');

    } catch (error) {
        console.error('❌ Failed to change enrollment org unit:', error);
        throw error;
    }
}




// dhis2-updater.service.ts - Updated GPS update

async updatePatientGpsCoordinates(patient: any, latitude: number, longitude: number): Promise<void> {
  const teiId = patient.teiId || patient.id;
  
  // Get all events for the patient
  const events = await this.getPatientEvents(teiId);
  
  // Format: [longitude, latitude] without spaces for DHIS2 COORDINATE type
  const gpsValue = `[${longitude},${latitude}]`;
  const gpsDataElementId = 'gm91XYLCpsS';

  let targetEvent: any = null;
  let hasGpsElement = false;

  // 1. First search: Look for an event that ALREADY contains the GPS data element
  for (const event of events) {
    if (event.dataValues?.some((dv: any) => dv.dataElement === gpsDataElementId)) {
      targetEvent = event;
      hasGpsElement = true;
      break;
    }
  }

  // 2. Fallback: If no event has the GPS element, pick the most recent event (or first event)
  if (!targetEvent) {
    if (!events || events.length === 0) {
      throw new Error('No events found for this patient to attach GPS coordinates.');
    }
    targetEvent = events[0]; // Uses the first available event
    hasGpsElement = false;
  }

  // 3. Build dataValues array
  let updatedDataValues: any[] = [];

  if (hasGpsElement) {
    // Update existing dataElement value
    updatedDataValues = targetEvent.dataValues.map((dv: any) => {
      if (dv.dataElement === gpsDataElementId) {
        return { ...dv, value: gpsValue };
      }
      return dv;
    });
  } else {
    // Append the new GPS dataElement to existing dataValues
    updatedDataValues = [
      ...(targetEvent.dataValues || []),
      {
        dataElement: gpsDataElementId,
        value: gpsValue
      }
    ];
  }

  // 4. Construct payload
  const payload = {
    events: [{
      event: targetEvent.event,
      program: targetEvent.program,
      programStage: targetEvent.programStage,
      orgUnit: targetEvent.orgUnit,
      trackedEntity: teiId,
      enrollment: targetEvent.enrollment,
      status: targetEvent.status || 'COMPLETED',
      occurredAt: targetEvent.occurredAt || new Date().toISOString(),
      scheduledAt: targetEvent.scheduledAt || targetEvent.occurredAt || new Date().toISOString(),
      dataValues: updatedDataValues
    }]
  };

  console.log('Updating GPS with payload:', JSON.stringify(payload, null, 2));

  await firstValueFrom(
    this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, payload)
  );
}

/*async updatePatientGpsCoordinates(patient: any, latitude: number, longitude: number): Promise<void> {
    const teiId = patient.teiId || patient.id;
    
    // Get the first event that has GPS data
    const events = await this.getPatientEvents(teiId);
    let targetEvent = null;
    let targetDataValueIndex = -1;
    
    for (const event of events) {
        const dataValues = event.dataValues || [];
        for (let i = 0; i < dataValues.length; i++) {
            if (dataValues[i].dataElement === 'gm91XYLCpsS') {
                targetEvent = event;
                targetDataValueIndex = i;
                break;
            }
        }
        if (targetEvent) break;
    }
    
    if (!targetEvent) {
        throw new Error('No event found with GPS data element');
    }
    
    // Format: [longitude, latitude] as shown in your data
    const gpsValue = `[${longitude},${latitude}]`;
    
    // Update the data value
    const payload = {
        events: [{
            event: targetEvent.event,
            program: targetEvent.program,
            programStage: targetEvent.programStage,
            orgUnit: targetEvent.orgUnit,
            trackedEntity: teiId,
            enrollment: targetEvent.enrollment,
            status: targetEvent.status || 'COMPLETED',
            occurredAt: targetEvent.occurredAt || new Date().toISOString(),
            scheduledAt: targetEvent.scheduledAt || new Date().toISOString(),
            dataValues: targetEvent.dataValues.map((dv: any, idx: number) => {
                if (idx === targetDataValueIndex) {
                    return { ...dv, value: gpsValue };
                }
                return dv;
            })
        }]
    };
    
    console.log('Updating GPS with payload:', JSON.stringify(payload, null, 2));
    
    await firstValueFrom(
        this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, payload)
    );
}
*/
private async getPatientEvents(teiId: string): Promise<any[]> {
    try {
        const response = await firstValueFrom(
            this.http.get(`${this.baseUrl}/tracker/trackedEntities/${teiId}`, {
                params: {
                    fields: 'enrollments[events[event,program,programStage,orgUnit,status,occurredAt,scheduledAt,enrollment,dataValues[dataElement,value]]]'
                }
            })
        );
        const enrollments = (response as any)?.enrollments || [];
        const events: any[] = [];
        for (const enrollment of enrollments) {
            if (enrollment.events) {
                events.push(...enrollment.events);
            }
        }
        return events;
    } catch (error) {
        console.error('Failed to get patient events:', error);
        return [];
    }
}

}