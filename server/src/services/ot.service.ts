import {
  OT_TRANSITIONS,
  formatEnum,
  otUpdateSchema,
  type OtCreateInput,
  type OtStatus,
} from '@hms/shared';
import type { z } from 'zod';
import { Admission, Doctor, OtBooking, Patient } from '../models/index.js';
import { doctorPopulate, userNamePopulate } from '../repositories/populate.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';
import { skipFor } from '../utils/http.js';
import { recordAudit } from './audit.service.js';
import { nextDocumentNumber } from './counter.service.js';
import { getSettings } from './settings.service.js';
import type { Actor } from './actor.js';

type OtUpdateInput = z.infer<typeof otUpdateSchema>;

const ACTIVE: OtStatus[] = ['scheduled', 'pre_op', 'in_progress'];
const POPULATE = [
  { path: 'patient', select: 'uhid fullName gender dateOfBirth phone' },
  doctorPopulate('surgeon'),
  { path: 'admission', select: 'admissionNumber status' },
  userNamePopulate('statusHistory.by'),
];

export async function listOtBookings(q: { from?: string; to?: string; status?: string; page: number; limit: number }) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.from || q.to) {
    filter.scheduledStart = {
      ...(q.from && { $gte: new Date(`${q.from}T00:00:00+05:30`) }),
      ...(q.to && { $lte: new Date(`${q.to}T23:59:59.999+05:30`) }),
    };
  }
  const [items, total] = await Promise.all([
    OtBooking.find(filter).populate(POPULATE.slice(0, 2)).sort({ scheduledStart: 1 }).skip(skipFor(q.page, q.limit)).limit(q.limit),
    OtBooking.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getOtBooking(id: string) {
  const booking = await OtBooking.findById(id).populate(POPULATE);
  if (!booking) throw notFound('OT booking');
  return booking;
}

async function assertSchedule(
  params: { theatre: string; surgeon: string; start: Date; end: Date },
  excludeId?: string,
) {
  const settings = await getSettings();
  const theatres = settings.ot?.theatres ?? [];
  if (!theatres.includes(params.theatre)) throw badRequest('Select a theatre configured in Settings');
  if (!(await Doctor.exists({ _id: params.surgeon, isActive: true }))) throw notFound('Surgeon');
  const overlap = {
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    status: { $in: ACTIVE },
    scheduledStart: { $lt: params.end },
    scheduledEnd: { $gt: params.start },
  };
  if (await OtBooking.exists({ ...overlap, theatre: params.theatre })) {
    throw conflict(`${params.theatre} is already booked at this time`);
  }
  if (await OtBooking.exists({ ...overlap, surgeon: params.surgeon })) {
    throw conflict('The surgeon has another procedure at this time');
  }
}

export async function createOtBooking(actor: Actor, input: OtCreateInput) {
  if (!(await Patient.exists({ _id: input.patient }))) throw notFound('Patient');
  if (input.admission && !(await Admission.exists({ _id: input.admission, patient: input.patient }))) {
    throw badRequest('The admission does not belong to this patient');
  }
  const start = new Date(input.scheduledStart);
  if (start < new Date()) throw badRequest('Procedures cannot be scheduled in the past');
  const end = new Date(start.getTime() + input.estimatedMinutes * 60_000);
  await assertSchedule({ theatre: input.theatre, surgeon: input.surgeon, start, end });

  const booking = await OtBooking.create({
    ...input,
    bookingNumber: await nextDocumentNumber('OT'),
    scheduledStart: start,
    scheduledEnd: end,
    status: 'scheduled',
    createdBy: actor.userId,
    statusHistory: [{ status: 'scheduled', by: actor.userId, at: new Date() }],
  });
  await recordAudit(actor, {
    action: 'ot.create',
    resource: 'ot_booking',
    resourceId: booking.id,
    patient: input.patient,
    metadata: { bookingNumber: booking.bookingNumber, theatre: input.theatre, start },
  });
  return getOtBooking(booking.id);
}

export async function updateOtBooking(actor: Actor, id: string, input: OtUpdateInput) {
  const booking = await OtBooking.findById(id);
  if (!booking) throw notFound('OT booking');
  const status = booking.status as OtStatus;
  const schedulingFields = ['theatre', 'surgeon', 'scheduledStart', 'estimatedMinutes'] as const;
  const reschedule = schedulingFields.some((f) => input[f] !== undefined);
  if (reschedule && !['scheduled', 'postponed'].includes(status)) {
    throw conflict('Only scheduled or postponed procedures can be rescheduled');
  }
  if (input.postOpNotes !== undefined && !['in_progress', 'completed'].includes(status)) {
    throw badRequest('Post-operative notes can be added once the procedure has started');
  }
  if (['completed', 'cancelled'].includes(status) && input.postOpNotes === undefined) {
    throw conflict(`A ${status} booking can only receive post-operative notes`);
  }

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    booking.set(key, key === 'scheduledStart' ? new Date(value as string) : value);
  }
  if (reschedule) {
    const start = booking.scheduledStart;
    const end = new Date(start.getTime() + booking.estimatedMinutes * 60_000);
    await assertSchedule({ theatre: booking.theatre, surgeon: String(booking.surgeon), start, end }, id);
    booking.scheduledEnd = end;
  }
  await booking.save();
  await recordAudit(actor, {
    action: 'ot.update',
    resource: 'ot_booking',
    resourceId: id,
    patient: booking.patient,
    metadata: { fields: Object.keys(input) },
  });
  return getOtBooking(id);
}

export async function changeOtStatus(actor: Actor, id: string, status: OtStatus, note?: string | null) {
  const booking = await OtBooking.findById(id);
  if (!booking) throw notFound('OT booking');
  const current = booking.status as OtStatus;
  if (!OT_TRANSITIONS[current].includes(status)) {
    throw new AppError(409, 'INVALID_TRANSITION', `Cannot move from ${formatEnum(current)} to ${formatEnum(status)}`);
  }
  if (status === 'completed' && !booking.postOpNotes) {
    throw badRequest('Add post-operative notes before marking the procedure completed');
  }
  if (['cancelled', 'postponed'].includes(status) && !note) throw badRequest('A reason is required');
  if (status === 'in_progress') booking.actualStart = new Date();
  if (status === 'completed') booking.actualEnd = new Date();
  booking.status = status;
  booking.statusHistory.push({ status, by: actor.userId, at: new Date(), note: note ?? undefined });
  await booking.save();
  await recordAudit(actor, {
    action: `ot.${status}`,
    resource: 'ot_booking',
    resourceId: id,
    patient: booking.patient,
    metadata: note ? { note } : undefined,
  });
  return getOtBooking(id);
}
