import { Schema, model } from 'mongoose';
import { OT_STATUSES, PRIORITIES } from '@hms/shared';
import { applyJsonTransform, statusHistorySchema } from './_helpers.js';

const otBookingSchema = new Schema(
  {
    bookingNumber: { type: String, required: true, unique: true },
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    admission: { type: Schema.Types.ObjectId, ref: 'Admission' },
    procedureName: { type: String, required: true },
    surgeon: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    assistant: String,
    anaesthetist: String,
    anaesthesiaType: String,
    theatre: { type: String, required: true },
    scheduledStart: { type: Date, required: true },
    scheduledEnd: { type: Date, required: true },
    estimatedMinutes: { type: Number, required: true },
    priority: { type: String, enum: PRIORITIES, default: 'routine' },
    status: { type: String, enum: OT_STATUSES, default: 'scheduled' },
    preOpNotes: String,
    postOpNotes: String,
    actualStart: Date,
    actualEnd: Date,
    statusHistory: { type: [statusHistorySchema()], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
otBookingSchema.index({ theatre: 1, scheduledStart: 1 });
otBookingSchema.index({ surgeon: 1, scheduledStart: 1 });
otBookingSchema.index({ patient: 1, scheduledStart: -1 });
applyJsonTransform(otBookingSchema);

export const OtBooking = model('OtBooking', otBookingSchema, 'ot_schedules');
