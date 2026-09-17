import type { ClientSession } from 'mongoose';
import {
  REALTIME_EVENTS,
  toHospitalDate,
  type AdmissionCreateInput,
  type DischargeInput,
} from '@hms/shared';
import { Admission, Bed, Doctor, Patient, Room, Ward } from '../models/index.js';
import { runInTransaction, withSession } from '../db/transaction.js';
import { publish } from '../realtime/event-bus.js';
import { doctorPopulate, patientPopulate, userNamePopulate } from '../repositories/populate.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { skipFor } from '../utils/http.js';
import { recordAudit } from './audit.service.js';
import { chargeForService } from './billing.service.js';
import { nextDocumentNumber } from './counter.service.js';
import type { Actor } from './actor.js';

function announce(bedIds: string[]) {
  publish({ type: REALTIME_EVENTS.bedChanged, payload: { beds: bedIds }, permission: 'bed:read' });
}

/* ------------------------------ Configuration ------------------------------ */

export async function listWards(includeInactive = false) {
  const wards = await Ward.find(includeInactive ? {} : { isActive: true }).sort({ name: 1 });
  const rooms = await Room.find({ ward: { $in: wards.map((w) => w._id) } }).sort({ number: 1 });
  return wards.map((w) => ({ ...w.toJSON(), rooms: rooms.filter((r) => r.ward.equals(w._id)) }));
}

export async function createWard(actor: Actor, input: Record<string, unknown>) {
  const ward = await Ward.create(input);
  await recordAudit(actor, { action: 'ward.create', resource: 'ward', resourceId: ward.id, metadata: { code: ward.code } });
  return ward;
}

export async function updateWard(actor: Actor, id: string, input: Record<string, unknown>) {
  const ward = await Ward.findById(id);
  if (!ward) throw notFound('Ward');
  if (input.isActive === false && (await Bed.exists({ ward: id, status: 'occupied' }))) {
    throw conflict('A ward with occupied beds cannot be deactivated');
  }
  for (const [key, value] of Object.entries(input)) if (value !== undefined) ward.set(key, value);
  await ward.save();
  await recordAudit(actor, { action: 'ward.update', resource: 'ward', resourceId: id, metadata: { fields: Object.keys(input) } });
  return ward;
}

export async function createRoom(actor: Actor, input: { ward: string; number: string; description?: string | null }) {
  if (!(await Ward.exists({ _id: input.ward }))) throw notFound('Ward');
  const room = await Room.create(input);
  await recordAudit(actor, { action: 'room.create', resource: 'room', resourceId: room.id, metadata: { number: room.number } });
  return room;
}

export async function createBed(actor: Actor, input: Record<string, unknown> & { ward: string; room?: string | null }) {
  if (!(await Ward.exists({ _id: input.ward }))) throw notFound('Ward');
  if (input.room && !(await Room.exists({ _id: input.room, ward: input.ward }))) {
    throw badRequest('The room does not belong to the selected ward');
  }
  const bed = await Bed.create({ ...input, status: 'available', statusChangedAt: new Date() });
  await recordAudit(actor, { action: 'bed.create', resource: 'bed', resourceId: bed.id, metadata: { code: bed.code } });
  announce([bed.id]);
  return bed;
}

export async function updateBed(actor: Actor, id: string, input: Record<string, unknown>) {
  const bed = await Bed.findById(id);
  if (!bed) throw notFound('Bed');
  if (input.isActive === false && bed.status === 'occupied') throw conflict('An occupied bed cannot be deactivated');
  if (input.room && !(await Room.exists({ _id: input.room, ward: bed.ward }))) {
    throw badRequest('The room does not belong to this bed\'s ward');
  }
  for (const [key, value] of Object.entries(input)) if (value !== undefined) bed.set(key, value);
  await bed.save();
  await recordAudit(actor, { action: 'bed.update', resource: 'bed', resourceId: id, metadata: { fields: Object.keys(input) } });
  announce([id]);
  return bed;
}

