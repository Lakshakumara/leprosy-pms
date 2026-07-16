import { Routes } from '@angular/router';
export const routes: Routes = [
    { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
  },
  {
    path: 'patients',
    loadComponent: () =>
      import('./features/patient-list/patient-list.component').then(m => m.PatientListComponent),
  },
  {
    path: 'patients/:id',
    loadComponent: () =>
      import('./features/patient-detail/patient-detail.component').then(m => m.PatientDetailComponent),
  },
  {
    path: 'map',
    loadComponent: () =>
      import('./features/patient-map/patient-map.component').then(m => m.PatientMapComponent),
  },
  { path: '**', redirectTo: 'dashboard' },
];