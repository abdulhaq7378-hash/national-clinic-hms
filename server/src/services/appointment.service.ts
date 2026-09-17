import type { ClientSession } from 'mongoose';
import {
  APPOINTMENT_TRANSITIONS,
  REALTIME_EVENTS,
  WEEKDAYS,
  formatEnum,
  minutesToTime,
  timeToMinutes,
  toHospitalDate,
  toHospitalTime,
  weekdayOf,
  type AppointmentCreateInput,
  type AppointmentStatus,
} from '@hms/shared';
import { Appointment, Doctor, Patient } from '../models/index.js';
import { publish } from '../realtime/event-bus.js';
import { doctorPopulate, patientPopulate, userNamePopulate } from '../repositories/populate.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';
import { skipFor } from '../utils/http.js';
import { recordAudit } from './audit.service.js';
import { notify } from './notification.service.js';
import type { Actor } from './actor.js';

const RELEASES_SLOT: AppointmentStatus[] = ['cancelled', 'no_show'];

export const APPOINTMENT_POPULATE = [patientPopulate, doctorPopulate('doctor')];

export async function listAppointments(q: {
  date?: string;
  from?: string;
  to?: string;
  doctor?: string;
  patient?: string;
  status?: string;
  page: number;
  limit: number;
}) {
  const filter: Record<string, unknown> = {};
  if (q.date) filter.date = q.date;
  else if (q.from || q.to) filter.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.doctor) filter.doctor = q.doctor;
  if (q.patient) filter.patient = q.patient;
  if (q.status) filter.status = q.status;
  const sort: Record<string, 1 | -1> = q.patient ? { date: -1, startTime: -1 } : { date: 1, startTime: 1 };
  const [items, total] = await Promise.all([
    Appointment.find(filter).populate(APPOINTMENT_POPULATE).sort(sort).skip(skipFor(q.page, q.limit)).limit(q.limit),
    Appointment.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getAppointment(id: string) {
  const appointment = await Appointment.findById(id)
    .populate(APPOINTMENT_POPULATE)
    .populate(userNamePopulate('statusHistory.by'))
    .populate(userNamePopulate('createdBy'));
  if (!appointment) throw notFound('Appointment');
  return appointment;
}

/** Validates that the doctor works at that time and that the slot is free. */
async function resolveSlot(
  doctorId: string,
  patientId: string,
  date: string,
  startTime: string,
  excludeId?: string,
) {
  const doctor = await Doctor.findById(doctorId).populate({ path: 'user', select: 'name isActive' });
  const doctorUser = doctor?.user as unknown as { name: string; isActive: boolean } | undefined;
  if (!doctor || !doctor.isActive || !doctorUser?.isActive) throw notFound('Doctor');

  const today = toHospitalDate();
  if (date < today || (date === today && startTime < toHospitalTime())) {
    throw badRequest('Appointments cannot be booked in the past. Use a walk-in token for patients already here.');
  }

  const slotMinutes = doctor.slotMinutes ?? 15;
  const start = timeToMinutes(startTime);
  const end = start + slotMinutes;
  const day = WEEKDAYS[weekdayOf(date)];
  const withinHours = doctor.availability.some(
    (w) => w.day === day && timeToMinutes(w.start) <= start && end <= timeToMinutes(w.end),
  );
  if (!withinHours) {
    throw badRequest(`Dr. ${doctorUser.name} is not available at ${startTime} on ${formatEnum(day)}`);
  }

  const exclude = excludeId ? { _id: { $ne: excludeId } } : {};
  const clash = await Appointment.exists({
    ...exclude,
    doctor: doctorId,
    date,
    holdsSlot: true,
    startMinutes: { $lt: end },
    endMinutes: { $gt: start },
  });
  if (clash) throw conflict('This time slot is already booked for the doctor');

  const patientClash = await Appointment.exists({
    ...exclude,
    patient: patientId,
    date,
    holdsSlot: true,
    status: { $nin: ['completed'] },
    startMinutes: { $lt: end },
    endMinutes: { $gt: start },
  });
  if (patientClash) throw conflict('The patient already has an appointment at this time');

  return { startMinutes: start, endMinutes: end, endTime: minutesToTime(end), doctorName: doctorUser.name };
}

function slotConflict(err: unknown): never {
  if ((err as { code?: number }).code === 11000) throw conflict('This time slot was just booked by someone else');
  throw err;
}

export async function createAppointment(actor: Actor, input: AppointmentCreateInput) {
  const patient = await Patient.findById(input.patient).select('fullName uhid');
  if (!patient) throw notFound('Patient');
  const slot = await resolveSlot(input.doctor, input.patient, input.date, input.startTime);

  const appointment = await Appointment.create({
    ...input,
    endTime: slot.endTime,
    startMinutes: slot.startMinutes,
    endMinutes: slot.endMinutes,
    status: 'scheduled',
    holdsSlot: true,
    createdBy: actor.userId,
    statusHistory: [{ status: 'scheduled', by: actor.userId, at: new Date() }],
  }).catch(slotConflict);

  await recordAudit(actor, {
    action: 'appointment.create',
    resource: 'appointment',
    resourceId: appointment.id,
    patient: input.patient,
    metadata: { date: input.date, time: input.startTime, doctor: input.doctor, source: input.source },
  });
  publish({
    type: REALTIME_EVENTS.appointmentChanged,
    payload: { id: appointment.id, date: input.date, doctor: input.doctor },
    permission: 'appointment:read',
  });
  if (input.source === 'website') {
    await notify({
      roles: ['receptionist'],
      type: 'appointment.online',
      title: 'New online appointment',
      message: `${patient.fullName} booked ${input.date} at ${input.startTime} with Dr. ${slot.doctorName}`,
      link: `/appointments?date=${input.date}`,
    });
  }
  return getAppointment(appointment.id);
}

export async function rescheduleAppointment(
  actor: Actor,
  id: string,
  input: { doctor?: string; date: string; startTime: string; reason?: string | null },
) {
  const appointment = await Appointment.findById(id);
  if (!appointment) throw notFound('Appointment');
  if (!['scheduled', 'confirmed'].includes(appointment.status)) {
    throw conflict(`A ${formatEnum(appointment.status).toLowerCase()} appointment cannot be rescheduled`);
  }
  const doctorId = input.doctor ?? String(appointment.doctor);
  const slot = await resolveSlot(doctorId, String(appointment.patient), input.date, input.startTime, id);
  const previous = { date: appointment.date, startTime: appointment.startTime, doctor: String(appointment.doctor) };

  appointment.set({
    doctor: doctorId,
    date: input.date,
    startTime: input.startTime,
    endTime: slot.endTime,
    startMinutes: slot.startMinutes,
    endMinutes: slot.endMinutes,
    status: 'scheduled',
  });
  appointment.statusHistory.push({
    status: 'scheduled',
    by: actor.userId,
    at: new Date(),
    note: `Rescheduled from ${previous.date} ${previous.startTime}${input.reason ? `: ${input.reason}` : ''}`,
  });
  await appointment.save().catch(slotConflict);

  await recordAudit(actor, {
    action: 'appointment.reschedule',
    resource: 'appointment',
    resourceId: id,
    patient: appointment.patient,
    metadata: { from: previous, to: { date: input.date, startTime: input.startTime, doctor: doctorId } },
  });
  publish({
    type: REALTIME_EVENTS.appointmentChanged,
    payload: { id, date: input.date },
    permission: 'appointment:read',
  });
  return getAppointment(id);
}

export async function updateAppointmentDetails(
  actor: Actor,
  id: string,
  input: { type?: string; notes?: string | null },
) {
  const appointment = await Appointment.findById(id);
  if (!appointment) throw notFound('Appointment');
  if (input.type !== undefined) appointment.set('type', input.type);
  if (input.notes !== undefined) appointment.set('notes', input.notes);
  await appointment.save();
  await recordAudit(actor, {
    action: 'appointment.update',
    resource: 'appointment',
    resourceId: id,
    patient: appointment.patient,
    metadata: { fields: Object.keys(input) },
  });
  return getAppointment(id);
}

/**
 * Central status transition used by manual actions and by the reception and
 * consultation workflows. Invalid transitions are rejected.
 */
export async function transitionAppointment(
  actor: Actor,
  id: string,
  status: AppointmentStatus,
  note?: string | null,
  session: ClientSession | null = null,
) {
  const appointment = await Appointment.findById(id).session(session);
  if (!appointment) throw notFound('Appointment');
  const current = appointment.status as AppointmentStatus;
  if (current === status) return appointment;
  if (!APPOINTMENT_TRANSITIONS[current].includes(status)) {
    throw new AppError(
      409,
      'INVALID_TRANSITION',
      `Cannot change appointment from ${formatEnum(current)} to ${formatEnum(status)}`,
    );
  }
  appointment.status = status;
  if (RELEASES_SLOT.includes(status)) appointment.holdsSlot = false;
  appointment.statusHistory.push({ status, by: actor.userId, at: new Date(), note: note ?? undefined });
  await appointment.save({ session });

  await recordAudit(
    actor,
    {
      action: `appointment.${status}`,
      resource: 'appointment',
      resourceId: id,
      patient: appointment.patient,
      metadata: note ? { note } : undefined,
    },
    session,
  );
  publish({
    type: REALTIME_EVENTS.appointmentChanged,
    payload: { id, date: appointment.date, status },
    permission: 'appointment:read',
  });
  return appointment;
}

export async function changeAppointmentStatus(
  actor: Actor,
  id: string,
  status: 'confirmed' | 'cancelled' | 'no_show',
  reason?: string | null,
) {
  if (status === 'cancelled' && !reason) throw badRequest('A reason is required to cancel an appointment');
  const appointment = await Appointment.findById(id).select('token status');
  if (appointment?.token && status === 'cancelled') {
    throw conflict('This patient is already in the reception queue. Cancel the token from Reception instead.');
  }
  await transitionAppointment(actor, id, status, reason);
  return getAppointment(id);
}
