import { Schema, model } from 'mongoose';
import { LAB_ORDER_STATUSES, PRIORITIES, RESULT_FLAGS, SAMPLE_TYPES } from '@hms/shared';
import { applyJsonTransform, statusHistorySchema } from './_helpers.js';

const parameterSchema = new Schema(
  {
    name: { type: String, required: true },
    unit: String,
    referenceRange: String,
    refLow: Number,
    refHigh: Number,
  },
  { _id: false },
);

const labTestSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    category: String,
    sampleType: { type: String, enum: SAMPLE_TYPES, required: true },
    price: { type: Number, required: true, min: 0 },
    taxRate: { type: Number, default: 0 },
    turnaroundHours: { type: Number, default: 24 },
    parameters: { type: [parameterSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
applyJsonTransform(labTestSchema);

export const LabTest = model('LabTest', labTestSchema, 'lab_tests');

const resultValueSchema = new Schema(
  {
    parameter: { type: String, required: true },
    value: { type: String, required: true },
    unit: String,
    referenceRange: String,
    flag: { type: String, enum: RESULT_FLAGS, default: 'normal' },
  },
  { _id: false },
);

const orderItemSchema = new Schema({
  test: { type: Schema.Types.ObjectId, ref: 'LabTest', required: true },
  testCode: { type: String, required: true },
  testName: { type: String, required: true },
  sampleType: { type: String, required: true },
  /** Snapshot of the catalog parameters at the time of ordering. */
  parameters: { type: [parameterSchema], default: [] },
  results: { type: [resultValueSchema], default: [] },
  remarks: String,
});

const revisionSchema = new Schema(
  {
    items: { type: Schema.Types.Mixed, required: true },
    reason: { type: String, required: true },
    previousStatus: String,
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const labOrderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor' },
    consultation: { type: Schema.Types.ObjectId, ref: 'Consultation' },
    orderedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    priority: { type: String, enum: PRIORITIES, default: 'routine' },
    clinicalNotes: String,
    status: { type: String, enum: LAB_ORDER_STATUSES, default: 'ordered' },
    items: { type: [orderItemSchema], required: true },
    sampleCollectedAt: Date,
    sampleCollectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resultEnteredAt: Date,
    resultEnteredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: Date,
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    releasedAt: Date,
    releasedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Previous result sets, kept whenever results are corrected. */
    revisions: { type: [revisionSchema], default: [] },
    statusHistory: { type: [statusHistorySchema()], default: [] },
  },
  { timestamps: true },
);
labOrderSchema.index({ patient: 1, createdAt: -1 });
labOrderSchema.index({ status: 1, date: -1 });
applyJsonTransform(labOrderSchema);

export const LabOrder = model('LabOrder', labOrderSchema, 'lab_orders');
