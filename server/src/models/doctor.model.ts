import { Schema, model } from 'mongoose';
import { WEEKDAYS } from '@hms/shared';
import { applyJsonTransform } from './_helpers.js';

const availabilitySchema = new Schema(
  {
    day: { type: String, enum: WEEKDAYS, required: true },
    start: { type: String, required: true },
    end: { type: String, required: true },
  },
  { _id: false },
);

/** Clinical profile for a user with the doctor role. Name and contact live on the user. */
const doctorSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    specialization: { type: String, required: true, trim: true },
    qualification: { type: String, trim: true },
    registrationNumber: { type: String, trim: true },
    department: { type: String, trim: true },
    consultationService: { type: Schema.Types.ObjectId, ref: 'Service' },
    followUpService: { type: Schema.Types.ObjectId, ref: 'Service' },
    slotMinutes: { type: Number, default: 15, min: 5, max: 120 },
    availability: { type: [availabilitySchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
applyJsonTransform(doctorSchema);

export const Doctor = model('Doctor', doctorSchema, 'doctors');
