import { Schema, model } from 'mongoose';
import {
  APPOINTMENT_SOURCES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  PRIORITIES,
  TOKEN_STATUSES,
  VISIT_TYPES,
} from '@hms/shared';
import { applyJsonTransform, statusHistorySchema } from './_helpers.js';

const appointmentSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    /** Calendar date in the hospital timezone (YYYY-MM-DD). */
    date: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    startMinutes: { type: Number, required: true },
    endMinutes: { type: Number, required: true },
    type: { type: String, enum: APPOINTMENT_TYPES, default: 'new' },
    source: { type: String, enum: APPOINTMENT_SOURCES, default: 'reception' },
    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'scheduled' },
    /** True while the appointment holds its slot. Backs the double-booking unique index. */
    holdsSlot: { type: Boolean, default: true },
    notes: String,
    token: { type: Schema.Types.ObjectId, ref: 'Token' },
    consultation: { type: Schema.Types.ObjectId, ref: 'Consultation' },
    statusHistory: { type: [statusHistorySchema()], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
appointmentSchema.index(
  { doctor: 1, date: 1, startTime: 1 },
  { unique: true, partialFilterExpression: { holdsSlot: true }, name: 'unique_active_slot' },
);
appointmentSchema.index({ date: 1, status: 1 });
appointmentSchema.index({ patient: 1, date: -1 });
applyJsonTransform(appointmentSchema);

export const Appointment = model('Appointment', appointmentSchema, 'appointments');

const vitalsDefinition = {
  systolic: Number,
  diastolic: Number,
  pulse: Number,
  temperatureC: Number,
  spo2: Number,
  respiratoryRate: Number,
  weightKg: Number,
  heightCm: Number,
  bmi: Number,
  bloodSugar: Number,
};

export function vitalsSchema() {
  return new Schema(vitalsDefinition, { _id: false });
}

/** An OPD visit in the reception queue. */
const tokenSchema = new Schema(
  {
    date: { type: String, required: true },
    session: { type: String },
    /** Counter scope, for example "2026-09-17" or "2026-09-17:Morning:<doctorId>". */
    sequenceKey: { type: String, required: true },
    number: { type: Number, required: true },
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    appointment: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    visitType: { type: String, enum: VISIT_TYPES, required: true },
    priority: { type: String, enum: PRIORITIES, default: 'routine' },
    status: { type: String, enum: TOKEN_STATUSES, default: 'waiting' },
    checkedInAt: { type: Date, default: Date.now },
    calledAt: Date,
    completedAt: Date,
    consultation: { type: Schema.Types.ObjectId, ref: 'Consultation' },
    vitals: { type: vitalsSchema() },
    vitalsRecordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    vitalsRecordedAt: Date,
    notes: String,
    statusHistory: { type: [statusHistorySchema()], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
tokenSchema.index({ sequenceKey: 1, number: 1 }, { unique: true });
tokenSchema.index({ date: 1, doctor: 1, status: 1 });
tokenSchema.index({ patient: 1, date: -1 });
tokenSchema.index(
  { appointment: 1 },
  { unique: true, partialFilterExpression: { appointment: { $type: 'objectId' } } },
);
applyJsonTransform(tokenSchema);

export const Token = model('Token', tokenSchema, 'tokens');
