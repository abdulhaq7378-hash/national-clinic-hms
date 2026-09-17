import { Schema, model } from 'mongoose';
import { ADMISSION_STATUSES, BED_STATUSES, WARD_TYPES } from '@hms/shared';
import { applyJsonTransform } from './_helpers.js';

const wardSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true },
    type: { type: String, enum: WARD_TYPES, required: true },
    floor: String,
    description: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
applyJsonTransform(wardSchema);
export const Ward = model('Ward', wardSchema, 'wards');

const roomSchema = new Schema(
  {
    ward: { type: Schema.Types.ObjectId, ref: 'Ward', required: true },
    number: { type: String, required: true, trim: true },
    description: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
roomSchema.index({ ward: 1, number: 1 }, { unique: true });
applyJsonTransform(roomSchema);
export const Room = model('Room', roomSchema, 'rooms');

const bedSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    ward: { type: Schema.Types.ObjectId, ref: 'Ward', required: true },
    room: { type: Schema.Types.ObjectId, ref: 'Room' },
    type: { type: String, enum: WARD_TYPES, required: true },
    status: { type: String, enum: BED_STATUSES, default: 'available' },
    currentAdmission: { type: Schema.Types.ObjectId, ref: 'Admission' },
    /** Service whose price is charged per day of stay. */
    dailyService: { type: Schema.Types.ObjectId, ref: 'Service' },
    statusNote: String,
    statusChangedAt: Date,
    notes: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
bedSchema.index({ ward: 1, status: 1 });
applyJsonTransform(bedSchema);
export const Bed = model('Bed', bedSchema, 'beds');

const bedStaySchema = new Schema(
  {
    bed: { type: Schema.Types.ObjectId, ref: 'Bed', required: true },
    bedCode: String,
    from: { type: Date, required: true },
    to: Date,
    reason: String,
  },
  { _id: false },
);

const admissionSchema = new Schema(
  {
    admissionNumber: { type: String, required: true, unique: true },
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    bed: { type: Schema.Types.ObjectId, ref: 'Bed', required: true },
    admittingDoctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    admittedAt: { type: Date, default: Date.now },
    admittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, required: true },
    provisionalDiagnosis: String,
    expectedDischargeDate: String,
    status: { type: String, enum: ADMISSION_STATUSES, default: 'admitted' },
    stays: { type: [bedStaySchema], default: [] },
    dischargedAt: Date,
    dischargedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    dischargeSummary: {
      finalDiagnosis: String,
      treatmentGiven: String,
      conditionAtDischarge: String,
      advice: String,
      followUpDate: String,
    },
  },
  { timestamps: true },
);
admissionSchema.index({ patient: 1, admittedAt: -1 });
admissionSchema.index({ status: 1 });
// A patient can only hold one active admission.
admissionSchema.index(
  { patient: 1 },
  { unique: true, partialFilterExpression: { status: 'admitted' }, name: 'one_active_admission' },
);
applyJsonTransform(admissionSchema);
export const Admission = model('Admission', admissionSchema, 'admissions');
