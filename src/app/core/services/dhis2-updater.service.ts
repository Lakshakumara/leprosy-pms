// dhis2-updater.service.ts - Fixed version
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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

    constructor(private http: HttpClient) { }

    /**
     * Update ONE field of a patient directly to DHIS2 server
     */
    async updateSingleField(patient: any, field: keyof Patient, newValue: any): Promise<void> {
        const value = String(newValue ?? '');

        if (TEI_ATTRIBUTE_MAP[field as string]) {
            return this.updateTeiAttribute(patient.teiId || patient.id, field as string, value);
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
     * Correct orgUnit when entered incorrectly
     * Uses the simpler approach - just update the enrollment orgUnit
     */
    async changeOrgUnit(patient: any, newOrgUnitId: string, newOrgUnitName?: string): Promise<void> {
        const teiId = patient.teiId || patient.id;
        const enrollmentId = patient.enrollmentId;

        try {
            // If we don't have enrollmentId, try to find it
            let enrollmentToUse = enrollmentId;
            
            if (!enrollmentToUse) {
                // Try to get enrollment ID from the patient or fetch it
                enrollmentToUse = await this.getEnrollmentId(teiId);
            }

            // Update the enrollment orgUnit (this is the simplest approach)
            const payload = {
                enrollments: [{
                    enrollment: enrollmentToUse,
                    trackedEntity: teiId,
                    program: this.programId,
                    orgUnit: newOrgUnitId,
                    status: patient.enrollmentStatus || 'ACTIVE'
                }]
            };

            console.log('Updating enrollment with payload:', JSON.stringify(payload, null, 2));

            await firstValueFrom(
                this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, payload)
            );

            // Update the tracked entity orgUnit as well
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

            // Update local object
            patient.orgUnitId = newOrgUnitId;
            if (newOrgUnitName) patient.orgUnitName = newOrgUnitName;
            patient.syncStatus = 'synced';
            patient.updatedAt = new Date().toISOString();

            // Update in local storage
            if (this.patientService) {
                await this.patientService.updateLocalPatient(patient);
            }

        } catch (error) {
            console.error('Failed to change org unit:', error);
            throw error;
        }
    }

    /**
     * Simplified: Update just the enrollment orgUnit
     */
    async changeOrgUnitSimple(patient: any, newOrgUnitId: string): Promise<void> {
        const teiId = patient.teiId || patient.id;
        const enrollmentId = patient.enrollmentId || await this.getEnrollmentId(teiId);

        const payload = {
            enrollments: [{
                enrollment: enrollmentId,
                trackedEntity: teiId,
                program: this.programId,
                orgUnit: newOrgUnitId
            }]
        };

        await firstValueFrom(
            this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, payload)
        );
    }

    // ── private helpers ────────────────────────────────────────────

    private async updateTeiAttribute(teiId: string, field: string, value: string): Promise<void> {
        const attributeId = TEI_ATTRIBUTE_MAP[field];

        const payload = {
            trackedEntities: [{
                trackedEntity: teiId,
                trackedEntityType: this.trackedEntityTypeId,
                orgUnit: '', // This will be ignored if we don't set it, but we need to include it
                attributes: [{ attribute: attributeId, value }]
            }]
        };

        console.log('Updating TEI attribute with payload:', JSON.stringify(payload, null, 2));

        await firstValueFrom(
            this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, payload)
        );
    }

    private async updateEventDataElement(eventId: string, field: string, value: string): Promise<void> {
        const dataElementId = FIRST_VISIT_DE_MAP[field];

        const payload = {
            events: [{
                event: eventId,
                dataValues: [{ dataElement: dataElementId, value }]
            }]
        };

        console.log('Updating event with payload:', JSON.stringify(payload, null, 2));

        await firstValueFrom(
            this.http.post(`${this.baseUrl}/tracker?async=false&importStrategy=UPDATE`, payload)
        );
    }

    private async getEnrollmentId(teiId: string): Promise<string> {
        try {
            // Use the correct endpoint for fetching enrollments
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

            // Check different response formats
            const enrollment = res?.enrollments?.[0]?.enrollment || 
                             res?.instances?.[0]?.enrollment ||
                             res?.[0]?.enrollment;

            if (!enrollment) {
                throw new Error(`No enrollment found for TEI: ${teiId}`);
            }

            return enrollment;
        } catch (error) {
            console.error('Failed to get enrollment:', error);
            throw new Error(`Could not find enrollment for patient. Please ensure the patient has an active enrollment in the program.`);
        }
    }

    // Method to get the full enrollment details
    private async getEnrollmentDetails(enrollmentId: string): Promise<any> {
        try {
            const url = `${this.baseUrl}/tracker/enrollments/${enrollmentId}`;
            const response = await firstValueFrom(
                this.http.get(url, {
                    params: {
                        fields: 'enrollment,program,orgUnit,status,trackedEntity'
                    }
                })
            );
            return response;
        } catch (error) {
            console.error('Failed to get enrollment details:', error);
            throw error;
        }
    }

    // Add patientService reference
    private patientService: any;

    setPatientService(service: any): void {
        this.patientService = service;
    }
}