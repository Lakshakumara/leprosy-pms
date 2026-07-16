/**
 * Canonical Patient model for the Leprosy PMS.
 *
 * All clinical fields are sourced from DHIS2:
 *  - TEI Attributes  → demographics / identifiers
 *  - Enrollment      → facility, dates, status
 *  - FIRST_VISIT event data elements → classification, EHF score, areas, deformities, etc.
 *
 * EHF score (Eye–Hand–Foot) ranges 0–12 and serves as the disability grade.
 * New patients are entered directly in DHIS2; this app is read-only + offline cache.
 */

export type SyncStatus = 'synced' | 'pending' | 'error' | 'local-only';

export interface Patient {
  /** Local ID = DHIS2 trackedEntity UID */
  id: string;
  /** DHIS2 trackedEntity UID (same as id for DHIS2-sourced records) */
  teiId?: string;

  // ── TEI Attributes ─────────────────────────────────────────────────────────
  alcNum: string;       // AujHTe3nXx4 — primary field identifier in Sri Lanka
  clinicNum: string;    // Sn6LwDqapMU
  nicNum: string;       // B6au8evTRWl — National ID Card
  guardianName: string; // UBWQy1GFOee
  mobileNum: string;    // Y4H01gi8N2M
  patientName: string;  // hGbU1zkkxH8 — full name
  patientSex: string;   // C9FV3HiPEkA — 'Male' | 'Female'
  ethnicGroup: string;  // cw1sJo3q9UF
  patientAge: number;   // C0ZoykFjsTP

  // ── Enrollment ─────────────────────────────────────────────────────────────
  orgUnitId: string;         // facility UID (level 4)
  orgUnitName: string;       // e.g. "TH-Rathnapura"
  enrolledAt: string;        // ISO date string, e.g. "2023-06-15"
  enrollmentStatus: string;  // ACTIVE | COMPLETED | CANCELLED

  // ── FIRST_VISIT Event Data Elements (x0vRwubw5S7) ─────────────────────────
  treatmentClassification: string; // Rten0X02zxy — MB or PB
  disabilityAtDiagnosis: string;   // ijKomxeLSWM — free text description
  ehfScore: number;                // i3RUk9EeSaZ — Eye-Hand-Foot score, 0–12
  patientMohArea: string;          // RsUDxHKh2w4 — MOH area name
  patientPhiArea: string;          // PgVeByg4SgG — PHI area name
  patientGnDivision: string;       // tkCFwCc74QL — GN Division name
  patientDistrict: string;         // iB1RHZOqhhb
  patientHomeAddress: string;      // zGdT30K7Gf2
  treatmentType: string;           // bs5NPrHfdsB — MDT type (MB-MDT / PB-MDT)
  caseType: string;                // WyQFv86DRDm
  contactHistory: boolean;         // hEJbywu7U6T
  contactHistorySource: string;    // nUhyMVGZCwp
  relapse: string;                 // UBX6sBorlFy
  defaulterRestartingTreatment: string; // UGYkKdtiW3L
  changeOfTreatmentType: string;   // o18RSOmhyi4
  previousTreatmentType: string;   // cBm44wyUsJ6
  yearOfTreatmentCompletion: string; // QwZQUEWQ5TS
  timeSinceOnsetMonths: string;    // XDAadR1AiAg
  nameOfConsultant: string;        // XLvfoGQFPs7
  nameOfMO: string;                // pJVd9qUrc82
  patientReferredBy: string;       // JGChabLUuiU

  // ── Deformity Details ──────────────────────────────────────────────────────
  clawHand: boolean;       // CNme2qNFYpn
  footDrop: string;        // JCrTNTvDAWi
  footUlcer: string;       // hkCk03W7xWH
  eyeInvolvement: string;  // OUWZVXF3zty
  faceInvolvement: string; // IYtg3pRjQk6

  // ── Geography ──────────────────────────────────────────────────────────────
  latitude?: number;
  longitude?: number;

  // ── Meta ───────────────────────────────────────────────────────────────────
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

/**
 * Filter state for the patient list.
 * All fields are optional; absent/undefined = no filter applied for that field.
 * MOH / PHI / GN values come from distinct values stored in IndexedDB.
 */
export interface PatientFilter {
  /** Free-text search across patientName, alcNum, nicNum */
  search?: string;
  /** Exact ALC number match */
  alcNum?: string;
  /** 'MB' | 'PB' | 'ALL' */
  classification?: string;
  /** Facility org unit ID, one of the 6 hospitals */
  orgUnitId?: string;
  /** MOH area, matched by contains-ignore-case */
  mohArea?: string;
  /** PHI area, matched by contains-ignore-case */
  phiArea?: string;
  /** GN Division, matched by contains-ignore-case */
  gnDivision?: string;
  /** ISO date string — filter patients enrolled on or after this date */
  enrolledFrom?: string;
  /** ISO date string — filter patients enrolled on or before this date */
  enrolledTo?: string;
}
export const createDefaultPatientFilter = (): PatientFilter => ({
  enrolledFrom: `${new Date().getFullYear()}-01-01`,
  enrolledTo: new Date().toISOString().split('T')[0]
});