# Leprosy Patient Management System

An offline-first Angular 21 + PrimeNG app for registering and tracking leprosy
patients, filtering by year of onset and MB/PB classification, mapping
patient locations on Google Maps, and syncing with a DHIS2 tracker program.

## Stack

- **Angular 21** (standalone components, signals, zone-based change detection for PrimeNG compatibility)
- **PrimeNG 21** (Aura theme) for tables, forms, and inputs
- **idb-keyval** (IndexedDB) for local-first patient storage — the app works fully offline
- **@angular/google-maps** for the map view
- **@angular/service-worker** for PWA installability and offline asset caching
- **DHIS2 Tracker API** (`/api/tracker`) for syncing patient records to a DHIS2 instance

## Getting started

```bash
npm install
npm start          # dev server at http://localhost:4200
npm run build:prod # production build with service worker enabled, output in dist/
```

The dev server (`ng serve`) does **not** register the service worker — that's
expected; test PWA/offline behavior against a production build served over
HTTP(S) (e.g. `npx http-server dist/leprosy-pms/browser`).

## Configuration

All configuration lives in `src/environments/environment.ts` (dev) and
`environment.prod.ts` (prod build).

### 1. DHIS2 connection

```ts
dhis2: {
  baseUrl: 'https://your-dhis2-instance.org/api',
  apiToken: '',        // preferred: DHIS2 Personal Access Token
  username: '', password: '', // fallback basic auth, dev only
  programId: '',           // your Leprosy tracker Program UID
  trackedEntityTypeId: '', // "Person" Tracked Entity Type UID
  orgUnitId: '',           // default facility org unit UID
  attributes: {
    firstName: '', lastName: '', onsetYear: '',
    classification: '', disabilityGrade: '', phoneNumber: ''
  }
}
```

**Generating a Personal Access Token:** in DHIS2, go to your user Profile →
Personal Access Tokens → create one, and paste it into `apiToken`. This is
sent as `Authorization: ApiToken <token>` and is safer than embedding a
username/password.

**One-time DHIS2 metadata setup** — you need a Tracker Program with a
Tracked Entity Type ("Person") and Tracked Entity Attributes for the fields
this app collects. If you don't already have these, create them under
Maintenance app → Program, and Maintenance app → Tracked Entity Attribute,
then copy each object's UID into `environment.ts`. The token you referenced
earlier already has the authorities needed to create these
(`F_PROGRAM_PUBLIC_ADD`, `F_TRACKED_ENTITY_ATTRIBUTE_PUBLIC_ADD`,
`F_PROGRAMSTAGE_ADD`, etc.).

### 2. Google Maps

Get a browser API key from the Google Cloud Console (enable the "Maps
JavaScript API"), then set:

```ts
googleMapsApiKey: 'YOUR_KEY_HERE'
```

Until a key is set, the Map view shows a configuration notice instead of a
blank map.

### 3. Service worker data caching

`ngsw-config.json` includes a `dataGroups` entry pointing at
`https://your-dhis2-instance.org/api/**` — update this to match your real
`dhis2.baseUrl` so GET requests are cached for offline reads.

## How offline-first sync works

1. Every save goes to IndexedDB first (`LocalStorageService`) — this always
   succeeds, even with no network.
2. If the browser is online, `PatientService` immediately attempts to push
   that one record to DHIS2 (`Dhis2Service.upsertPatient`).
3. Records are tagged with a `syncStatus`: `local-only` → `pending` → `synced`,
   or `error` if the push failed.
4. The sidebar shows a live online/offline pill and a "Sync N record(s)"
   button when there's unsynced data; clicking it (or coming back online)
   retries every pending record via `PatientService.syncAll()`.
5. `PatientService.pullFromServer()` fetches remote records and merges them
   in, without overwriting any local edits that haven't synced yet.

## Filtering

The Patients list (`/patients`) filters by:
- name / phone search
- year-of-onset range (from/to)
- MB/PB classification
- WHO disability grade (0/1/2)
- sync status

## Project structure

```
src/app/
  core/
    models/patient.model.ts        # Patient, PatientFilter types
    services/
      local-storage.service.ts     # IndexedDB persistence
      dhis2.service.ts             # DHIS2 tracker API mapping
      dhis2-auth.interceptor.ts    # attaches auth headers
      patient.service.ts           # offline-first facade used by components
  features/
    dashboard/       # summary stats + cases-by-year chart
    patient-list/     # filterable PrimeNG table
    patient-form/      # register/edit patient
    patient-map/        # Google Maps view, MB/PB colored markers
  app.component.*     # sidebar shell + online/offline + sync button
```

## Data privacy note

Patient records (name, diagnosis classification, location) are stored
unencrypted in IndexedDB for offline access. If this app will run on shared
or loanable field devices, add an encryption-at-rest layer around
`LocalStorageService` and/or an app-level PIN/biometric lock before shipping
to production.
