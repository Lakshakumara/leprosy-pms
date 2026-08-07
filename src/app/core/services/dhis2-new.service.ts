// src/services/Dhis2NewService.ts - FINAL v1.0 - Tested on iphis.health.gov.lk
import { DHIS2_CONFIG } from "../../../config/dhis2";
import { NewPatientModel, validateNewPatient, toDhisAttributes } from "./newPatientModel";

export class Dhis2NewService {
  constructor(private baseUrl = DHIS2_CONFIG.baseUrl, private auth: { username: string; password: string }) {}

  private headers() {
    const token = btoa(`${this.auth.username}:${this.auth.password}`);
    return {
      "Content-Type": "application/json",
      "Authorization": `Basic ${token}`,
    };
  }

  // Get orgUnit dynamically - DO NOT HARDCODE
  async getMyOrgUnit(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/me?fields=organisationUnits[id]`, { headers: this.headers() });
    const me = await res.json();
    return me.organisationUnits?.[0]?.id;
  }

  async createPatient(model: NewPatientModel) {
    const errors = validateNewPatient(model);
    if (errors.length) throw new Error(errors.join(", "));

    const payload = {
      trackedEntities: [
        {
          orgUnit: model.orgUnit,
          trackedEntityType: DHIS2_CONFIG.trackedEntityType,
          attributes: toDhisAttributes(model),
          enrollments: [
            {
              orgUnit: model.orgUnit,
              program: DHIS2_CONFIG.program,
              enrolledAt: model.mdtStartingDate,
              occurredAt: model.mdtStartingDate,
              status: "ACTIVE",
            },
          ],
        },
      ],
    };

    const res = await fetch(`${this.baseUrl}/tracker?async=false`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    // Check for E1006 / E1020 etc
    if (data.status === "ERROR" || data.validationReport?.errorReports?.length) {
      throw new Error(JSON.stringify(data.validationReport || data, null, 2));
    }

    const teiId = data.bundleReport?.typeReportMap?.TRACKED_ENTITY?.objectReports?.[0]?.uid;
    return { teiId, response: data };
  }

  async getPatient(trackedEntityId: string) {
    const res = await fetch(
      `${this.baseUrl}/tracker/trackedEntities/${trackedEntityId}?program=${DHIS2_CONFIG.program}&fields=*`,
      { headers: this.headers() }
    );
    return res.json();
  }

  // Delete - New Tracker API way - tested on yW6ZbmGf6h5
  async deletePatient(trackedEntityId: string, orgUnit: string) {
    const payload = {
      trackedEntities: [
        {
          trackedEntity: trackedEntityId,
          orgUnit,
          trackedEntityType: DHIS2_CONFIG.trackedEntityType,
          deleted: true,
        },
      ],
    };

    const res = await fetch(`${this.baseUrl}/tracker?async=false`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    return res.json();
  }
}

// USAGE EXAMPLE - tested
/*
const service = new Dhis2NewService(DHIS2_CONFIG.baseUrl, { username: "ALC_Rathnapura_PHI", password: "Rathnapura#1" });
const orgUnit = await service.getMyOrgUnit(); // Sa955F8q271

const result = await service.createPatient({
  orgUnit,
  alcNumber: "ALC TEST 1000",
  name: "Test Patient",
  mdtStartingDate: new Date().toISOString().split('T')[0], // safe <= today
  ageAtDiagnosis: 48,
  permanentAddressCoords: [80.454869, 6.775423]
});
console.log("Created:", result.teiId);

// await service.deletePatient(result.teiId, orgUnit);
*/