export async function setBedStatus(actor: Actor, id: string, status: string, note?: string | null) {
  const bed = await Bed.findOneAndUpdate(
    { _id: id, status: { $ne: 'occupied' } },
    { $set: { status, statusNote: note ?? undefined, statusChangedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!bed) {
    if (!(await Bed.exists({ _id: id }))) throw notFound('Bed');
    throw conflict('An occupied bed is released by discharging or transferring the patient');
  }
  await recordAudit(actor, { action: 'bed.status', resource: 'bed', resourceId: id, metadata: { status, note } });
  announce([id]);
  return bed;
}

/** Bed board grouped by ward and room, with the current occupant. */
export async function getBedBoard() {
  const [wards, rooms, beds] = await Promise.all([
    Ward.find({ isActive: true }).sort({ name: 1 }),
    Room.find({ isActive: true }).sort({ number: 1 }),
    Bed.find({ isActive: true })
      .sort({ code: 1 })
      .populate({ path: 'dailyService', select: 'name price' })
      .populate({
        path: 'currentAdmission',
        select: 'admissionNumber admittedAt patient admittingDoctor expectedDischargeDate',
        populate: [patientPopulate, doctorPopulate('admittingDoctor')],
      }),
  ]);
  const summary = { total: beds.length, available: 0, occupied: 0, reserved: 0, cleaning: 0, maintenance: 0 };
  for (const b of beds) summary[b.status as keyof typeof summary] += 1;
  return {
    summary,
    wards: wards.map((w) => ({
      ...w.toJSON(),
      rooms: rooms.filter((r) => r.ward.equals(w._id)).map((r) => r.toJSON()),
      beds: beds.filter((b) => b.ward.equals(w._id)).map((b) => b.toJSON()),
    })),
  };
}

/* -------------------------------- Admissions ------------------------------- */

const ADMISSION_POPULATE = [
  { path: 'patient', select: 'uhid fullName gender dateOfBirth phone' },
  { path: 'bed', select: 'code type ward room', populate: [{ path: 'ward', select: 'name code' }, { path: 'room', select: 'number' }] },
  doctorPopulate('admittingDoctor'),
  userNamePopulate('admittedBy'),
  userNamePopulate('dischargedBy'),
];

/** Staff without clinical access see bed and stay details, not diagnoses or treatment. */
function redactAdmission(actor: Actor | null, admission: InstanceType<typeof Admission>) {
  if (!actor || actor.permissions.includes('medical:read')) return admission;
  admission.set('provisionalDiagnosis', undefined);
  admission.set('dischargeSummary', undefined);
  return admission;
}

export async function getAdmission(id: string, actor: Actor | null = null) {
  const admission = await Admission.findById(id).populate(ADMISSION_POPULATE);
  if (!admission) throw notFound('Admission');
  return redactAdmission(actor, admission);
}

export async function listAdmissions(
  actor: Actor,
  q: { status?: string; patient?: string; page: number; limit: number },
) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.patient) filter.patient = q.patient;
  const [items, total] = await Promise.all([
    Admission.find(filter)
      .select('-dischargeSummary.treatmentGiven')
      .populate(ADMISSION_POPULATE)
      .sort({ admittedAt: -1 })
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit),
    Admission.countDocuments(filter),
  ]);
  return { items: items.map((a) => redactAdmission(actor, a)), total };
}

async function claimBed(bedId: string, admissionId: unknown, session: ClientSession | null) {
  const bed = await Bed.findOneAndUpdate(
    { _id: bedId, isActive: true, status: { $in: ['available', 'reserved'] } },
    { $set: { status: 'occupied', currentAdmission: admissionId, statusChangedAt: new Date(), statusNote: undefined } },
    { returnDocument: 'after', ...withSession(session) },
  );
  if (!bed) throw conflict('The selected bed is not available');
  return bed;
}

async function releaseBed(bedId: unknown, session: ClientSession | null) {
  await Bed.updateOne(
    { _id: bedId },
    {
      $set: { status: 'cleaning', statusChangedAt: new Date(), statusNote: 'Released after patient left' },
      $unset: { currentAdmission: 1 },
    },
    withSession(session),
  );
}

