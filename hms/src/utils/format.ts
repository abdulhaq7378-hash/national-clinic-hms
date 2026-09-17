import { HOSPITAL_TIMEZONE, calculateAge, formatCurrency, formatEnum } from '@hms/shared';

export { formatEnum };

export function money(value: number | null | undefined) {
  return formatCurrency(value ?? 0);
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: HOSPITAL_TIMEZONE, day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: HOSPITAL_TIMEZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});
const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: HOSPITAL_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: true });

/** Formats an instant, or a YYYY-MM-DD calendar date, as "17 Sept 2026". */
export function fmtDate(value: string | Date | null | undefined) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return dateFmt.format(new Date(`${value}T12:00:00+05:30`));
  }
  return dateFmt.format(new Date(value));
}

export function fmtDateTime(value: string | Date | null | undefined) {
  return value ? dateTimeFmt.format(new Date(value)) : '';
}

export function fmtTime(value: string | Date | null | undefined) {
  return value ? timeFmt.format(new Date(value)) : '';
}

/** "14:30" to "2:30 pm" */
export function fmtClock(hhmm: string | null | undefined) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function ageLabel(patient: { dateOfBirth?: string | null; age?: number | null; dobEstimated?: boolean } | null | undefined) {
  if (!patient) return '';
  const age = patient.age ?? (patient.dateOfBirth ? calculateAge(patient.dateOfBirth) : null);
  if (age === null || age === undefined) return '';
  return `${age} y${patient.dobEstimated ? ' (approx.)' : ''}`;
}

export function genderShort(gender?: string | null) {
  return gender ? gender.charAt(0).toUpperCase() : '';
}

export function patientLine(p: { gender?: string; dateOfBirth?: string; age?: number | null; dobEstimated?: boolean } | null | undefined) {
  if (!p) return '';
  return [ageLabel(p), p.gender ? formatEnum(p.gender) : ''].filter(Boolean).join(', ');
}

export function doctorName(doctor: { user?: { name?: string } | null } | null | undefined) {
  const name = doctor?.user?.name;
  return name ? `Dr. ${name.replace(/^dr\.?\s+/i, '')}` : '';
}

export function userName(user: { name?: string } | null | undefined) {
  return user?.name ?? '';
}

export function idOf(entity: { id?: string; _id?: string } | string | null | undefined): string {
  if (!entity) return '';
  if (typeof entity === 'string') return entity;
  return entity.id ?? entity._id ?? '';
}

export function vitalsSummary(v: Record<string, number | undefined> | null | undefined) {
  if (!v) return '';
  const parts: string[] = [];
  if (v.systolic && v.diastolic) parts.push(`BP ${v.systolic}/${v.diastolic}`);
  if (v.pulse) parts.push(`Pulse ${v.pulse}`);
  if (v.temperatureC) parts.push(`Temp ${v.temperatureC} °C`);
  if (v.spo2) parts.push(`SpO2 ${v.spo2}%`);
  if (v.respiratoryRate) parts.push(`RR ${v.respiratoryRate}`);
  if (v.weightKg) parts.push(`Wt ${v.weightKg} kg`);
  if (v.heightCm) parts.push(`Ht ${v.heightCm} cm`);
  if (v.bmi) parts.push(`BMI ${v.bmi}`);
  if (v.bloodSugar) parts.push(`Sugar ${v.bloodSugar} mg/dL`);
  return parts.join(' · ');
}
