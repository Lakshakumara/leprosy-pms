/**
 * DHIS2 metadata UID mappings for the Leprosy (Lep) program.
 *
 * Sources:
 *  - TRACKED_ENTITY_ATTRIBUTES: from the tracked entity instance JSON (`displayName` given).
 *  - DATA_ELEMENTS: from `programStages[].programStageDataElements` metadata for
 *    stage "Individial Patient forms - 1st visit" (id: x0vRwubw5S7). Names confirmed.
 *  - PROGRAM_STAGES: only ONE stage name is confirmed so far (x0vRwubw5S7). The
 *    other stage UIDs seen in the sample enrollment are still unnamed.
 */

export const environment = {
  dhis2: {
    baseUrl: '/dhis2-api',
    // Prefer a Personal Access Token (PAT) over basic auth in production.
    // Generate one from DHIS2: Profile > Personal Access Tokens.
    // Sent as header: Authorization: ApiToken <token>
    apiToken: '',
    // Fallback basic auth (dev only - do not ship credentials in prod builds,
    // and do not commit a real password here — set it locally only)
    username: '',
    password: '',
    program: 'sqsddKuTGlJ',        // Leprosy program
    trackedEntityType: 'S2afGQZ5tDu',
    endpoints: {
      organisationUnits: '/organisationUnits',
      trackedEntities: '/tracker/trackedEntities', // new Tracker API
    },
  },

    /**
   * Tracked Entity Attributes (confirmed from `displayName` in source JSON)
   */
  TRACKED_ENTITY_ATTRIBUTES: {
    ALC_NUM:        { uid: 'AujHTe3nXx4', displayName: 'Lep - Alc - Num',         valueType: 'TEXT' },
    CLINIC_NUM:     { uid: 'Sn6LwDqapMU', displayName: 'Lep - Clinic Num',        valueType: 'TEXT' },
    NIC_NUM:        { uid: 'B6au8evTRWl', displayName: 'Lep - NIC Num',           valueType: 'TEXT' },
    GUARDIAN_NAME:  { uid: 'UBWQy1GFOee', displayName: 'Lep - Guardian Name',     valueType: 'TEXT' },
    MOBILE_NUM:     { uid: 'Y4H01gi8N2M', displayName: 'Lep - Mobile Num',        valueType: 'PHONE_NUMBER' },
    TEL_NUM:        { uid: 'g71IALGz9U8', displayName: 'Lep - Tel Num',           valueType: 'PHONE_NUMBER' },
    PATIENT_NAME:   { uid: 'hGbU1zkkxH8', displayName: 'Lep - Patient name',      valueType: 'TEXT' },
    PATIENT_SEX:    { uid: 'C9FV3HiPEkA', displayName: 'Lep - Patient Sex',       valueType: 'TEXT' },
    ETHNIC_GROUP:   { uid: 'cw1sJo3q9UF', displayName: 'Lep - Ethnic group',      valueType: 'TEXT' },
    PATIENT_AGE:    { uid: 'C0ZoykFjsTP', displayName: 'Lep - Patient age',       valueType: 'TEXT' },
  } as const,

  /**
   * Program Stages. Only the "1st visit" stage name is confirmed via metadata.
   * Follow-up visit stages (12-month schedule) are pending DHIS2 configuration —
   * they will be included in a future release.
   */
  PROGRAM_STAGES: {
    FIRST_VISIT:            'x0vRwubw5S7',   // confirmed: "Individial Patient forms - 1st visit"
    STAGE_iE4QnfmTuKe:     'iE4QnfmTuKe',   // TODO: confirm name (likely follow-up)
    STAGE_DhtWICcZhwK:     'DhtWICcZhwK',
    STAGE_jpvOb2i5Jai:     'jpvOb2i5Jai',
    STAGE_z6AnZV6phI8:     'z6AnZV6phI8',
    STAGE_h1TrdlCaFSc:     'h1TrdlCaFSc',
    STAGE_SYJtmQu4E30:     'SYJtmQu4E30',
    STAGE_x95G5bOeDN1:     'x95G5bOeDN1',
    STAGE_LqgKGaiwXua:     'LqgKGaiwXua',
    STAGE_QdVsBuNTCrm:     'QdVsBuNTCrm',
    STAGE_MJHs4by4KDD:     'MJHs4by4KDD',
    STAGE_LxB9ArHmMGC:     'LxB9ArHmMGC',
    STAGE_U6IkW19zK7J:     'U6IkW19zK7J',
    STAGE_xSGWfQwwD93:     'xSGWfQwwD93',
  } as const,

  /**
   * Data Elements for stage FIRST_VISIT (x0vRwubw5S7), names confirmed from
   * `programStageDataElements` metadata.
   */
  DATA_ELEMENTS: {
    DISABILITY_AT_DIAGNOSIS:        { uid: 'ijKomxeLSWM', displayName: 'Lep - Disability at diagnosis' },
    CONTACT_HISTORY:                { uid: 'hEJbywu7U6T', displayName: 'Lep - Contact history yes or NO' },
    NAME_OF_CONSULTANT:             { uid: 'XLvfoGQFPs7', displayName: 'Lep - Name of Consultant' },
    NAME_OF_MO:                     { uid: 'pJVd9qUrc82', displayName: 'Lep - Name of MO' },
    OTHER_TREATMENT_TYPE:           { uid: 'SkH1beczIBn', displayName: 'Lep - Other Treatment Type' },
    PATIENT_DISTRICT:               { uid: 'iB1RHZOqhhb', displayName: 'Lep - Patient District' },
    PATIENT_GN_DIVISION:            { uid: 'tkCFwCc74QL', displayName: 'Lep - Patient GN Division' },
    PATIENT_GPS_COORDINATES:        { uid: 'gm91XYLCpsS', displayName: 'Lep - Patient GPS Co ordinates' },
    PATIENT_HOME_ADDRESS:           { uid: 'zGdT30K7Gf2', displayName: 'Lep - Patient Home Address' },
    PATIENT_MOH_AREA:               { uid: 'RsUDxHKh2w4', displayName: 'Lep - Patient MOH area' },
    PATIENT_PHI_AREA:               { uid: 'PgVeByg4SgG', displayName: 'Lep - Patient PHI Area' },
    PATIENT_REFERRED_BY:            { uid: 'JGChabLUuiU', displayName: 'Lep - Patient Referred by' },
    SOURCE_OF_CONTACT_HISTORY:      { uid: 'nUhyMVGZCwp', displayName: 'Lep - Source of Contact History' },
    TIME_SINCE_ONSET_MONTHS:        { uid: 'XDAadR1AiAg', displayName: 'Lep - Time since onset of symptoms (months)' },
    TREATMENT_CLASSIFICATION:       { uid: 'Rten0X02zxy', displayName: 'Lep - Treatment Classification' },
    /*"dataElement": "Rten0X02zxy",
    "value": "MB (>5 lesions)"
}*/
    EHF_SCORE:                      { uid: 'i3RUk9EeSaZ', displayName: 'Lep - EHF Score' },     // 0–12
    TREATMENT_TYPE:                 { uid: 'bs5NPrHfdsB', displayName: 'Lep - Treatment Type' },
    CHANGE_OF_TREATMENT_TYPE:       { uid: 'o18RSOmhyi4', displayName: 'Lep - Change of treatment type' },
    DEFAULTER_RESTARTING_TREATMENT: { uid: 'UGYkKdtiW3L', displayName: 'Lep - Defaulter restarting treatment' },
    PREVIOUS_TREATMENT_TYPE:        { uid: 'cBm44wyUsJ6', displayName: 'Lep - Previous treatment type' },
    RELAPSE:                        { uid: 'UBX6sBorlFy', displayName: 'Lep - Relapse' },
    CLAW_HAND:                      { uid: 'CNme2qNFYpn', displayName: 'Lep - Claw hand' },
    CASE_TYPE:                      { uid: 'WyQFv86DRDm', displayName: 'Lep - Case type' },
    EYE_INVOLVEMENT:                { uid: 'OUWZVXF3zty', displayName: 'Lep - Eye involvement' },
    YEAR_OF_TREATMENT_COMPLETION:   { uid: 'QwZQUEWQ5TS', displayName: 'Lep - Year of treatment completion' },
    FACE_INVOLVEMENT:               { uid: 'IYtg3pRjQk6', displayName: 'Lep - Face involvement' },
    FOOT_DROP:                      { uid: 'JCrTNTvDAWi', displayName: 'Lep - Foot drop' },
    FOOT_ULCER:                     { uid: 'hkCk03W7xWH', displayName: 'Lep - Foot ulcer' },
  } as const,

  // --- Google Maps ---
  // Get a key from https://console.cloud.google.com/google/maps-apis
  googleMapsApiKey: 'AIzaSyASfzX-MbMu9lWERu0l2JVA0TAUH1_Mws4'
};

