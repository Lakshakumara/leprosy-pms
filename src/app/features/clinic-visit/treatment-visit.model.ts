// clinic-visit.model.ts
export interface TreatmentVisit {
  id: string;
  patientId: string;
  visitDate: string;
  monthNumber: number;
  isCompleted: boolean;
  notes?: string;
}

export interface TreatmentStatus {
  alcNumber: string;
  patientName: string;
  patientId: string;
  treatmentType: 'PB' | 'MB';
  mdtStartDate: string;
  totalMonths: 6 | 12 | 24 | 36;
  currentMonth: number;
  visits: TreatmentVisit[];
  lastVisitDate?: string;
  missedVisits: number;
  isDefaulted: boolean;
  isAtRisk: boolean;
  status: 'ACTIVE' | 'COMPLETED' | 'AT_RISK' | 'DEFAULTER';
}