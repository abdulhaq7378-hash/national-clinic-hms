import { Schema, model } from 'mongoose';
import {
  CONSULTATION_STATUSES,
  DIAGNOSIS_TYPES,
  DURATION_UNITS,
  MEDICINE_FORMS,
  MEDICINE_ROUTES,
  PRESCRIPTION_STATUSES,
  PRIORITIES,
  REFERRAL_STATUSES,
} from '@hms/shared';
import { applyJsonTransform, statusHistorySchema } from './_helpers.js';
import { vitalsSchema } from './appointment.model.js';

const diagnosisSchema = new Schema(
  {
    description: { type: String, required: true },
    code: String,
    type: { type: String, enum: DIAGNOSIS_TYPES, default: 'provisional' },
  },
  { _id: false },
);

const addendumSchema = new Schema(
  {
    text: { type: String, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

/**
 * A consultation is editable while in draft. Once completed it is locked and
 * further information can only be appended as an addendum.
 */
const consultationSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    appointment: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    token: { type: Schema.Types.ObjectId, ref: 'Token' },
    status: { type: String, enum: CONSULTATION_STATUSES, default: 'draft' },
    date: { type: String, required: true },
    chiefComplaint: String,
    symptoms: { type: [String], default: [] },
    historyOfPresentIllness: String,
    vitals: { type: vitalsSchema() },
    examination: String,
    diagnoses: { type: [diagnosisSchema], default: [] },
    clinicalNotes: String,
    treatmentPlan: String,
    advice: String,
    followUpDate: String,
    completedAt: Date,
    addenda: { type: [addendumSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
consultationSchema.index({ patient: 1, createdAt: -1 });
consultationSchema.index({ doctor: 1, date: -1 });
consultationSchema.index({ token: 1 }, { unique: true, partialFilterExpression: { token: { $type: 'objectId' } } });
applyJsonTransform(consultationSchema);

export const Consultation = model('Consultation', consultationSchema, 'consultations');

const prescriptionItemSchema = new Schema({
  medicine: { type: Schema.Types.ObjectId, ref: 'Medicine' },
  medicineName: { type: String, required: true },
  strength: String,
  form: { type: String, enum: MEDICINE_FORMS, default: 'tablet' },
  dose: String,
  frequency: { type: String, required: true },
  timing: String,
  durationValue: { type: Number, required: true },
  durationUnit: { type: String, enum: DURATION_UNITS, default: 'days' },
  route: { type: String, enum: MEDICINE_ROUTES, default: 'oral' },
  instructions: String,
  quantity: Number,
  dispensedQuantity: { type: Number, default: 0 },
});

const prescriptionSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    consultation: { type: Schema.Types.ObjectId, ref: 'Consultation', required: true },
    date: { type: String, required: true },
    items: { type: [prescriptionItemSchema], required: true },
    notes: String,
    status: { type: String, enum: PRESCRIPTION_STATUSES, default: 'active' },
    statusHistory: { type: [statusHistorySchema()], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
prescriptionSchema.index({ patient: 1, createdAt: -1 });
prescriptionSchema.index({ status: 1, date: -1 });
prescriptionSchema.index({ consultation: 1 });
applyJsonTransform(prescriptionSchema);

export const Prescription = model('Prescription', prescriptionSchema, 'prescriptions');

const referralSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    referringDoctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    consultation: { type: Schema.Types.ObjectId, ref: 'Consultation' },
    referredToDoctor: String,
    specialty: { type: String, required: true },
    hospital: String,
    reason: { type: String, required: true },
    clinicalNotes: String,
    referralDate: { type: String, required: true },
    priority: { type: String, enum: PRIORITIES, default: 'routine' },
    status: { type: String, enum: REFERRAL_STATUSES, default: 'created' },
    statusHistory: { type: [statusHistorySchema()], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
referralSchema.index({ patient: 1, createdAt: -1 });
referralSchema.index({ status: 1, referralDate: -1 });
applyJsonTransform(referralSchema);

export const Referral = model('Referral', referralSchema, 'referrals');
