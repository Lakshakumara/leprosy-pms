/**
 * DTOs for the patient list GUI: the org unit filter options, the filter
 * state itself, and a flattened row shape for the table.
 */

export type OuMode = 'SELECTED' | 'CHILDREN' | 'DESCENDANTS' | 'ACCESSIBLE';

/** One checkbox/dropdown option in the org unit filter (a level-4 facility). */
export interface OrgUnitFilterOptionDto {
  id: string;
  displayName: string;
  level: number;
  path: string;
}

/** Current state of the GUI filter panel. */
export interface PatientListFilterDto {
  orgUnitIds: string[];   // one or more of the 6 facility ids; empty = all under district
  ouMode?: OuMode;         // defaults to 'SELECTED' — exactly the chosen facilities
  page?: number;
  pageSize?: number;
}

/** One row in the patient list table (flattened from tracker API response). */
export interface PatientListItemDto {
  trackedEntity: string;   // TEI uid
  orgUnit: string;         // facility uid
  orgUnitName?: string;    // resolved facility display name (join with OrgUnitFilterOptionDto)
  alcNum: string;
  clinicNum: string;
  nicNum: string;
  patientName: string;
  patientSex: string;
  patientAge: number;
  enrollmentStatus?: string;
  enrolledAt?: string;
}
/**
 * Strongly-typed view of the "1st visit" stage (x0vRwubw5S7) dataValues.
 * Field names now match confirmed DHIS2 data element display names.
 * Fields marked optional (`?`) did not appear with a value in the sample
 * event but exist as configured data elements on this stage.
 */
export interface LeprosyFirstVisitDto {
  disabilityAtDiagnosis: string;         // ijKomxeLSWM - Lep - Disability at diagnosis
  contactHistory: boolean;               // hEJbywu7U6T - Lep - Contact history yes or NO
  nameOfConsultant: string;              // XLvfoGQFPs7 - Lep - Name of Consultant
  nameOfMO: string;                      // pJVd9qUrc82 - Lep - Name of MO
  otherTreatmentType?: string;           // SkH1beczIBn - Lep - Other Treatment Type
  patientDistrict: string;               // iB1RHZOqhhb - Lep - Patient District
  patientGnDivision: string;             // tkCFwCc74QL - Lep - Patient GN Division
  patientGpsCoordinates: [number, number]; // gm91XYLCpsS - Lep - Patient GPS Co ordinates
  patientHomeAddress: string;            // zGdT30K7Gf2 - Lep - Patient Home Address
  patientMohArea: string;                // RsUDxHKh2w4 - Lep - Patient MOH area
  patientPhiArea: string;                // PgVeByg4SgG - Lep - Patient PHI Area
  patientReferredBy: string;             // JGChabLUuiU - Lep - Patient Referred by
  sourceOfContactHistory?: string;       // nUhyMVGZCwp - Lep - Source of Contact History
  timeSinceOnsetMonths: string;          // XDAadR1AiAg - Lep - Time since onset of symptoms (months)
  treatmentClassification: string;       // Rten0X02zxy - Lep - Treatment Classification
  ehfScore: number;                      // i3RUk9EeSaZ - Lep - EHF Score
  treatmentType: string;                 // bs5NPrHfdsB - Lep - Treatment Type
  changeOfTreatmentType?: string;        // o18RSOmhyi4 - Lep - Change of treatment type
  defaulterRestartingTreatment?: string; // UGYkKdtiW3L - Lep - Defaulter restarting treatment
  previousTreatmentType?: string;        // cBm44wyUsJ6 - Lep - Previous treatment type
  relapse?: string;                      // UBX6sBorlFy - Lep - Relapse
  clawHand: boolean;                     // CNme2qNFYpn - Lep - Claw hand
  caseType?: string;                     // WyQFv86DRDm - Lep - Case type
  eyeInvolvement?: string;               // OUWZVXF3zty - Lep - Eye involvement
  yearOfTreatmentCompletion?: string;    // QwZQUEWQ5TS - Lep - Year of treatment completion
  faceInvolvement?: string;              // IYtg3pRjQk6 - Lep - Face involvement
  footDrop?: string;                     // JCrTNTvDAWi - Lep - Foot drop
  footUlcer?: string;                    // hkCk03W7xWH - Lep - Foot ulcer
}
