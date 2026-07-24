import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Updater } from './updater';

describe('Updater', () => {
  let component: Updater;
  let fixture: ComponentFixture<Updater>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Updater]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Updater);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
