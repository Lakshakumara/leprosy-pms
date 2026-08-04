import { TestBed } from '@angular/core/testing';

import { VisitSynch } from './visit-synch';

describe('VisitSynch', () => {
  let service: VisitSynch;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VisitSynch);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
