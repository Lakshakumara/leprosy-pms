/**
 * DTOs for a DHIS2 Tracked Entity Instance (Leprosy program).
 *
 * Field names are now based on CONFIRMED DHIS2 metadata for program stage
 * "Individial Patient forms - 1st visit" (x0vRwubw5S7), from
 * programStages[].programStageDataElements.
 *
 * Bookkeeping fields (createdBy, timestamps, etc.) are kept generic since
 * they're system-generated, not user input.
 */

// ---------- Shared / system metadata ----------

export interface Dhis2User {
  uid: string;
  username: string;
  firstName: string;
  surname: string;
}

// ---------- Tracked Entity Attribute (user-entered demographic/ID data) ----------

export interface TrackedEntityAttributeDto {
  attribute: string;       // UID, e.g. 'AujHTe3nXx4'
  displayName: string;     // e.g. 'Lep - Alc - Num'
  createdAt: string;
  updatedAt: string;
  storedBy: string;
  valueType: 'TEXT' | 'PHONE_NUMBER' | 'AGE' | string;
  value: string;
}

/**
 * Strongly-typed view of the attributes for this program, keyed by field
 * meaning rather than raw UID. Map to/from TrackedEntityAttributeDto[] using
 * the UIDs in environment.TRACKED_ENTITY_ATTRIBUTES.
 */
export interface LeprosyPatientAttributesDto {
  alcNum: string;         // Lep - Alc - Num
  clinicNum: string;      // Lep - Clinic Num
  nicNum: string;         // Lep - NIC Num
  guardianName: string;   // Lep - Guardian Name
  mobileNum: string;      // Lep - Mobile Num
  patientName: string;    // Lep - Patient name
  patientSex: 'Male' | 'Female' | string;
  ethnicGroup: string;    // Lep - Ethnic group
  patientAge: number;     // Lep - Patient age
}

// ---------- Event data values (user-entered clinical/visit data) ----------

export interface DataValueDto {
  dataElement: string;   // UID
  value: string;         // raw string as stored by DHIS2
  providedElsewhere: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: Dhis2User;
  updatedBy?: Dhis2User;
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

// ---------- Event ----------

export interface Dhis2EventDto {
  event: string;
  status: 'ACTIVE' | 'COMPLETED' | 'SCHEDULE' | string;
  program: string;
  programStage: string;
  enrollment: string;
  trackedEntity: string;
  orgUnit: string;       // UID — resolve via Dhis2OrgUnitService, never hardcode
  orgUnitName: string;
  scheduledAt?: string;
  occurredAt?: string;
  completedAt?: string;
  dataValues: DataValueDto[];
}

// ---------- Enrollment ----------

export interface Dhis2EnrollmentDto {
  enrollment: string;
  trackedEntity: string;
  program: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | string;
  orgUnit: string;       // UID — resolve via Dhis2OrgUnitService, never hardcode
  orgUnitName: string;
  enrolledAt: string;
  occurredAt: string;
  attributes: TrackedEntityAttributeDto[];
  events: Dhis2EventDto[];
}

// ---------- Tracked Entity Instance (root) ----------

export interface TrackedEntityInstanceDto {
  trackedEntity: string;
  trackedEntityType: string;
  orgUnit: string;       // UID — resolve via Dhis2OrgUnitService, never hardcode
  inactive: boolean;
  deleted: boolean;
  attributes: TrackedEntityAttributeDto[];
  enrollments: Dhis2EnrollmentDto[];
}

// ---------- Mapping helpers ----------

/**
 * Converts the raw DHIS2 attribute array into the flat, typed shape.
 */
export function toLeprosyPatientAttributesDto(
  attributes: TrackedEntityAttributeDto[],
): LeprosyPatientAttributesDto {
  const byUid = new Map(attributes.map((a) => [a.attribute, a.value]));

  return {
    alcNum: byUid.get('AujHTe3nXx4') ?? '',
    clinicNum: byUid.get('Sn6LwDqapMU') ?? '',
    nicNum: byUid.get('B6au8evTRWl') ?? '',
    guardianName: byUid.get('UBWQy1GFOee') ?? '',
    mobileNum: byUid.get('Y4H01gi8N2M') ?? '',
    patientName: byUid.get('hGbU1zkkxH8') ?? '',
    patientSex: byUid.get('C9FV3HiPEkA') ?? '',
    ethnicGroup: byUid.get('cw1sJo3q9UF') ?? '',
    patientAge: Number(byUid.get('C0ZoykFjsTP') ?? 0),
  };
}

/**
 * Converts the "1st visit" stage event's dataValues into the flat, typed shape.
 */
export function toLeprosyFirstVisitDto(
  dataValues: DataValueDto[],
): LeprosyFirstVisitDto {
  const byUid = new Map(dataValues.map((d) => [d.dataElement, d.value]));
  const parseCoords = (raw?: string): [number, number] => {
    if (!raw) return [0, 0];
    const [lng, lat] = JSON.parse(raw);
    return [lng, lat];
  };

  return {
    disabilityAtDiagnosis: byUid.get('ijKomxeLSWM') ?? '',
    contactHistory: byUid.get('hEJbywu7U6T') === 'true',
    nameOfConsultant: byUid.get('XLvfoGQFPs7') ?? '',
    nameOfMO: byUid.get('pJVd9qUrc82') ?? '',
    otherTreatmentType: byUid.get('SkH1beczIBn'),
    patientDistrict: byUid.get('iB1RHZOqhhb') ?? '',
    patientGnDivision: byUid.get('tkCFwCc74QL') ?? '',
    patientGpsCoordinates: parseCoords(byUid.get('gm91XYLCpsS')),
    patientHomeAddress: byUid.get('zGdT30K7Gf2') ?? '',
    patientMohArea: byUid.get('RsUDxHKh2w4') ?? '',
    patientPhiArea: byUid.get('PgVeByg4SgG') ?? '',
    patientReferredBy: byUid.get('JGChabLUuiU') ?? '',
    sourceOfContactHistory: byUid.get('nUhyMVGZCwp'),
    timeSinceOnsetMonths: byUid.get('XDAadR1AiAg') ?? '',
    treatmentClassification: byUid.get('Rten0X02zxy') ?? '',
    ehfScore: Number(byUid.get('i3RUk9EeSaZ') ?? 0),
    treatmentType: byUid.get('bs5NPrHfdsB') ?? '',
    changeOfTreatmentType: byUid.get('o18RSOmhyi4'),
    defaulterRestartingTreatment: byUid.get('UGYkKdtiW3L'),
    previousTreatmentType: byUid.get('cBm44wyUsJ6'),
    relapse: byUid.get('UBX6sBorlFy'),
    clawHand: byUid.get('CNme2qNFYpn') === 'true',
    caseType: byUid.get('WyQFv86DRDm'),
    eyeInvolvement: byUid.get('OUWZVXF3zty'),
    yearOfTreatmentCompletion: byUid.get('QwZQUEWQ5TS'),
    faceInvolvement: byUid.get('IYtg3pRjQk6'),
    footDrop: byUid.get('JCrTNTvDAWi'),
    footUlcer: byUid.get('hkCk03W7xWH'),
  };
}
