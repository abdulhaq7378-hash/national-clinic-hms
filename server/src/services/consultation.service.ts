import {
  roundMoney,
  toHospitalDate,
  type ConsultationUpdateInput,
} from '@hms/shared';
import { Appointment, Consultation, Doctor, Patient, Token } from '../models/index.js';
import { runInTransaction, withSession } from '../db/transaction.js';
import { doctorPopulate, patientPopulate, userNamePopulate } from '../repositories/populate.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { skipFor } from '../utils/http.js';
import { assertClinicalAccess } from './access.service.js';
import { recordAudit } from './audit.service.js';
import { chargeForService } from './billing.service.js';
import { applyTokenAction } from './queue.service.js';
import type { Actor } from './actor.js';

const CONSULTATION_POPULATE = [
  { ...patientPopulate, select: 'uhid fullName gender dateOfBirth phone bloodGroup' },
  doctorPopulate('doctor'),
  { path: 'appointment', select: 'date startTime type status' },
  { path: 'token', select: 'number status date' },
  userNamePopulate('addenda.by'),
];

function requireDoctor(actor: Actor): string {
  if (!actor.doctorId) throw forbidden('Only doctors with a doctor profile can record consultations');
  return actor.doctorId;
}

export async function getConsultation(actor: Actor, id: string) {
  const consultation = await Consultation.findById(id).populate(CONSULTATION_POPULATE);
  if (!consultation) throw notFound('Consultation');
  const patientId = String((consultation.patient as unknown as { _id: unknown })._id);
  await assertClinicalAccess(actor, patientId);
  return consultation;
}

export async function listConsultations(
  actor: Actor,
  q: {
    patient?: string;
    doctor?: string;
    status?: string;
    from?: string;
    to?: string;
    mine?: string;
    page: number;
    limit: number;
  },
) {
  const filter: Record<string, unknown> = {};
  if (q.patient) {
    await assertClinicalAccess(actor, q.patient);
    filter.patient = q.patient;
  }
  if (q.mine === 'true' || (actor.role === 'doctor' && !q.patient)) {
    filter.doctor = actor.doctorId ?? null;
  } else if (q.doctor) {
    filter.doctor = q.doctor;
  }
  if (q.status) filter.status = q.status;
  if (q.from || q.to) filter.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  const [items, total] = await Promise.all([
    Consultation.find(filter)
      .select('patient doctor status date chiefComplaint diagnoses followUpDate completedAt createdAt token')
      .populate(CONSULTATION_POPULATE.slice(0, 2))
      .populate({ path: 'token', select: 'number' })
      .sort({ createdAt: -1 })
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit),
    Consultation.countDocuments(filter),
  ]);
  return { items, total };
}

/**
 * Opens a consultation for a queued token, or directly for a patient (for
 * example a ward round). Starting from a waiting token also calls the patient in.
 */
export async function startConsultation(
  actor: Actor,
  input: { token?: string | null; appointment?: string | null; patient?: string | null },
) {
  const doctorId = requireDoctor(actor);
  let tokenId = input.token ?? undefined;

  if (!tokenId && input.appointment) {
    const appointment = await Appointment.findById(input.appointment).select('token doctor');
    if (!appointment) throw notFound('Appointment');
    if (!appointment.token) throw badRequest('Check the patient in at reception before starting the consultation');
    tokenId = String(appointment.token);
  }

  if (tokenId) {
    const token = await Token.findById(tokenId);
    if (!token) throw notFound('Token');
    if (String(token.doctor) !== doctorId) throw forbidden('This patient is in another doctor\'s queue');
    const existing = await Consultation.findOne({ token: token._id });
    if (existing) return getConsultation(actor, existing.id);
    if (!['waiting', 'with_doctor'].includes(token.status)) {
      throw conflict(`Token ${token.number} is ${token.status.replace('_', ' ')}`);
    }

    const consultation = await runInTransaction(async (session) => {
      if (token.status === 'waiting') await applyTokenAction(actor, token.id, 'call', undefined, session);
      const [created] = await Consultation.create(
        [
          {
            patient: token.patient,
            doctor: doctorId,
            token: token._id,
            appointment: token.appointment,
            date: toHospitalDate(),
            vitals: token.vitals ?? undefined,
            status: 'draft',
            createdBy: actor.userId,
          },
        ],
        withSession(session),
      );
      await Token.updateOne({ _id: token._id }, { $set: { consultation: created._id } }, withSession(session));
      if (token.appointment) {
        await Appointment.updateOne({ _id: token.appointment }, { $set: { consultation: created._id } }, withSession(session));
      }
      return created;
    });
    await recordAudit(actor, {
      action: 'consultation.create',
      resource: 'consultation',
      resourceId: consultation.id,
      patient: token.patient,
      metadata: { token: token.number },
    });
    return getConsultation(actor, consultation.id);
  }

  if (!input.patient) throw badRequest('A token, appointment or patient is required');
  if (!(await Patient.exists({ _id: input.patient }))) throw notFound('Patient');
  await assertClinicalAccess(actor, input.patient);

  const today = toHospitalDate();
  const draft = await Consultation.findOne({
    patient: input.patient,
    doctor: doctorId,
    date: today,
    status: 'draft',
    token: { $exists: false },
  });
  if (draft) return getConsultation(actor, draft.id);

  const consultation = await Consultation.create({
    patient: input.patient,
    doctor: doctorId,
    date: today,
    status: 'draft',
    createdBy: actor.userId,
  });
  await recordAudit(actor, {
    action: 'consultation.create',
    resource: 'consultation',
    resourceId: consultation.id,
    patient: input.patient,
  });
  return getConsultation(actor, consultation.id);
}

