import { z } from 'zod';
import { BLOOD_GROUPS, GENDERS, MARITAL_STATUSES, MEDICAL_HISTORY_TYPES } from '../constants.js';
import {
  isoDate,
  optionalEmail,
  optionalPhone,
  optionalText,
  phone,
  requiredText,
  paginationQuery,
  objectId,
} from './common.js';

const addressSchema = z.object({
  line: optionalText(300),
  city: optionalText(80),
  district: optionalText(80),
  state: optionalText(80),
  pincode: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().regex(/^\d{6}$/, 'PIN code must be 6 digits').nullable().optional(),
  ),
});

const emergencyContactSchema = z.object({
  name: optionalText(120),
  relation: optionalText(60),
  phone: optionalPhone,
});

const patientFields = {
  fullName: requiredText(150, 'Full name'),
  dateOfBirth: isoDate.optional(),
  ageYears: z.coerce.number().int().min(0).max(130).optional(),
  gender: z.enum(GENDERS),
  phone,
  alternatePhone: optionalPhone,
  email: optionalEmail,
  address: addressSchema.optional(),
  emergencyContact: emergencyContactSchema.optional(),
  bloodGroup: z.enum(BLOOD_GROUPS),
  maritalStatus: z.enum(MARITAL_STATUSES),
  occupation: optionalText(100),
  guardianName: optionalText(150),
  notes: optionalText(1000),
};

export const patientCreateSchema = z
  .object({
    ...patientFields,
    bloodGroup: patientFields.bloodGroup.default('unknown'),
    maritalStatus: patientFields.maritalStatus.default('unknown'),
  })
  .refine((v) => v.dateOfBirth || v.ageYears !== undefined, {
    message: 'Enter the date of birth or the age',
    path: ['dateOfBirth'],
  });

export const patientUpdateSchema = z.object(patientFields).partial();

export const patientSearchQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
});

export const medicalHistoryCreateSchema = z.object({
  type: z.enum(MEDICAL_HISTORY_TYPES),
  title: requiredText(200, 'Title'),
  details: optionalText(2000),
  severity: z.enum(['mild', 'moderate', 'severe']).nullable().optional(),
  onsetDate: z.preprocess((v) => (v === '' ? null : v), isoDate.nullable().optional()),
});

/** History entries are never edited. A status change or correction creates a new linked entry. */
export const medicalHistoryAmendSchema = z.object({
  status: z.enum(['active', 'resolved', 'entered_in_error']),
  reason: requiredText(500, 'Reason'),
});

export const accessOverrideSchema = z.object({
  patient: objectId,
  reason: requiredText(500, 'Reason'),
});

export type PatientCreateInput = z.infer<typeof patientCreateSchema>;
export type PatientUpdateInput = z.infer<typeof patientUpdateSchema>;
export type MedicalHistoryCreateInput = z.infer<typeof medicalHistoryCreateSchema>;
