
// password: 'AlcRatnapura@2023',
//apiToken: 'd2pat_xDvgejPgu5QW9GojtAxn7dfycUSpMfSj0148869625',
export const environment = {
  production: false,
  appName: 'Leprosy Patient Management System',

  // --- DHIS2 connection ---
  // Point this at your DHIS2 instance. For local dev against the DHIS2 play server
  // or your own instance, set the base URL and auth below.
  dhis2: {
    baseUrl: '/dhis2-api',
    // Prefer a Personal Access Token (PAT) over basic auth in production.
    // Generate one from DHIS2: Profile > Personal Access Tokens.
    // Sent as header: Authorization: ApiToken <token>
    apiToken: 'd2pat_xDvgejPgu5QW9GojtAxn7dfycUSpMfSj0148869625',
    // Fallback basic auth (dev only - do not ship credentials in prod builds,
    // and do not commit a real password here — set it locally only)
    username: 'ALC-RPra-PHI1',
    password: 'AlcRatnapura@2023',
    // IDs you must create once in DHIS2 (see README "DHIS2 setup" section)
    programId: 'sqsddKuTGlJ',    // "Individual Patient Form"
    trackedEntityTypeId: 'x0vRwubw5S7',     // fill in: GET /api/trackedEntityTypes.json?fields=id,name
    orgUnitId: 'Sa955F8q271',    // "Ratnapura RDHS" - adjust to your district/facility
    attributes: {
      patientName: 'hGbU1zkkxH8',   // Lep - Patient name
      nic: 'B6au8evTRWl',            // Lep - NIC Num
      mobile: 'Y4H01gi8N2M',          // Lep - Mobile Num
      sex: 'C9FV3HiPEkA',             // Lep - Patient Sex
      age: 'C0ZoykFjsTP',            // Lep - Patient age
      clinicNum: 'Sn6LwDqapMU',      // Lep - Clinic Num
      guardianName: 'UBWQy1GFOee',    // Lep - Guardian Name
      classification: 'Rten0X02zxy',  // Lep - Classification (MB/PB)
      // NOTE: no onset-year / MB-PB attribute found yet on this program's
      // tracked entity attributes — these are most likely captured as
      // program-stage (event) data elements instead. Run:
      //   GET /api/programStages.json?filter=program.id:eq:sqsddKuTGlJ
      //     &fields=id,name,programStageDataElements[dataElement[id,name]]
      // to locate them, then Dhis2Service needs a second call to
      // /api/tracker/events to pull and merge those values per patient.
    }
  },

  // --- Google Maps ---
  // Get a key from https://console.cloud.google.com/google/maps-apis
  googleMapsApiKey: ''
};
