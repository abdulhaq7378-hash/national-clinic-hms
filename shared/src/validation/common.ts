import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier');

const blankToNull = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** Optional free text. Blank strings become null so that updates can clear a field. */
export const optionalText = (max = 500) =>
  z.preprocess(blankToNull, z.string().max(max).nullable().optional());

export const requiredText = (max = 200, label = 'This field') =>
  z.string().trim().min(1, `${label} is required`).max(max);

export const optionalObjectId = z.preprocess(blankToNull, objectId.nullable().optional());

export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,13}$/, 'Enter a valid phone number (10 to 13 digits)');

export const optionalPhone = z.preprocess(blankToNull, phone.nullable().optional());

export const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' ? blankToNull(v.toLowerCase()) : v),
  z.email('Enter a valid email address').nullable().optional(),
);

/** Calendar date in YYYY-MM-DD form. */
export const isoDate = z.iso.date('Use the format YYYY-MM-DD');
export const optionalIsoDate = z.preprocess(blankToNull, isoDate.nullable().optional());

export const time24 = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24 hour HH:mm time');

export const money = z.coerce.number().min(0, 'Amount cannot be negative').max(10_000_000);
export const percentage = z.coerce.number().min(0).max(100);

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const dateRangeQuery = z
  .object({
    from: isoDate,
    to: isoDate,
  })
  .refine((v) => v.from <= v.to, { message: 'Start date must be on or before end date', path: ['to'] });

export const reasonBody = z.object({
  reason: requiredText(500, 'Reason'),
});
