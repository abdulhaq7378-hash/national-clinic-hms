import { HOSPITAL_TIMEZONE } from './constants.js';

/** Returns YYYY-MM-DD for the given instant in the hospital timezone. */
export function toHospitalDate(date: Date = new Date(), timeZone: string = HOSPITAL_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Returns HH:mm for the given instant in the hospital timezone. */
export function toHospitalTime(date: Date = new Date(), timeZone: string = HOSPITAL_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Adds days to a YYYY-MM-DD string. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Weekday index (0 = Sunday) of a YYYY-MM-DD string. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Whole years between dob and the reference date. */
export function calculateAge(dob: Date | string, reference: Date = new Date()): number {
  const birth = typeof dob === 'string' ? new Date(dob) : dob;
  let age = reference.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    reference.getMonth() < birth.getMonth() ||
    (reference.getMonth() === birth.getMonth() && reference.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return Math.max(age, 0);
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(value: number | null | undefined, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(value ?? 0);
}

export interface LineAmountInput {
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
}

/**
 * Line calculation used by both invoice preview and server-side totals.
 * Discount is a flat amount on the line; tax is a percentage applied after discount.
 */
export function calculateLine(line: LineAmountInput) {
  const gross = roundMoney(line.quantity * line.unitPrice);
  const discount = roundMoney(Math.min(line.discount ?? 0, gross));
  const taxable = roundMoney(gross - discount);
  const tax = roundMoney((taxable * (line.taxRate ?? 0)) / 100);
  return { gross, discount, taxable, tax, amount: roundMoney(taxable + tax) };
}

export function calculateTotals(lines: LineAmountInput[]) {
  return lines.reduce(
    (acc, line) => {
      const c = calculateLine(line);
      acc.subtotal = roundMoney(acc.subtotal + c.gross);
      acc.discountTotal = roundMoney(acc.discountTotal + c.discount);
      acc.taxTotal = roundMoney(acc.taxTotal + c.tax);
      acc.total = roundMoney(acc.total + c.amount);
      return acc;
    },
    { subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0 },
  );
}

export const FREQUENCY_PATTERN = /^\d+(\.\d+)?-\d+(\.\d+)?-\d+(\.\d+)?(-\d+(\.\d+)?)?$/;

/**
 * Units per day for a frequency written as morning-afternoon-night
 * (for example 1-0-1). Returns null for free-text frequencies such as "SOS".
 */
export function dosesPerDay(frequency: string): number | null {
  const value = frequency.trim();
  if (!FREQUENCY_PATTERN.test(value)) return null;
  return value.split('-').reduce((sum, part) => sum + Number(part), 0);
}

export function durationInDays(value: number, unit: 'days' | 'weeks' | 'months'): number {
  if (unit === 'weeks') return value * 7;
  if (unit === 'months') return value * 30;
  return value;
}

/** Suggested dispensing quantity for a prescription line, or null when it cannot be derived. */
export function suggestQuantity(frequency: string, durationValue: number, durationUnit: 'days' | 'weeks' | 'months') {
  const perDay = dosesPerDay(frequency);
  if (perDay === null || !durationValue) return null;
  return Math.ceil(perDay * durationInDays(durationValue, durationUnit));
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
