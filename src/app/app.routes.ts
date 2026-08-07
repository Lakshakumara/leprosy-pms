import { Router, Routes, CanActivateFn } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { inject } from '@angular/core';
import { CryptoService } from './core/services/crypto.service';

const pinGuard: CanActivateFn = () => {
  const crypto = inject(CryptoService);
  const router = inject(Router);
  return crypto.isUnlocked()? true : router.createUrlTree(['/lock']);
};

export const routes: Routes = [
  // 1. Always public
  {
    path: 'lock',
    loadComponent: () => import('./core/component/pin-lock/pin-lock').then(m => m.PinLockComponent)
  },
  {
    path: 'login',
    canActivate: [pinGuard], // must unlock device first, then login
    loadComponent: () =>
      import('./features/login/login.component').then(m => m.LoginComponent),
  },

  // 2. Protected - need BOTH PIN + Login
  {
    path: 'dashboard',
    canActivate: [pinGuard, authGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
  },
  {
    path: 'patients',
    canActivate: [pinGuard, authGuard],
    loadComponent: () =>
      import('./features/patient-list/patient-list.component').then(m => m.PatientListComponent),
  },
  {
    path: 'patients/:id',
    canActivate: [pinGuard, authGuard],
    loadComponent: () =>
      import('./features/patient-detail/patient-detail.component').then(m => m.PatientDetailComponent),
  },
  {
    path: 'new',
    canActivate: [pinGuard, authGuard],
    loadComponent: () =>
      import('./features/patient-form/patient-form.component').then(m => m.PatientFormComponent),
  },
  {
    path: 'update/:id',
    canActivate: [pinGuard, authGuard],
    loadComponent: () =>
      import('./features/updater/updater').then(m => m.PatientUpdateComponent),
  },
  {
    path: 'update/:id/:field',
    canActivate: [pinGuard, authGuard],
    loadComponent: () =>
      import('./features/updater/updater').then(m => m.PatientUpdateComponent),
  },
  {
    path: 'map',
    canActivate: [pinGuard, authGuard],
    loadComponent: () =>
      import('./features/patient-map/patient-map.component').then(m => m.PatientMapComponent),
  },
  {
    path: 'visits/:patientId/:visitNumber',
    canActivate: [pinGuard, authGuard],
    loadComponent: () =>
      import('./features/visits/visits').then(m => m.VisitFormComponent),
  },
  {
    path: 'clinicVisit',
    canActivate: [pinGuard, authGuard],
    loadComponent: () =>
      import('./features/clinic-visit/clinic-visit').then(m => m.ClinicVisitComponent),
  },

  // 3. Default redirects - must be LAST
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: '**', redirectTo: 'dashboard' },
];