import { Schema, model } from 'mongoose';
import { ROLES } from '@hms/shared';
import { applyJsonTransform } from './_helpers.js';

/* ------------------------------- Audit log ------------------------------- */

const auditLogSchema = new Schema(
  {
    at: { type: Date, default: Date.now, immutable: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', immutable: true },
    userName: { type: String, immutable: true },
    role: { type: String, immutable: true },
    action: { type: String, required: true, immutable: true },
    resource: { type: String, required: true, immutable: true },
    resourceId: { type: String, immutable: true },
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', immutable: true },
    outcome: { type: String, enum: ['success', 'failure'], default: 'success', immutable: true },
    ip: { type: String, immutable: true },
    userAgent: { type: String, immutable: true },
    metadata: { type: Schema.Types.Mixed, immutable: true },
  },
  { versionKey: false },
);
auditLogSchema.index({ at: -1 });
auditLogSchema.index({ resource: 1, resourceId: 1, at: -1 });
auditLogSchema.index({ user: 1, at: -1 });
auditLogSchema.index({ patient: 1, at: -1 });
auditLogSchema.index({ action: 1, at: -1 });

// The audit trail is append-only at the application layer. For defence in depth,
// the production database user should also be denied update/remove on this collection.
const blockMutation = function () {
  throw new Error('Audit log entries cannot be modified or deleted');
};
auditLogSchema.pre(
  [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'findOneAndReplace',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
  ],
  blockMutation,
);
auditLogSchema.pre('save', function () {
  if (!this.isNew) throw new Error('Audit log entries cannot be modified');
});
applyJsonTransform(auditLogSchema);

export const AuditLog = model('AuditLog', auditLogSchema, 'audit_logs');

/* ----------------------------- Notifications ----------------------------- */

const notificationSchema = new Schema(
  {
    roles: { type: [{ type: String, enum: ROLES }], default: [] },
    users: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: String,
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
    readBy: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { timestamps: true },
);
notificationSchema.index({ roles: 1, createdAt: -1 });
notificationSchema.index({ users: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
applyJsonTransform(notificationSchema, ['readBy']);

export const Notification = model('Notification', notificationSchema, 'notifications');

/* -------------------------------- Counters -------------------------------- */

const counterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);

export const Counter = model('Counter', counterSchema, 'counters');

/* ---------------------------- Hospital settings ---------------------------- */

const sessionDefinition = new Schema(
  { name: { type: String, required: true }, start: String, end: String },
  { _id: false },
);

const settingsSchema = new Schema(
  {
    key: { type: String, default: 'default', unique: true },
    hospital: {
      name: { type: String, default: 'National Clinic' },
      shortName: { type: String, default: 'NC' },
      addressLine: String,
      city: { type: String, default: 'Aurangabad' },
      state: { type: String, default: 'Maharashtra' },
      pincode: String,
      phone: String,
      email: String,
      registrationNumber: String,
      gstin: String,
      establishedYear: { type: Number, default: 2005 },
    },
    opd: {
      sessions: {
        type: [sessionDefinition],
        // Full-time OPD. Administrators can split the day into sessions in Settings.
        default: [{ name: 'Full day', start: '00:00', end: '23:59' }],
      },
      tokenReset: { type: String, enum: ['daily', 'session'], default: 'daily' },
      tokenPerDoctor: { type: Boolean, default: true },
      defaultSlotMinutes: { type: Number, default: 15 },
    },
    modules: {
      pharmacy: { type: Boolean, default: true },
      laboratory: { type: Boolean, default: true },
      beds: { type: Boolean, default: true },
      // The operation theatre is under development at National Clinic.
      ot: { type: Boolean, default: false },
    },
    ot: {
      theatres: { type: [String], default: ['OT 1'] },
    },
    billing: {
      invoicePrefix: { type: String, default: 'INV' },
      invoiceFooter: String,
    },
    clinical: {
      restrictDoctorsToAssignedPatients: { type: Boolean, default: true },
      prescriptionFooter: String,
      requireIndependentLabVerification: { type: Boolean, default: false },
    },
    pharmacy: {
      expiryAlertDays: { type: Number, default: 90 },
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
applyJsonTransform(settingsSchema);

export const HospitalSettings = model('HospitalSettings', settingsSchema, 'hospital_settings');
