import type { ClientSession } from 'mongoose';
import {
  PRIORITIES,
  REALTIME_EVENTS,
  formatEnum,
  roundMoney,
  toHospitalDate,
  toHospitalTime,
  type TokenStatus,
  type VitalsInput,
  type WalkInInput,
} from '@hms/shared';
import { Appointment, Doctor, Patient, Token } from '../models/index.js';
import { runInTransaction, withSession } from '../db/transaction.js';
import { publish } from '../realtime/event-bus.js';
import { doctorPopulate } from '../repositories/populate.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { transitionAppointment } from './appointment.service.js';
import { recordAudit } from './audit.service.js';
import { nextSequence } from './counter.service.js';
import { getSettings } from './settings.service.js';
import { withAge } from './patient.service.js';
import type { Actor } from './actor.js';

const PRIORITY_RANK: Record<string, number> = { emergency: 0, urgent: 1, routine: 2 };

const TOKEN_POPULATE = [
  { path: 'patient', select: 'uhid fullName gender dateOfBirth phone' },
  doctorPopulate('doctor'),
  { path: 'appointment', select: 'startTime type status' },
  { path: 'consultation', select: 'status' },
];

/**
 * Counter scope for token numbers. Numbers restart every day, or every OPD
 * session when configured, and optionally per doctor.
 */
async function tokenScope(date: string, doctorId: string) {
  const settings = await getSettings();
  const parts = [date];
  let session: string | undefined;
  if (settings.opd?.tokenReset === 'session') {
    const now = toHospitalTime();
    const sessions = settings.opd.sessions ?? [];
    session = sessions.find((s) => s.start && s.end && s.start <= now && now <= s.end)?.name;
    if (!session) throw badRequest('No OPD session is running at this time. Check OPD sessions in Settings.');
    parts.push(session);
  }
  if (settings.opd?.tokenPerDoctor) parts.push(doctorId);
  return { sequenceKey: parts.join(':'), session };
}

function emitQueue(date: string, doctor: string, tokenId: string) {
  publish({
    type: REALTIME_EVENTS.queueChanged,
    payload: { id: tokenId, date, doctor },
    permission: 'queue:read',
  });
}

async function issueToken(
  actor: Actor,
  input: {
    patient: string;
    doctor: string;
    appointment?: string;
    visitType: 'appointment' | 'walk_in';
    priority?: (typeof PRIORITIES)[number];
    notes?: string | null;
  },
  session: ClientSession | null,
) {
  const date = toHospitalDate();
  const scope = await tokenScope(date, input.doctor);
  const number = await nextSequence(`token:${scope.sequenceKey}`, session);
  const [token] = await Token.create(
    [
      {
        date,
        session: scope.session,
        sequenceKey: scope.sequenceKey,
        number,
        patient: input.patient,
        doctor: input.doctor,
        appointment: input.appointment,
        visitType: input.visitType,
        priority: input.priority ?? 'routine',
        notes: input.notes ?? undefined,
        status: 'waiting',
        checkedInAt: new Date(),
        createdBy: actor.userId,
        statusHistory: [{ status: 'waiting', by: actor.userId, at: new Date() }],
      },
    ],
    withSession(session),
  );
  return token;
}

async function assertNoActiveToken(patientId: string, doctorId: string, date: string) {
  const active = await Token.findOne({
    patient: patientId,
    doctor: doctorId,
    date,
    status: { $in: ['waiting', 'with_doctor'] },
  }).select('number');
  if (active) throw conflict(`The patient is already in this doctor's queue with token ${active.number}`);
}

export async function registerWalkIn(actor: Actor, input: WalkInInput) {
  const [patient, doctor] = await Promise.all([
    Patient.exists({ _id: input.patient }),
    Doctor.exists({ _id: input.doctor, isActive: true }),
  ]);
  if (!patient) throw notFound('Patient');
  if (!doctor) throw notFound('Doctor');
  await assertNoActiveToken(input.patient, input.doctor, toHospitalDate());

  const token = await runInTransaction((session) =>
    issueToken(actor, { ...input, visitType: 'walk_in' }, session),
  );
  await recordAudit(actor, {
    action: 'token.walk_in',
    resource: 'token',
    resourceId: token.id,
    patient: input.patient,
    metadata: { number: token.number, doctor: input.doctor },
  });
  emitQueue(token.date, input.doctor, token.id);
  return getToken(token.id);
}

