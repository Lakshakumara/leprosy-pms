import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  // Unauthenticated
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login.component').then(m => m.LoginComponent),
  },

  // Authenticated — all routes below require a valid session
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
  },
  {
    path: 'patients',
    //canActivate: [authGuard],
    loadComponent: () =>
      import('./features/patient-list/patient-list.component').then(m => m.PatientListComponent),
  },
  {
    path: 'patients/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/patient-detail/patient-detail.component').then(m => m.PatientDetailComponent),
  },

  {
    path: 'new',
    //canActivate: [authGuard],
    loadComponent: () =>
      import('./features/patient-form/patient-form.component').then(m => m.PatientFormComponent),
  },
  {
    path: 'map',
    //canActivate: [authGuard],
    loadComponent: () =>
      import('./features/patient-map/patient-map.component').then(m => m.PatientMapComponent),
  },

  // Default redirects
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: '**', redirectTo: 'dashboard' },
];