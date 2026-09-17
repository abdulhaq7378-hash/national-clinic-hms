import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ROLES } from '@hms/shared';
import { applyJsonTransform } from './_helpers.js';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, index: true },
    phone: { type: String, trim: true },
    designation: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    passwordChangedAt: { type: Date },
    failedLoginCount: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, select: false },
  },
  { timestamps: true },
);
applyJsonTransform(userSchema, ['passwordHash', 'failedLoginCount', 'lockedUntil']);

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const User = model('User', userSchema, 'users');

/**
 * Refresh token sessions. Only a SHA-256 hash of the token is stored. Tokens
 * rotate on every refresh; presenting a rotated token revokes the whole family.
 */
const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedAt: { type: Date },
    userAgent: { type: String },
    ip: { type: String },
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = model('Session', sessionSchema, 'sessions');

/** Time-limited emergency access to a patient's clinical record, always audited. */
const accessGrantSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    reason: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
accessGrantSchema.index({ user: 1, patient: 1 });
accessGrantSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AccessGrant = model('AccessGrant', accessGrantSchema, 'access_grants');