export async function checkInAppointment(actor: Actor, appointmentId: string) {
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) throw notFound('Appointment');
  const today = toHospitalDate();
  if (appointment.date !== today) throw badRequest('Only today\'s appointments can be checked in');
  if (!['scheduled', 'confirmed'].includes(appointment.status)) {
    throw conflict(`Appointment is ${formatEnum(appointment.status).toLowerCase()} and cannot be checked in`);
  }
  await assertNoActiveToken(String(appointment.patient), String(appointment.doctor), today);

  const token = await runInTransaction(async (session) => {
    const issued = await issueToken(
      actor,
      {
        patient: String(appointment.patient),
        doctor: String(appointment.doctor),
        appointment: appointment.id,
        visitType: 'appointment',
      },
      session,
    );
    await Appointment.updateOne({ _id: appointment._id }, { $set: { token: issued._id } }, withSession(session));
    await transitionAppointment(actor, appointment.id, 'checked_in', `Token ${issued.number}`, session);
    return issued;
  });

  await recordAudit(actor, {
    action: 'token.check_in',
    resource: 'token',
    resourceId: token.id,
    patient: appointment.patient,
    metadata: { number: token.number, appointment: appointment.id },
  });
  emitQueue(token.date, String(appointment.doctor), token.id);
  return getToken(token.id);
}

export async function getToken(id: string) {
  const token = await Token.findById(id).populate(TOKEN_POPULATE);
  if (!token) throw notFound('Token');
  return token;
}

function serializeToken(token: InstanceType<typeof Token>) {
  const json = token.toJSON() as Record<string, unknown> & { patient?: { dateOfBirth?: Date } };
  if (json.patient) json.patient = withAge(json.patient);
  return json;
}

function sortWaiting(a: InstanceType<typeof Token>, b: InstanceType<typeof Token>) {
  const rank = (PRIORITY_RANK[a.priority ?? 'routine'] ?? 2) - (PRIORITY_RANK[b.priority ?? 'routine'] ?? 2);
  if (rank !== 0) return rank;
  return a.checkedInAt!.getTime() - b.checkedInAt!.getTime();
}

export async function getQueue(params: { date?: string; doctor?: string }) {
  const date = params.date ?? toHospitalDate();
  const filter: Record<string, unknown> = { date };
  if (params.doctor) filter.doctor = params.doctor;
  const tokens = await Token.find(filter).populate(TOKEN_POPULATE).sort({ checkedInAt: 1 });

  const byStatus = (status: TokenStatus) => tokens.filter((t) => t.status === status);
  const waiting = byStatus('waiting').sort(sortWaiting);
  const withDoctor = byStatus('with_doctor').sort((a, b) => (a.calledAt?.getTime() ?? 0) - (b.calledAt?.getTime() ?? 0));
  const completed = byStatus('completed').sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  const other = tokens.filter((t) => ['skipped', 'cancelled'].includes(t.status));
  const latest = [...tokens].sort((a, b) => b.checkedInAt!.getTime() - a.checkedInAt!.getTime())[0];

  return {
    date,
    summary: {
      lastIssued: latest ? latest.number : null,
      nowServing: withDoctor.map((t) => t.number),
      waiting: waiting.length,
      withDoctor: withDoctor.length,
      completed: completed.length,
      skipped: other.filter((t) => t.status === 'skipped').length,
      total: tokens.length,
    },
    waiting: waiting.map(serializeToken),
    withDoctor: withDoctor.map(serializeToken),
    completed: completed.map(serializeToken),
    other: other.map(serializeToken),
  };
}

const ACTION_RULES: Record<string, { from: TokenStatus[]; to: TokenStatus }> = {
  call: { from: ['waiting'], to: 'with_doctor' },
  complete: { from: ['with_doctor'], to: 'completed' },
  skip: { from: ['waiting', 'with_doctor'], to: 'skipped' },
  requeue: { from: ['skipped'], to: 'waiting' },
  cancel: { from: ['waiting', 'skipped'], to: 'cancelled' },
};

