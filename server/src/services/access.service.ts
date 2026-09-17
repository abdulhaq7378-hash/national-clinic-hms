import { Types } from 'mongoose';
import {
  AccessGrant,
  Admission,
  Appointment,
  Consultation,
  OtBooking,
  Patient,
  Referral,
  Token,
} from '../models/index.js';
import { AppError, forbidden, notFound } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';
import { getSettings } from './settings.service.js';
import type { Actor } from './actor.js';

const GRANT_HOURS = 12;
const positiveCache = new Map<string, number>();
const CACHE_MS = 5 * 60 * 1000;

async function doctorIsLinked(doctorId: string, patientId: string) {
  const doctor = new Types.ObjectId(doctorId);
  const patient = new Types.ObjectId(patientId);
  const checks = await Promise.all([
    Appointment.exists({ doctor, patient }),
    Token.exists({ doctor, patient }),
    Consultation.exists({ doctor, patient }),
    Admission.exists({ admittingDoctor: doctor, patient }),
    Referral.exists({ referringDoctor: doctor, patient }),
    OtBooking.exists({ surgeon: doctor, patient }),
  ]);
  return checks.some(Boolean);
}

/**
 * Clinical records (history, consultations, prescriptions, lab results) need
 * `medical:read`. When the hospital restricts doctors to their own patients, a
 * doctor also needs a care relationship or a recorded emergency access grant.
 */
export async function assertClinicalAccess(actor: Actor, patientId: string) {
  if (!actor.permissions.includes('medical:read')) throw forbidden();
  if (actor.role !== 'doctor') return;
  const settings = await getSettings();
  if (!settings.clinical?.restrictDoctorsToAssignedPatients) return;

  const key = `${actor.userId}:${patientId}`;
  const cachedAt = positiveCache.get(key);
  if (cachedAt && Date.now() - cachedAt < CACHE_MS) return;

  const linked =
    (actor.doctorId && (await doctorIsLinked(actor.doctorId, patientId))) ||
    (await AccessGrant.exists({ user: actor.userId, patient: patientId, expiresAt: { $gt: new Date() } }));
  if (!linked) {
    throw new AppError(
      403,
      'PATIENT_ACCESS_REQUIRED',
      'This patient is not under your care. Use emergency access if you need to view the record.',
    );
  }
  positiveCache.set(key, Date.now());
}

export async function canAccessClinical(actor: Actor, patientId: string) {
  try {
    await assertClinicalAccess(actor, patientId);
    return true;
  } catch {
    return false;
  }
}

export async function grantEmergencyAccess(actor: Actor, patientId: string, reason: string) {
  if (!actor.permissions.includes('medical:read')) throw forbidden();
  const exists = await Patient.exists({ _id: patientId });
  if (!exists) throw notFound('Patient');
  const expiresAt = new Date(Date.now() + GRANT_HOURS * 60 * 60 * 1000);
  const grant = await AccessGrant.create({ user: actor.userId, patient: patientId, reason, expiresAt });
  await recordAudit(actor, {
    action: 'patient.emergency_access',
    resource: 'patient',
    resourceId: patientId,
    patient: patientId,
    metadata: { reason, expiresAt },
  });
  return { id: grant.id, expiresAt };
}
