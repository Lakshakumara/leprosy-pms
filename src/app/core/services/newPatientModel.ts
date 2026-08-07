// src/models/NewPatientModel.ts - FINAL v1.0 - Validated 2026-08-07

import { clear } from "idb-keyval";
import { DHIS2_CONFIG } from "../../../config/dhis2";

export interface NewPatientModel {
    orgUnit: string; // dynamic from /me.organisationUnits[0].id
    // mandatory - per program rules
    alcNumber: string;
    name: string;
    mdtStartingDate: string; // YYYY-MM-DD - MUST be <= today (IPHIS server date)
    ageAtDiagnosis: number;

    // optional
    phn?: string;
    clinicNumber?: string;
    nic?: string;
    guardianName?: string;
    gender?: 'Male' | 'Female';
    dob?: string; // YYYY-MM-DD
    ethnicGroup?: string;
    mobile?: string;
    telephone?: string;
    permanentAddress?: string;
    permanentAddressCoords?: [number, number]; // [longitude, latitude] e.g. [80.45, 6.77]
    gnArea?: string;
    phiArea?: string;
    healthDistrict?: string;
    currentAddress?: string;
}

export function toDhisAttributes(model: NewPatientModel) {
    const A = DHIS2_CONFIG.attributes;
    const attrs: { attribute: string; value: string }[] = [];

    const push = (id: string, value: any) => {
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            attrs.push({ attribute: id, value: String(value).trim() });
        }
    };

    // mandatory
    push(A.alcNumber.id, model.alcNumber);
    push(A.name.id, model.name);
    push(A.mdtDate.id, model.mdtStartingDate);
    push(A.age.id, model.ageAtDiagnosis);

    // optional
    push(A.phn.id, model.phn);
    push(A.clinicNo.id, model.clinicNumber);
    push(A.nic.id, model.nic);
    push(A.guardian.id, model.guardianName);
    push(A.gender.id, model.gender);
    push(A.dob.id, model.dob);
    push(A.ethnic.id, model.ethnicGroup);
    push(A.mobile.id, model.mobile);
    push(A.telephone.id, model.telephone);
    push(A.permAddress.id, model.permanentAddress);
    push(A.gn.id, model.gnArea);
    push(A.phi.id, model.phiArea);
    push(A.district.id, model.healthDistrict);
    push(A.currAddress.id, model.currentAddress);

    if (model.permanentAddressCoords) {
        const [lon, lat] = model.permanentAddressCoords;
        // Validated format: [lon, lat] - tested on yW6ZbmGf6h5
        push(A.permCoords.id, `[${lon}, ${lat}]`);
    }

    return attrs;
}

export function validateNewPatient(model: NewPatientModel) {
    const errors: string[] = [];
    if (!model.orgUnit) errors.push("orgUnit required - get from /me");
    if (!model.alcNumber) errors.push("ALC Number required");
    if (!model.name) errors.push("Name required");
    if (!model.mdtStartingDate) errors.push("MDT Date required");
    if (!model.ageAtDiagnosis || model.ageAtDiagnosis <= 0) errors.push("Age >0 required");

    // Prevent E1020/E1021 - server rejects future dates
    if (model.mdtStartingDate) {
        const today = new Date().toISOString().split('T')[0];
        if (model.mdtStartingDate > today) {
            errors.push(`MDT Date cannot be future (today ${today}) - use <= today`);
        }
    }
    return errors;
}

// Helper - always send safe date
export const getSafeDate = () => new Date().toISOString().split('T')[0];


// src/models/ClinicVisitModel.ts - FINAL v1.0 - 30 dataElements from crFVDyMIVoP
// src/models/ClinicVisitModel.ts - FINAL v1.0 - 30 dataElements - TS safe
export interface ClinicVisitModel {
  // A
  districtInstitution: string;
  nameInstitution: string;

  // B.1
  sourceReferral?: 'Self referred' | 'Contact tracing' | 'School Survey' | 'Household/Ring surveys' | 'Screening Clinics' | 'Private Sector' | 'Other';
  sourceReferralOther?: string;

  // B.2
  contactHistory?: boolean;
  contactType?: 'Family' | 'Neighbourhood' | 'Social';

  // B.3-B.5
  onsetMonths?: string;
  classification: 'PB (1-5 lesions)' | 'MB (>5 lesions)';
  treatmentType: 'MBA' | 'PBA' | 'MBC' | 'PBC' | 'Other';
  treatmentTypeOther?: string;

  // B.6 Disabilities
  disabilities?: {
    numbnessRH?: boolean;
    numbnessLH?: boolean;
    numbnessRF?: boolean;
    numbnessLF?: boolean;
    clawRH?: boolean;
    clawLH?: boolean;
    footDropRF?: boolean;
    footDropLF?: boolean;
    ulcerRF?: boolean;
    ulcerLF?: boolean;
    eyeDefRF?: boolean;
    eyeDefLF?: boolean;
    grade0?: boolean;
    grade1?: boolean;
    grade2?: boolean;
  };

  // B.7-B.8
  ehfScore?: string;
  caseType?: 'New' | 'Retreatment -Defaulter' | 'Retreatment -Relapse';
  prevTreatmentType?: string;
  prevTreatmentOther?: string;
  yearCompletion?: number;
}

const DISABILITY_MAP: Record<keyof NonNullable<ClinicVisitModel['disabilities']>, string> = {
  numbnessRH: "tXiJDeDkNnd",
  numbnessLH: "mG2SIcepAH6",
  numbnessRF: "gnFppcCX3Gn",
  numbnessLF: "kzT820Hdxw5",
  clawRH: "fEHWd1opqco",
  clawLH: "lgWBH1yBUgt",
  footDropRF: "HYoWObgRa4O",
  footDropLF: "RxR4oQ4Vb7e",
  ulcerRF: "VD48W4Crv6g",
  ulcerLF: "ZcoNtYc5nU6",
  eyeDefRF: "lQ1La9uFvn2",
  eyeDefLF: "wkhABYcpW5R",
  grade0: "ABkcGGYdSxp",
  grade1: "WfutxALBzyV",
  grade2: "mc2WjY1x1J8",
};

export function toDhisDataValues(model: ClinicVisitModel) {
  const dataValues: { dataElement: string; value: any }[] = [];
  const push = (id: string, val: any) => {
    if (val!== undefined && val!== '' && val!== null) {
      dataValues.push({ dataElement: id, value: val });
    }
  };

  push("HcBg02dZiaC", model.districtInstitution);
  push("vU9zxVEh0pM", model.nameInstitution);
  push("POR3r6VghQR", model.sourceReferral);
  push("R6LEEPWU9EW", model.sourceReferralOther);
  push("ojR3iFIujnD", model.contactHistory);
  push("S4Lh5W02jqV", model.contactType);
  push("yRHEqkbKenG", model.onsetMonths);
  push("xGnEE5yzCMv", model.classification);
  push("NGSkX7I1Rc7", model.treatmentType);
  push("e9wmzg5uwuT", model.treatmentTypeOther);
  push("bkgQXamoPOv", model.ehfScore);
  push("XwwgRoXYElF", model.caseType);
  push("B1ZZml7ETP7", model.prevTreatmentType);
  push("ypp4Wk7ban2", model.prevTreatmentOther);
  push("pev5IM8UJAi", model.yearCompletion);

  if (model.disabilities) {
    (Object.keys(model.disabilities) as Array<keyof typeof model.disabilities>).forEach((k) => {
      if (model.disabilities![k] === true) {
        push(DISABILITY_MAP[k], true);
      }
    });
  }

  return dataValues;
}