export type Dhis2Environment = typeof environment;
//export type FacilityDto = typeof environment.FACILITIES[number];
/**
   * The 6 level-4 facilities registered under Ratnapura RDHS.
   * Used for hospital filter dropdowns — static to avoid an async org-unit fetch
   * on every page load.
   */
  /*FACILITIES: [
    {
      id: 'LCZgWKWn71b',
      displayName: 'TH-Rathnapura',
      path: '/GYBZ1og9bk7/G8wNqDYI245/Sa955F8q271/LCZgWKWn71b',
      level: 4,
    },
    {
      id: 'nqVVoCVGEr3',
      displayName: 'DGH Embilipitiya',
      path: '/GYBZ1og9bk7/G8wNqDYI245/Sa955F8q271/nqVVoCVGEr3',
      level: 4,
    },
    {
      id: 'LCZgWKWn63a',
      displayName: 'BHB Balangoda',
      path: '/GYBZ1og9bk7/G8wNqDYI245/Sa955F8q271/LCZgWKWn63a',
      level: 4,
    },
    {
      id: 'LCZgWKWn36c',
      displayName: 'BHB Kahawatta',
      path: '/GYBZ1og9bk7/G8wNqDYI245/Sa955F8q271/LCZgWKWn36c',
      level: 4,
    },
    {
      id: 'LCZgWKWn26c',
      displayName: 'BHB Kalawana',
      path: '/GYBZ1og9bk7/G8wNqDYI245/Sa955F8q271/LCZgWKWn26c',
      level: 4,
    },
    {
      id: 'LCZgWKW134a',
      displayName: 'BHB Eheliyagoda',
      path: '/GYBZ1og9bk7/G8wNqDYI245/Sa955F8q271/LCZgWKW134a',
      level: 4,
    },
    
  ] as const,
   // The authenticated user's assigned org unit (district level, level 3).
    // Facilities under it (level 4) are listed in FACILITIES below.
    /*district: {
      id: 'Sa955F8q271',
      displayName: 'Ratnapura RDHS',
      level: 3,
      path: '/GYBZ1og9bk7/G8wNqDYI245/Sa955F8q271',
    },*/
