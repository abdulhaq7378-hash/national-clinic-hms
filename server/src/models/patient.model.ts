import { Schema, model } from 'mongoose';
import { BLOOD_GROUPS, GENDERS, MARITAL_STATUSES, MEDICAL_HISTORY_TYPES } from '@hms/shared';
import { applyJsonTransform } from './_helpers.js';

const patientSchema = new Schema(
  {
    uhid: { type: String, required: true, unique: true },
    fullName: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date, required: true },
    dobEstimated: { type: Boolean, default: false },
    gender: { type: String, enum: GENDERS, required: true },
    phone: { type: String, required: true, trim: true },
    alternatePhone: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    address: {
      line: String,
      city: String,
      district: String,
      state: String,
      pincode: String,
    },
    emergencyContact: {
      name: String,
      relation: String,
      phone: String,
    },
    bloodGroup: { type: String, enum: BLOOD_GROUPS, default: 'unknown' },
    maritalStatus: { type: String, enum: MARITAL_STATUSES, default: 'unknown' },
    occupation: String,
    guardianName: String,
    notes: String,
    isActive: { type: Boolean, default: true },
    registeredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Lowercase name words, maintained on save, so prefix search on any word can use an index. */
    nameTokens: { type: [String], default: [], select: false },
  },
  { timestamps: true },
);
patientSchema.pre('validate', function () {
  this.nameTokens = this.fullName
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
});
patientSchema.index({ phone: 1 });
patientSchema.index({ alternatePhone: 1 }, { sparse: true });
patientSchema.index({ nameTokens: 1 });
patientSchema.index({ createdAt: -1 });
applyJsonTransform(patientSchema, ['nameTokens']);

export const Patient = model('Patient', patientSchema, 'patients');

const historyAmendmentSchema = new Schema(
  {
    status: { type: String, required: true },
    reason: { type: String, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

/**
 * Chronological medical history. Entries are never edited or deleted:
 * status changes are appended to `amendments` together with the reason.
 */
const medicalHistorySchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    type: { type: String, enum: MEDICAL_HISTORY_TYPES, required: true },
    title: { type: String, required: true, trim: true },
    details: String,
    severity: { type: String, enum: ['mild', 'moderate', 'severe', null] },
    onsetDate: String,
    status: { type: String, enum: ['active', 'resolved', 'entered_in_error'], default: 'active' },
    source: {
      kind: { type: String, enum: ['manual', 'consultation', 'admission'], default: 'manual' },
      id: { type: Schema.Types.ObjectId },
    },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amendments: { type: [historyAmendmentSchema], default: [] },
  },
  { timestamps: true },
);
medicalHistorySchema.index({ patient: 1, createdAt: -1 });
applyJsonTransform(medicalHistorySchema);

export const MedicalHistory = model('MedicalHistory', medicalHistorySchema, 'medical_history');
