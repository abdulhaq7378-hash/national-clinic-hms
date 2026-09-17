import { escapeRegex } from '@hms/shared';
import { Patient } from '../models/index.js';
import { skipFor } from '../utils/http.js';

export const PATIENT_LIST_FIELDS = 'uhid fullName dateOfBirth dobEstimated gender phone alternatePhone bloodGroup createdAt isActive';

/**
 * Builds a filter for the reception search box. Supports UHID, phone number
 * (prefix) and name (prefix match on every word, in any order).
 */
export function buildPatientSearchFilter(q?: string): Record<string, unknown> {
  const term = q?.trim();
  if (!term) return {};
  if (/^nc-/i.test(term)) {
    return { uhid: { $regex: `^${escapeRegex(term.toUpperCase())}` } };
  }
  const digits = term.replace(/[\s+-]/g, '');
  if (/^\d{3,}$/.test(digits)) {
    const pattern = { $regex: `^(\\+?91)?${escapeRegex(digits.replace(/^(\+?91)(?=\d{10}$)/, ''))}` };
    return { $or: [{ phone: pattern }, { alternatePhone: pattern }] };
  }
  const words = term
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .slice(0, 5);
  if (!words.length) return { _id: null };
  return { $and: words.map((w) => ({ nameTokens: { $regex: `^${escapeRegex(w)}` } })) };
}

export async function searchPatients(q: string | undefined, page: number, limit: number) {
  const filter = buildPatientSearchFilter(q);
  const [items, total] = await Promise.all([
    Patient.find(filter)
      .select(PATIENT_LIST_FIELDS)
      .sort({ createdAt: -1 })
      .skip(skipFor(page, limit))
      .limit(limit),
    Patient.countDocuments(filter),
  ]);
  return { items, total };
}
