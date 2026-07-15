import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'patients' },
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent)
  },
  {
    path: 'patients',
    loadComponent: () => import('./features/patient-list/patient-list.component').then((m) => m.PatientListComponent)
  },
  {
    path: 'patients/new',
    loadComponent: () => import('./features/patient-form/patient-form.component').then((m) => m.PatientFormComponent)
  },
  {
    path: 'patients/:id',
    loadComponent: () => import('./features/patient-form/patient-form.component').then((m) => m.PatientFormComponent)
  },
  {
    path: 'map',
    loadComponent: () => import('./features/patient-map/patient-map.component').then((m) => m.PatientMapComponent)
  },
  { path: '**', redirectTo: 'patients' }
];
