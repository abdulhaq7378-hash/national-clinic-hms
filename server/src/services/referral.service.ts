import {
  REFERRAL_TRANSITIONS,
  formatEnum,
  type ReferralCreateInput,
  type ReferralStatus,
} from '@hms/shared';
import { Consultation, Patient, Referral } from '../models/index.js';
import { doctorPopulate, patientPopulate, userNamePopulate } from '../repositories/populate.js';
import { AppError, badRequest, forbidden, notFound } from '../utils/errors.js';
import { skipFor } from '../utils/http.js';
import { assertClinicalAccess } from './access.service.js';
import { recordAudit } from './audit.service.js';
import { nextDocumentNumber } from './counter.service.js';
import type { Actor } from './actor.js';

const REFERRAL_POPULATE = [
  patientPopulate,
  doctorPopulate('referringDoctor'),
  { path: 'consultation', select: 'date chiefComplaint diagnoses' },
  userNamePopulate('statusHistory.by'),
];

export async function getReferral(actor: Actor, id: string) {
  const referral = await Referral.findById(id).populate(REFERRAL_POPULATE);
  if (!referral) throw notFound('Referral');
  if (actor.permissions.includes('medical:read')) {
    await assertClinicalAccess(actor, String((referral.patient as unknown as { _id: unknown })._id));
  } else {
    // Administrative readers see the referral itself, not the clinical content.
    referral.set('clinicalNotes', undefined);
    referral.set('consultation', undefined);
  }
  return referral;
}

export async function listReferrals(
  actor: Actor,
  q: { patient?: string; status?: string; priority?: string; page: number; limit: number },
) {
  const filter: Record<string, unknown> = {};
  if (q.patient) {
    if (actor.permissions.includes('medical:read')) await assertClinicalAccess(actor, q.patient);
    filter.patient = q.patient;
  } else if (actor.role === 'doctor') {
    filter.referringDoctor = actor.doctorId ?? null;
  }
  if (q.status) filter.status = q.status;
  if (q.priority) filter.priority = q.priority;
  const [items, total] = await Promise.all([
    Referral.find(filter)
      .select('-clinicalNotes')
      .populate(REFERRAL_POPULATE.slice(0, 2))
      .sort({ createdAt: -1 })
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit),
    Referral.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createReferral(actor: Actor, input: ReferralCreateInput) {
  if (!actor.doctorId) throw forbidden('Only doctors can create referrals');
  if (!(await Patient.exists({ _id: input.patient }))) throw notFound('Patient');
  await assertClinicalAccess(actor, input.patient);
  if (input.consultation) {
    const consultation = await Consultation.findById(input.consultation).select('patient');
    if (!consultation || String(consultation.patient) !== input.patient) {
      throw badRequest('The consultation does not belong to this patient');
    }
  }
  const referral = await Referral.create({
    ...input,
    number: await nextDocumentNumber('RF'),
    referringDoctor: actor.doctorId,
    status: 'created',
    createdBy: actor.userId,
    statusHistory: [{ status: 'created', by: actor.userId, at: new Date() }],
  });
  await recordAudit(actor, {
    action: 'referral.create',
    resource: 'referral',
    resourceId: referral.id,
    patient: input.patient,
    metadata: { number: referral.number, specialty: input.specialty, priority: input.priority },
  });
  return getReferral(actor, referral.id);
}

export async function updateReferralStatus(actor: Actor, id: string, status: ReferralStatus, note?: string | null) {
  const referral = await Referral.findById(id);
  if (!referral) throw notFound('Referral');
  await assertClinicalAccess(actor, String(referral.patient));
  const current = referral.status as ReferralStatus;
  if (!REFERRAL_TRANSITIONS[current].includes(status)) {
    throw new AppError(409, 'INVALID_TRANSITION', `Cannot change referral from ${formatEnum(current)} to ${formatEnum(status)}`);
  }
  if (status === 'cancelled' && !note) throw badRequest('A reason is required to cancel a referral');
  referral.status = status;
  referral.statusHistory.push({ status, by: actor.userId, at: new Date(), note: note ?? undefined });
  await referral.save();
  await recordAudit(actor, {
    action: `referral.${status}`,
    resource: 'referral',
    resourceId: id,
    patient: referral.patient,
  });
  return getReferral(actor, id);
}