/**
 * Moves a token through the queue and keeps the linked appointment in step.
 * Doctors may only act on their own queue.
 */
export async function applyTokenAction(
  actor: Actor,
  tokenId: string,
  action: keyof typeof ACTION_RULES,
  reason?: string | null,
  session: ClientSession | null = null,
) {
  const token = await Token.findById(tokenId).session(session);
  if (!token) throw notFound('Token');
  if (actor.role === 'doctor' && String(token.doctor) !== actor.doctorId) {
    throw forbidden('This patient is in another doctor\'s queue');
  }
  const rule = ACTION_RULES[action];
  if (!rule.from.includes(token.status as TokenStatus)) {
    throw new AppError(409, 'INVALID_TRANSITION', `Token ${token.number} is ${formatEnum(token.status).toLowerCase()}`);
  }
  if (action === 'cancel' && !reason) throw badRequest('A reason is required to cancel a token');
  if (token.date !== toHospitalDate() && !['complete', 'cancel'].includes(action)) {
    throw badRequest('Only today\'s queue can be changed');
  }

  // Re-read inside the transaction so a retried attempt starts from stored state.
  const run = async (s: ClientSession | null) => {
    const now = new Date();
    const set: Record<string, unknown> = { status: rule.to };
    if (action === 'call') set.calledAt = now;
    if (action === 'complete') set.completedAt = now;
    const updated = await Token.updateOne(
      { _id: token._id, status: token.status },
      {
        $set: set,
        $push: { statusHistory: { status: rule.to, by: actor.userId, at: now, note: reason ?? undefined } },
      },
      withSession(s),
    );
    if (updated.modifiedCount === 0) {
      throw new AppError(409, 'INVALID_TRANSITION', `Token ${token.number} was updated by someone else. Refresh and try again.`);
    }

    if (token.appointment) {
      const appointmentId = String(token.appointment);
      if (action === 'call') await transitionAppointment(actor, appointmentId, 'in_consultation', undefined, s);
      if (action === 'complete') await transitionAppointment(actor, appointmentId, 'completed', undefined, s);
      if (action === 'cancel') {
        await Appointment.updateOne(
          { _id: appointmentId },
          {
            $set: { status: 'cancelled', holdsSlot: false },
            $push: { statusHistory: { status: 'cancelled', by: actor.userId, at: now, note: reason } },
          },
          withSession(s),
        );
      }
    }
  };
  if (session) await run(session);
  else await runInTransaction(run);

  await recordAudit(
    actor,
    {
      action: `token.${action}`,
      resource: 'token',
      resourceId: token.id,
      patient: token.patient,
      metadata: { number: token.number, ...(reason ? { reason } : {}) },
    },
    session,
  );
  emitQueue(token.date, String(token.doctor), token.id);
  return session ? token : getToken(token.id);
}

/** Calls the next waiting patient for a doctor, by priority then arrival. */
export async function callNext(actor: Actor, doctorId: string) {
  if (actor.role === 'doctor' && doctorId !== actor.doctorId) throw forbidden();
  const date = toHospitalDate();
  const waiting = await Token.find({ date, doctor: doctorId, status: 'waiting' });
  if (!waiting.length) throw notFound('Waiting patient');
  const next = waiting.sort(sortWaiting)[0];
  await applyTokenAction(actor, next.id, 'call');
  return getToken(next.id);
}

export async function recordVitals(actor: Actor, tokenId: string, vitals: VitalsInput) {
  const token = await Token.findById(tokenId);
  if (!token) throw notFound('Token');
  if (['completed', 'cancelled'].includes(token.status)) throw conflict('This visit is already closed');
  const bmi =
    vitals.weightKg && vitals.heightCm ? roundMoney(vitals.weightKg / (vitals.heightCm / 100) ** 2) : undefined;
  token.set('vitals', { ...vitals, bmi });
  token.vitalsRecordedBy = actor.userId as never;
  token.vitalsRecordedAt = new Date();
  await token.save();
  await recordAudit(actor, {
    action: 'token.vitals',
    resource: 'token',
    resourceId: token.id,
    patient: token.patient,
  });
  emitQueue(token.date, String(token.doctor), token.id);
  return getToken(token.id);
}