export async function admitPatient(actor: Actor, input: AdmissionCreateInput) {
  const [patient, doctor] = await Promise.all([
    Patient.exists({ _id: input.patient }),
    Doctor.exists({ _id: input.admittingDoctor, isActive: true }),
  ]);
  if (!patient) throw notFound('Patient');
  if (!doctor) throw notFound('Doctor');
  if (await Admission.exists({ patient: input.patient, status: 'admitted' })) {
    throw conflict('The patient is already admitted');
  }

  const admission = await runInTransaction(async (session) => {
    const admissionNumber = await nextDocumentNumber('ADM', session);
    const [created] = await Admission.create(
      [
        {
          ...input,
          admissionNumber,
          admittedAt: new Date(),
          admittedBy: actor.userId,
          status: 'admitted',
          stays: [],
        },
      ],
      withSession(session),
    );
    const bed = await claimBed(input.bed, created._id, session);
    created.stays.push({ bed: bed._id, bedCode: bed.code, from: created.admittedAt });
    await created.save({ session });
    await recordAudit(
      actor,
      {
        action: 'admission.create',
        resource: 'admission',
        resourceId: created.id,
        patient: input.patient,
        metadata: { admissionNumber, bed: bed.code },
      },
      session,
    );
    return created;
  });
  announce([input.bed]);
  return getAdmission(admission.id);
}

export async function transferBed(actor: Actor, id: string, bedId: string, reason: string) {
  const admission = await Admission.findById(id);
  if (!admission) throw notFound('Admission');
  if (admission.status !== 'admitted') throw conflict('Only admitted patients can be transferred');
  if (String(admission.bed) === bedId) throw badRequest('The patient is already in this bed');
  const previousBed = admission.bed;

  await runInTransaction(async (session) => {
    const doc = (await Admission.findById(id).session(session))!;
    const bed = await claimBed(bedId, doc._id, session);
    await releaseBed(previousBed, session);
    const now = new Date();
    const open = doc.stays.find((s) => !s.to);
    if (open) open.to = now;
    doc.stays.push({ bed: bed._id, bedCode: bed.code, from: now, reason });
    doc.bed = bed._id;
    await doc.save({ session });
    await recordAudit(
      actor,
      {
        action: 'admission.transfer',
        resource: 'admission',
        resourceId: id,
        patient: doc.patient,
        metadata: { from: open?.bedCode, to: bed.code, reason },
      },
      session,
    );
  });
  announce([String(previousBed), bedId]);
  return getAdmission(id);
}

/** Calendar days between two instants in the hospital timezone. */
function calendarDays(from: Date, to: Date) {
  const a = new Date(`${toHospitalDate(from)}T00:00:00Z`).getTime();
  const b = new Date(`${toHospitalDate(to)}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Discharges the patient, releases the bed for cleaning and raises room
 * charges: one day per calendar day in each bed, with a minimum of one day.
 */
export async function dischargePatient(actor: Actor, id: string, input: DischargeInput) {
  const admission = await Admission.findById(id);
  if (!admission) throw notFound('Admission');
  if (admission.status !== 'admitted') throw conflict('The patient has already been discharged');
  const bedId = admission.bed;

  await runInTransaction(async (session) => {
    const doc = (await Admission.findById(id).session(session))!;
    const now = new Date();
    const open = doc.stays.find((s) => !s.to);
    if (open) open.to = now;
    doc.status = 'discharged';
    doc.dischargedAt = now;
    doc.dischargedBy = actor.userId as never;
    doc.set('dischargeSummary', input);
    await doc.save({ session });
    await releaseBed(bedId, session);

    const stays = doc.stays.map((s) => ({ ...s.toObject(), days: calendarDays(s.from, s.to ?? now) }));
    if (stays.length && stays.every((s) => s.days === 0)) stays[stays.length - 1].days = 1;
    for (const [index, stay] of stays.entries()) {
      if (stay.days <= 0) continue;
      const bed = await Bed.findById(stay.bed).session(session).select('dailyService code');
      await chargeForService(
        actor,
        bed?.dailyService,
        {
          patient: doc.patient,
          quantity: stay.days,
          description: `Bed ${stay.bedCode} (${stay.days} day${stay.days > 1 ? 's' : ''}, ${doc.admissionNumber})`,
          sourceKind: 'admission',
          sourceId: doc._id,
          sourceKey: `admission:${doc.id}:${index}`,
        },
        session,
      );
    }
    await recordAudit(
      actor,
      {
        action: 'admission.discharge',
        resource: 'admission',
        resourceId: id,
        patient: doc.patient,
        metadata: { condition: input.conditionAtDischarge, days: stays.reduce((n, s) => n + s.days, 0) },
      },
      session,
    );
  });
  announce([String(bedId)]);
  return getAdmission(id);
}
