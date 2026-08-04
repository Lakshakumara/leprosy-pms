import { TestBed } from '@angular/core/testing';

import { PatientTracker } from './patient-tracker';

describe('PatientTracker', () => {
  let service: PatientTracker;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PatientTracker);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
