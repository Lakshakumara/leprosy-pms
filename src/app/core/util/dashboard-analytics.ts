import { Patient } from '../services/patient.model';

export interface CountRow {
  label: string;
  count: number;
  pct: number;
  id?: string;
}

export interface YearTrend {
  year: number;
  count: number;
  pct: number;
  mb: number;
  pb: number;
}

export interface DashboardAlert {
  severity: 'high' | 'medium' | 'info';
  icon: string;
  title: string;
  detail: string;
  count: number;
  actionLabel: string;
  queryParams: Record<string, string>;
}

export interface ProgramIndicators {
  mbPbRatio: string;
  grade2Rate: number;
  contactHistoryRate: number;
  completionRate: number;
  childCaseRate: number;
  delayedDiagnosisRate: number;
  deformityRate: number;
}

export function yearOf(enrolledAt: string | undefined | null): number | null {
  if (!enrolledAt || enrolledAt.length < 4) return null;
  const year = Number(enrolledAt.slice(0, 4));
  return Number.isNaN(year) ? null : year;
}

export function isMb(p: Patient): boolean {
  return p.treatmentClassification?.trim().toUpperCase().startsWith('MB') ?? false;
}

export function isPb(p: Patient): boolean {
  return p.treatmentClassification?.trim().toUpperCase().startsWith('PB') ?? false;
}

export function isChildCase(p: Patient): boolean {
  const age = Number(p.patientAge);
  return !Number.isNaN(age) && age < 15;
}

export function hasGrade2Disability(p: Patient): boolean {
  return p.disabilityAtDiagnosis === '3';
}

export function hasDelayedDiagnosis(p: Patient): boolean {
  const months = Number(p.timeSinceOnsetMonths);
  return !Number.isNaN(months) && months > 12;
}

export function hasDeformity(p: Patient): boolean {
  return (
    !!p.clawHand ||
    !!p.footDrop ||
    !!p.footUlcer ||
    !!p.eyeInvolvement ||
    !!p.faceInvolvement
  );
}

export function isRelapse(p: Patient): boolean {
  return (p.caseType === 'Relapse');
}

