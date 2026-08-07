// src/config/dhis2.ts - FINAL v1.0 - Validated on iphis.health.gov.lk
// Program: Leprosy (BPDOWhjZOpl) | Stage: Clinic Visits (crFVDyMIVoP) | TET: Patient (Jie0Ykt4RnN)
// Tested: 2026-08-07 with user ALC_Rathnapura_PHI - orgUnit Sa955F8q271

export const DHIS2_CONFIG = {
  baseUrl: "https://iphis.health.gov.lk/api",
  program: "BPDOWhjZOpl",
  programStage: "crFVDyMIVoP",
  trackedEntityType: "Jie0Ykt4RnN",

  // Get orgUnit dynamically from /me - DO NOT HARDCODE
  // Example: me.organisationUnits[0].id = Sa955F8q271 (Ratnapura RDHS)

  attributes: {
    alcNumber: { id: "wYwMGbeZRQ1", label: "ALC Number", mandatory: true, type: "TEXT" as const },
    mdtDate: { id: "o86zhMxd1AC", label: "MDT Starting Date", mandatory: true, type: "DATE" as const },
    name: { id: "Ji9Ch6yTmpP", label: "Name", mandatory: true, type: "TEXT" as const },
    age: { id: "rf3rnRxa7Nz", label: "Age at diagnosis", mandatory: true, type: "INTEGER_POSITIVE" as const },
    phn: { id: "wj9wpvZlJbl", label: "PHN", type: "TEXT" as const },
    clinicNo: { id: "mk1k0CLbScR", label: "Clinic Number", type: "TEXT" as const },
    nic: { id: "ll5jqoC4vZq", label: "NIC", type: "TEXT" as const },
    guardian: { id: "X814r3soOUL", label: "Guardian", type: "TEXT" as const },
    gender: { id: "EzPOTL1bbku", label: "Gender", type: "TEXT" as const, options: ["Male","Female"] as const },
    dob: { id: "o4CG29BLYak", label: "DOB", type: "AGE" as const },
    ethnic: { id: "iyaGqxTwOxl", label: "Ethnic", type: "TEXT" as const },
    mobile: { id: "rQkWLLbN40W", label: "Mobile", type: "PHONE" as const },
    telephone: { id: "OSXgNXmmRCx", label: "Telephone", type: "PHONE" as const },
    permAddress: { id: "ZPC1iuFbUPc", label: "Permanent Address", type: "TEXT" as const },
    permCoords: { id: "UXuKtropdEV", label: "Permanent Coords", type: "COORDINATE" as const },
    gn: { id: "CujiSwU7ZyP", label: "GN Area", type: "TEXT" as const },
    phi: { id: "PqgS3Vta8QG", label: "PHI Area", type: "TEXT" as const },
    district: { id: "RvO2Ch5Xv22", label: "Health District", type: "TEXT" as const },
    currAddress: { id: "qgpxUxFHf3j", label: "Current Address", type: "TEXT" as const },
  },

  dataElements: {
    districtInstitution: { id: "HcBg02dZiaC", label: "A.1 District of Institution", type: "TEXT" as const },
    nameInstitution: { id: "vU9zxVEh0pM", label: "A.2 Name of Institution", type: "TEXT" as const },
    contactHistory: { id: "ojR3iFIujnD", label: "B.2.1 Contact History", type: "BOOLEAN" as const },
    contactType: { id: "S4Lh5W02jqV", label: "B.2.2 Contact Type", type: "TEXT" as const, options: ["Family","Neighbourhood","Social"] as const },
    onsetMonths: { id: "yRHEqkbKenG", label: "B.3 Time Since Onset", type: "TEXT" as const, options: ["0 to 6 Months","7 to 12 Months","13 to 18 Months","19 to 24 Months","25+ Months"] as const },
    classification: { id: "xGnEE5yzCMv", label: "B.4 Classification", type: "TEXT" as const, mandatory: true, options: ["PB (1-5 lesions)","MB (>5 lesions)"] as const },
    treatmentType: { id: "NGSkX7I1Rc7", label: "B.5.1 Treatment Type", type: "TEXT" as const, mandatory: true, options: ["MBA","PBA","MBC","PBC","Other"] as const },
    treatmentTypeOther: { id: "e9wmzg5uwuT", label: "B.5.2 Treatment Other", type: "TEXT" as const },
    caseType: { id: "XwwgRoXYElF", label: "B.8 Case type", type: "TEXT" as const, options: ["New","Retreatment -Defaulter","Retreatment -Relapse"] as const },
    yearCompletion: { id: "pev5IM8UJAi", label: "B.8.3 Year completion", type: "INTEGER_POSITIVE" as const },
    ehfScore: { id: "bkgQXamoPOv", label: "B.7 EHF Score", type: "NUMBER" as const },

    disabilities: {
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
    }
  }
} as const;

// Helper for orgUnit
export const getOrgUnitFromMe = (me: any) => me.organisationUnits?.[0]?.id;