async function loadOwnDraft(actor: Actor, id: string) {
  const doctorId = requireDoctor(actor);
  const consultation = await Consultation.findById(id);
  if (!consultation) throw notFound('Consultation');
  if (String(consultation.doctor) !== doctorId) throw forbidden('Only the treating doctor can change this consultation');
  if (consultation.status !== 'draft') {
    throw conflict('This consultation is completed and locked. Add an addendum instead.');
  }
  return consultation;
}

function applyUpdate(consultation: InstanceType<typeof Consultation>, input: ConsultationUpdateInput) {
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === 'vitals' && value) {
      const v = value as ConsultationUpdateInput['vitals'] & Record<string, number | undefined>;
      const bmi = v.weightKg && v.heightCm ? roundMoney(v.weightKg / (v.heightCm / 100) ** 2) : undefined;
      consultation.set('vitals', { ...v, bmi });
    } else {
      consultation.set(key, value);
    }
  }
}

export async function updateConsultation(actor: Actor, id: string, input: ConsultationUpdateInput) {
  const consultation = await loadOwnDraft(actor, id);
  applyUpdate(consultation, input);
  await consultation.save();
  await recordAudit(actor, {
    action: 'consultation.update',
    resource: 'consultation',
    resourceId: id,
    patient: consultation.patient,
    metadata: { fields: Object.keys(input).filter((k) => input[k as keyof ConsultationUpdateInput] !== undefined) },
  });
  return getConsultation(actor, id);
}

/**
 * Completes and locks the consultation, closes the queue token and raises the
 * consultation fee configured for the doctor.
 */
export async function completeConsultation(actor: Actor, id: string, input: ConsultationUpdateInput) {
  const consultation = await loadOwnDraft(actor, id);
  applyUpdate(consultation, input);
  if (!consultation.chiefComplaint) throw badRequest('Record the chief complaint before completing the consultation');

  const doctor = await Doctor.findById(consultation.doctor).select('consultationService followUpService');
  const appointment = consultation.appointment
    ? await Appointment.findById(consultation.appointment).select('type')
    : null;
  const feeService =
    appointment?.type === 'follow_up' && doctor?.followUpService ? doctor.followUpService : doctor?.consultationService;

  await runInTransaction(async (session) => {
    consultation.status = 'completed';
    consultation.completedAt = new Date();
    await consultation.save({ session });

    if (consultation.token) {
      const token = await Token.findById(consultation.token).session(session).select('status');
      if (token?.status === 'with_doctor') {
        await applyTokenAction(actor, String(consultation.token), 'complete', undefined, session);
      }
    }
    await chargeForService(
      actor,
      feeService,
      {
        patient: consultation.patient,
        quantity: 1,
        sourceKind: 'consultation',
        sourceId: consultation._id,
        sourceKey: `consultation:${consultation.id}`,
      },
      session,
    );
    await recordAudit(
      actor,
      {
        action: 'consultation.complete',
        resource: 'consultation',
        resourceId: id,
        patient: consultation.patient,
        metadata: { diagnoses: consultation.diagnoses.length, feeCharged: Boolean(feeService) },
      },
      session,
    );
  });
  return getConsultation(actor, id);
}

export async function addAddendum(actor: Actor, id: string, text: string) {
  const doctorId = requireDoctor(actor);
  const consultation = await Consultation.findById(id);
  if (!consultation) throw notFound('Consultation');
  if (String(consultation.doctor) !== doctorId) throw forbidden('Only the treating doctor can add an addendum');
  if (consultation.status !== 'completed') throw conflict('Edit the draft directly until it is completed');
  consultation.addenda.push({ text, by: actor.userId, at: new Date() });
  await consultation.save();
  await recordAudit(actor, {
    action: 'consultation.addendum',
    resource: 'consultation',
    resourceId: id,
    patient: consultation.patient,
  });
  return getConsultation(actor, id);
}