export function isDefaulter(p: Patient): boolean {
  const v = (p.defaulterRestartingTreatment ?? '').trim().toLowerCase();
  return v === 'yes' || v === 'true' || v === '1';
}
export function isContactHistory(p: Patient): boolean {
  return (p.contactHistory === false);
}
export function countByField(
  patients: Patient[],
  getKey: (p: Patient) => string,
  getId?: (p: Patient) => string,
  limit = 10
): CountRow[] {
  if (!patients.length) return [];
  const map = new Map<string, { count: number; id?: string }>();
  for (const p of patients) {
    const label = getKey(p) || '(not recorded)';
    const existing = map.get(label) ?? { count: 0, id: getId?.(p) };
    existing.count += 1;
    map.set(label, existing);
  }
  const total = patients.length;
  return [...map.entries()]
    .map(([label, { count, id }]) => ({
      label,
      count,
      pct: Math.round((count / total) * 100),
      id,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function enrollmentTrend(patients: Patient[]): YearTrend[] {
  if (!patients.length) return [];
  const map = new Map<number, { count: number; mb: number; pb: number }>();
  for (const p of patients) {
    const year = yearOf(p.enrolledAt);
    if (year == null) continue;
    const row = map.get(year) ?? { count: 0, mb: 0, pb: 0 };
    row.count += 1;
    if (isMb(p)) row.mb += 1;
    if (isPb(p)) row.pb += 1;
    map.set(year, row);
  }
  const max = Math.max(1, ...[...map.values()].map(v => v.count));
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, { count, mb, pb }]) => ({
      year,
      count,
      mb,
      pb,
      pct: Math.round((count / max) * 100),
    }));
}

export function deformityDistribution(patients: Patient[]): CountRow[] {
  const groups = [
    { label: 'Grade 2', value: '3'},
    { label: 'Grade 1', value: '2'},
    { label: 'Grade 0', value: '1'},
  ];
  const total = patients.length;
  return groups.map(g => {
    const count = patients.filter(p => p.disabilityAtDiagnosis === g.value).length;
    return { label: g.label, count, pct: Math.round((count / total) * 100) };
  });
}

export function programIndicators(patients: Patient[]): ProgramIndicators {
  const total = patients.length || 1;
  const mb = patients.filter(isMb).length;
  const pb = patients.filter(isPb).length;
  const grade2 = patients.filter(hasGrade2Disability).length;
  const contactHistory = patients.filter(p => p.contactHistory).length;
  const completed = patients.filter(p => p.enrollmentStatus === 'COMPLETED').length;
  const children = patients.filter(isChildCase).length;
  const delayed = patients.filter(hasDelayedDiagnosis).length;
  const deformity = patients.filter(hasDeformity).length;

  return {
    mbPbRatio: pb > 0 ? (mb / pb).toFixed(1) : mb > 0 ? `${mb}:0` : '—',
    grade2Rate: Math.round((grade2 / total) * 100),
    contactHistoryRate: Math.round((contactHistory / total) * 100),
    completionRate: Math.round((completed / total) * 100),
    childCaseRate: Math.round((children / total) * 100),
    delayedDiagnosisRate: Math.round((delayed / total) * 100),
    deformityRate: Math.round((deformity / total) * 100),
  };
}

export function buildAlerts(patients: Patient[]): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  const mbHotspots = countByField(
    patients.filter(isMb),
    p => p.patientMohArea || '(not recorded)',
    undefined,
    20
  ).filter(r => r.count >= 2);

  if (mbHotspots.length) {
    const top = mbHotspots[0];
    alerts.push({
      severity: 'high',
      icon: 'pi-search',
      title: 'Intensify contact tracing',
      detail: `${top.label} has ${top.pct}% MB case(s) — prioritise household/contact screening.`,
      count: top.count,//mbHotspots.reduce((s, r) => s + r.count, 0),
      actionLabel: 'View MB cases',
      queryParams: { classification: 'MB (>5 lesions)', mohArea: top.label === '(not recorded)' ? '' : top.label },
    });
  }

  const grade2 = patients.filter(hasGrade2Disability);
  if (grade2.length) {
    alerts.push({
      severity: 'high',
      icon: 'pi-exclamation-triangle',
      title: 'Prevention of disability follow-up',
      detail: `${grade2.length} patient(s) with Grade 2+ disability (EHF ≥ 4) need POD review and self-care support.`,
      count: grade2.length,
      actionLabel: 'Review cases',
      queryParams: { alert: 'grade2' },
    });
  }

  const relapses = patients.filter(isRelapse);
  if (relapses.length) {
    alerts.push({
      severity: 'high',
      icon: 'pi-replay',
      title: 'Relapse cases',
      detail: `${relapses.length} relapse case(s) require treatment review and MDT regimen check.`,
      count: relapses.length,
      actionLabel: 'View relapses',
      queryParams: { alert: 'relapse' },
    });
  }

  const defaulters = patients.filter(isDefaulter);
  if (defaulters.length) {
    alerts.push({
      severity: 'medium',
      icon: 'pi-clock',
      title: 'Defaulters restarting treatment',
      detail: `${defaulters.length} patient(s) restarted after defaulting — track adherence closely.`,
      count: defaulters.length,
      actionLabel: 'View defaulters',
      queryParams: { alert: 'defaulter' },
    });
  }

  const noContact = patients.filter(isContactHistory);
  if (noContact.length) {
    alerts.push({
      severity: 'medium',
      icon: 'pi-users',
      title: 'Contact History not found',
      detail: `${noContact.length} case(s) without documented contact history — complete field investigation.`,
      count: noContact.length,
      actionLabel: 'View cases',
      queryParams: { alert: 'noContact' },
    });
  }

  const delayed = patients.filter(hasDelayedDiagnosis);
  if (delayed.length) {
    alerts.push({
      severity: 'medium',
      icon: 'pi-calendar-times',
      title: 'Delayed diagnosis',
      detail: `${delayed.length} case(s) with symptom onset > 12 months — strengthen passive/active case finding.`,
      count: delayed.length,
      actionLabel: 'View delayed',
      queryParams: { alert: 'delayed' },
    });
  }

  const children = patients.filter(isChildCase);
  if (children.length) {
    alerts.push({
      severity: 'info',
      icon: 'pi-heart',
      title: 'Paediatric cases',
      detail: `${children.length} child case(s) (< 15 years) — ensure family contact examination.`,
      count: children.length,
      actionLabel: 'View child cases',
      queryParams: { alert: 'child' },
    });
  }

  return alerts.sort((a, b) => {
    const rank = { high: 0, medium: 1, info: 2 };
    return rank[a.severity] - rank[b.severity];
  });
}
