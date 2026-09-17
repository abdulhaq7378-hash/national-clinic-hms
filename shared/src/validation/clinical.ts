import { z } from 'zod';
import {
  DIAGNOSIS_TYPES,
  DURATION_UNITS,
  MEDICINE_FORMS,
  MEDICINE_ROUTES,
  PRIORITIES,
  REFERRAL_STATUSES,
} from '../constants.js';
import {
  isoDate,
  objectId,
  optionalIsoDate,
  optionalObjectId,
  optionalText,
  paginationQuery,
  requiredText,
} from './common.js';

const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.coerce.number().min(min).max(max).optional(),
  );

export const vitalsSchema = z.object({
  systolic: optionalNumber(40, 300),
  diastolic: optionalNumber(20, 200),
  pulse: optionalNumber(20, 250),
  temperatureC: optionalNumber(30, 45),
  spo2: optionalNumber(40, 100),
  respiratoryRate: optionalNumber(4, 80),
  weightKg: optionalNumber(0.3, 400),
  heightCm: optionalNumber(20, 250),
  bloodSugar: optionalNumber(10, 1000),
});

export const diagnosisSchema = z.object({
  description: requiredText(300, 'Diagnosis'),
  code: optionalText(20),
  type: z.enum(DIAGNOSIS_TYPES).default('provisional'),
});

export const consultationStartSchema = z
  .object({
    token: optionalObjectId,
    appointment: optionalObjectId,
    patient: optionalObjectId,
  })
  .refine((v) => v.token || v.appointment || v.patient, {
    message: 'A token, appointment or patient is required',
    path: ['patient'],
  });

export const consultationUpdateSchema = z.object({
  chiefComplaint: optionalText(500),
  symptoms: z.array(requiredText(200, 'Symptom')).max(30).optional(),
  historyOfPresentIllness: optionalText(3000),
  vitals: vitalsSchema.optional(),
  examination: optionalText(3000),
  diagnoses: z.array(diagnosisSchema).max(20).optional(),
  clinicalNotes: optionalText(5000),
  treatmentPlan: optionalText(3000),
  advice: optionalText(2000),
  followUpDate: optionalIsoDate,
});

export const consultationAddendumSchema = z.object({
  text: requiredText(3000, 'Addendum'),
});

export const consultationListQuery = paginationQuery.extend({
  patient: objectId.optional(),
  doctor: objectId.optional(),
  status: z.enum(['draft', 'completed']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  mine: z.enum(['true', 'false']).optional(),
});

export const prescriptionItemSchema = z.object({
  medicine: optionalObjectId,
  medicineName: requiredText(150, 'Medicine name'),
  strength: optionalText(60),
  form: z.enum(MEDICINE_FORMS).default('tablet'),
  dose: optionalText(60),
  frequency: requiredText(40, 'Frequency'),
  timing: z.enum(['before_food', 'after_food', 'with_food', 'empty_stomach', 'bedtime', 'as_needed', 'any']).default('after_food'),
  durationValue: z.coerce.number().int().min(1).max(365),
  durationUnit: z.enum(DURATION_UNITS).default('days'),
  route: z.enum(MEDICINE_ROUTES).default('oral'),
  instructions: optionalText(300),
  quantity: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.coerce.number().int().min(1).max(10000).optional(),
  ),
});

export const prescriptionCreateSchema = z.object({
  consultation: objectId,
  items: z.array(prescriptionItemSchema).min(1, 'Add at least one medicine').max(30),
  notes: optionalText(1000),
});

export const prescriptionListQuery = paginationQuery.extend({
  patient: objectId.optional(),
  doctor: objectId.optional(),
  status: z.enum(['active', 'partially_dispensed', 'dispensed', 'cancelled']).optional(),
  pending: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(60).optional(),
});

export const referralCreateSchema = z.object({
  patient: objectId,
  consultation: optionalObjectId,
  referredToDoctor: optionalText(150),
  specialty: requiredText(120, 'Specialty'),
  hospital: optionalText(200),
  reason: requiredText(1000, 'Reason'),
  clinicalNotes: optionalText(3000),
  referralDate: isoDate,
  priority: z.enum(PRIORITIES).default('routine'),
});

export const referralStatusSchema = z.object({
  status: z.enum(REFERRAL_STATUSES),
  note: optionalText(500),
});

export const referralListQuery = paginationQuery.extend({
  patient: objectId.optional(),
  status: z.enum(REFERRAL_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
});

export type VitalsInput = z.infer<typeof vitalsSchema>;
export type ConsultationUpdateInput = z.infer<typeof consultationUpdateSchema>;
export type PrescriptionItemInput = z.infer<typeof prescriptionItemSchema>;
export type PrescriptionCreateInput = z.infer<typeof prescriptionCreateSchema>;
export type ReferralCreateInput = z.infer<typeof referralCreateSchema>;
