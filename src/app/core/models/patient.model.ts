export type Classification = 'MB' | 'PB';

export type DisabilityGrade = '0' | '1' | '2'| '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10';

export type SyncStatus = 'synced' | 'pending' | 'error' | 'local-only';

export interface Patient {
  /** Local UUID. Always present. */
  id: string;
  /** DHIS2 tracked entity instance ID once synced. */
  teiId?: string;
  //registeredAt: Date | string;
  firstName: string;
  lastName: string;
  gender: 'Male' | 'Female' | 'Other';
  dateOfBirth?: string;
  nic?: string;
  age?: number;

  onsetYear: number;
  classification: Classification;
  disabilityGrade: DisabilityGrade;
  phoneNumber?: string;

  orgUnitId: string;
  orgUnitName?: string;

  /** Free-text address for display. */
  address?: string;
  latitude?: number;
  longitude?: number;

  notes?: string;

  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

export interface PatientFilter {
  search?: string;
  onsetYearFrom?: number;
  onsetYearTo?: number;
  classification?: Classification | 'ALL';
  disabilityGrade?: DisabilityGrade | 'ALL';
  syncStatus?: SyncStatus | 'ALL';
}
