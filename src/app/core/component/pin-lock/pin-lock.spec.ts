import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PinLock } from './pin-lock';

describe('PinLock', () => {
  let component: PinLock;
  let fixture: ComponentFixture<PinLock>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PinLock]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PinLock);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
