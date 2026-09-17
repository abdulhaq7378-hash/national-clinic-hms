import { Types } from 'mongoose';
import {
  calculateAge,
  escapeRegex,
  type MedicalHistoryCreateInput,
  type PatientCreateInput,
  type PatientUpdateInput,
} from '@hms/shared';
import {
  Admission,
  Appointment,
  Consultation,
  Invoice,
  LabOrder,
  MedicalHistory,
  OtBooking,
  Patient,
  Prescription,
  Referral,
} from '../models/index.js';
import { searchPatients } from '../repositories/patient.repository.js';
import { doctorPopulate, userNamePopulate } from '../repositories/populate.js';
import { conflict, notFound } from '../utils/errors.js';
import { assertClinicalAccess, canAccessClinical } from './access.service.js';
import { changedFields, recordAudit } from './audit.service.js';
import { nextUhid } from './counter.service.js';
import type { Actor } from './actor.js';

function dobFromInput(input: { dateOfBirth?: string; ageYears?: number }) {
  if (input.dateOfBirth) return { dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00Z`), dobEstimated: false };
  const now = new Date();
  // Only the age is known: record 1 July of the estimated birth year and flag it as estimated.
  const year = now.getUTCFullYear() - (input.ageYears ?? 0);
  return { dateOfBirth: new Date(Date.UTC(year, 6, 1)), dobEstimated: true };
}

export function withAge<T extends { dateOfBirth?: Date | null }>(patient: T) {
  return { ...patient, age: patient.dateOfBirth ? calculateAge(patient.dateOfBirth) : null };
}

type PatientJson = { id: string; uhid: string; fullName: string; dateOfBirth?: Date } & Record<string, unknown>;

function serialize(doc: InstanceType<typeof Patient>) {
  return withAge(doc.toJSON() as unknown as PatientJson);
}

export async function listPatients(q: string | undefined, page: number, limit: number) {
  const { items, total } = await searchPatients(q, page, limit);
  return { items: items.map(serialize), total };
}

export async function findPossibleDuplicates(phone: string, fullName?: string) {
  const filter: Record<string, unknown> = { $or: [{ phone }, { alternatePhone: phone }] };
  const matches = await Patient.find(filter).select('uhid fullName dateOfBirth gender phone').limit(10);
  const name = fullName?.trim().toLowerCase();
  return matches
    .map(serialize)
    .map((p) => ({ ...p, sameName: name ? p.fullName.toLowerCase() === name : false }));
}

export async function createPatient(actor: Actor, input: PatientCreateInput) {
  const dob = dobFromInput(input);
  const duplicate = await Patient.findOne({
    phone: input.phone,
    dateOfBirth: dob.dateOfBirth,
    fullName: { $regex: `^${escapeRegex(input.fullName.trim())}$`, $options: 'i' },
  }).select('uhid');
  if (duplicate) {
    throw conflict('A patient with the same name, phone and date of birth is already registered', {
      patientId: duplicate.id,
      uhid: duplicate.uhid,
    });
  }

  const { ageYears: _age, dateOfBirth: _dob, ...rest } = input;
  const patient = await Patient.create({
    ...rest,
    ...dob,
    uhid: await nextUhid(),
    registeredBy: actor.userId,
  });
  await recordAudit(actor, {
    action: 'patient.create',
    resource: 'patient',
    resourceId: patient.id,
    patient: patient.id,
    metadata: { uhid: patient.uhid },
  });
  return serialize(patient);
}

export async function getPatient(id: string) {
  const patient = await Patient.findById(id);
  if (!patient) throw notFound('Patient');
  return serialize(patient);
}

export async function getPatientForActor(actor: Actor, id: string) {
  const patient = await getPatient(id);
  const clinicalAccess = actor.permissions.includes('medical:read') ? await canAccessClinical(actor, id) : false;
  let alerts: { allergies: unknown[]; conditions: unknown[] } | null = null;
  if (clinicalAccess) {
    const active = await MedicalHistory.find({
      patient: id,
      status: 'active',
      type: { $in: ['allergy', 'condition'] },
    })
      .select('type title severity')
      .sort({ createdAt: -1 });
    alerts = {
      allergies: active.filter((h) => h.type === 'allergy'),
      conditions: active.filter((h) => h.type === 'condition'),
    };
  }
  return { ...patient, clinicalAccess, alerts };
}

export async function updatePatient(actor: Actor, id: string, input: PatientUpdateInput) {
  const patient = await Patient.findById(id);
  if (!patient) throw notFound('Patient');
  const before = patient.toObject() as Record<string, unknown>;

  const { ageYears, dateOfBirth, ...rest } = input;
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    if (key === 'address' || key === 'emergencyContact') {
      const current = ((patient.toObject() as Record<string, unknown>)[key] ?? {}) as Record<string, unknown>;
      patient.set(key, { ...current, ...(value as Record<string, unknown>) });
    } else {
      patient.set(key, value);
    }
  }
  if (dateOfBirth || ageYears !== undefined) {
    const dob = dobFromInput({ dateOfBirth, ageYears });
    patient.dateOfBirth = dob.dateOfBirth;
    patient.dobEstimated = dob.dobEstimated;
  }
  await patient.save();

  const fields = changedFields(before, patient.toObject() as Record<string, unknown>).filter(
    (f) => !['updatedAt', 'nameTokens'].includes(f),
  );
  await recordAudit(actor, {
    action: 'patient.update',
    resource: 'patient',
    resourceId: id,
    patient: id,
    metadata: { fields },
  });
  return serialize(patient);
}

/* ----------------------------- Medical history ---------------------------- */

export async function listHistory(actor: Actor, patientId: string) {
  await assertClinicalAccess(actor, patientId);
  return MedicalHistory.find({ patient: patientId })
    .populate(userNamePopulate('recordedBy'))
    .populate(userNamePopulate('amendments.by'))
    .sort({ createdAt: -1 });
}

export async function addHistory(
  actor: Actor,
  patientId: string,
  input: MedicalHistoryCreateInput,
  source?: { kind: 'consultation' | 'admission'; id: string },
) {
  await assertClinicalAccess(actor, patientId);
  if (!(await Patient.exists({ _id: patientId }))) throw notFound('Patient');
  const entry = await MedicalHistory.create({
    ...input,
    patient: patientId,
    recordedBy: actor.userId,
    source: source ?? { kind: 'manual' },
  });
  await recordAudit(actor, {
    action: 'medical_history.create',
    resource: 'medical_history',
    resourceId: entry.id,
    patient: patientId,
    metadata: { type: input.type },
  });
  return entry;
}

export async function amendHistory(
  actor: Actor,
  patientId: string,
  entryId: string,
  input: { status: 'active' | 'resolved' | 'entered_in_error'; reason: string },
) {
  await assertClinicalAccess(actor, patientId);
  const entry = await MedicalHistory.findOne({ _id: entryId, patient: patientId });
  if (!entry) throw notFound('History entry');
  if (entry.status === 'entered_in_error') throw conflict('This entry was marked as entered in error and is closed');
  entry.status = input.status;
  entry.amendments.push({ status: input.status, reason: input.reason, by: actor.userId, at: new Date() });
  await entry.save();
  await recordAudit(actor, {
    action: 'medical_history.amend',
    resource: 'medical_history',
    resourceId: entry.id,
    patient: patientId,
    metadata: { status: input.status },
  });
  return entry;
}

/* -------------------------------- Timeline -------------------------------- */

export interface TimelineEvent {
  at: Date;
  kind: string;
  title: string;
  detail?: string;
  status?: string;
  refId: string;
  by?: string;
}

const doctorName = (d: unknown) =>
  ((d as { user?: { name?: string } } | null)?.user?.name as string | undefined) ?? undefined;

/**
 * Unified chronological view of everything recorded for a patient. Each module
 * remains the source of truth; the timeline only reads from them.
 */
export async function getTimeline(actor: Actor, patientId: string, limit = 100) {
  await assertClinicalAccess(actor, patientId);
  const pid = new Types.ObjectId(patientId);
  const canBilling = actor.permissions.includes('billing:read');

  const [appointments, consultations, prescriptions, labOrders, referrals, admissions, history, ot, invoices] =
    await Promise.all([
      Appointment.find({ patient: pid }).populate(doctorPopulate('doctor')).sort({ date: -1 }).limit(limit),
      Consultation.find({ patient: pid }).populate(doctorPopulate('doctor')).sort({ createdAt: -1 }).limit(limit),
      Prescription.find({ patient: pid }).populate(doctorPopulate('doctor')).sort({ createdAt: -1 }).limit(limit),
      LabOrder.find({ patient: pid }).sort({ createdAt: -1 }).limit(limit),
      Referral.find({ patient: pid }).populate(doctorPopulate('referringDoctor')).sort({ createdAt: -1 }).limit(limit),
      Admission.find({ patient: pid }).populate(doctorPopulate('admittingDoctor')).sort({ admittedAt: -1 }).limit(limit),
      MedicalHistory.find({ patient: pid }).populate(userNamePopulate('recordedBy')).sort({ createdAt: -1 }).limit(limit),
      OtBooking.find({ patient: pid }).populate(doctorPopulate('surgeon')).sort({ scheduledStart: -1 }).limit(limit),
      canBilling ? Invoice.find({ patient: pid }).sort({ createdAt: -1 }).limit(limit) : Promise.resolve([]),
    ]);

  const events: TimelineEvent[] = [];
  for (const a of appointments) {
    events.push({
      at: new Date(`${a.date}T${a.startTime}:00+05:30`),
      kind: 'appointment',
      title: `Appointment (${a.type.replace('_', ' ')})`,
      status: a.status,
      refId: a.id,
      by: doctorName(a.doctor),
    });
  }
  for (const c of consultations) {
    events.push({
      at: c.completedAt ?? c.get('createdAt'),
      kind: 'consultation',
      title: c.chiefComplaint ? `Consultation: ${c.chiefComplaint}` : 'Consultation',
      detail: c.diagnoses.map((d) => d.description).join(', ') || undefined,
      status: c.status,
      refId: c.id,
      by: doctorName(c.doctor),
    });
  }
  for (const p of prescriptions) {
    events.push({
      at: p.get('createdAt'),
      kind: 'prescription',
      title: `Prescription ${p.number}`,
      detail: p.items.map((i) => i.medicineName).join(', '),
      status: p.status,
      refId: p.id,
      by: doctorName(p.doctor),
    });
  }
  for (const l of labOrders) {
    events.push({
      at: l.releasedAt ?? l.get('createdAt'),
      kind: 'lab',
      title: `Lab order ${l.orderNumber}`,
      detail: l.items.map((i) => i.testName).join(', '),
      status: l.status,
      refId: l.id,
    });
  }
  for (const r of referrals) {
    events.push({
      at: r.get('createdAt'),
      kind: 'referral',
      title: `Referral to ${r.specialty}`,
      detail: [r.referredToDoctor, r.hospital].filter(Boolean).join(', ') || undefined,
      status: r.status,
      refId: r.id,
      by: doctorName(r.referringDoctor),
    });
  }
  for (const ad of admissions) {
    events.push({
      at: ad.admittedAt,
      kind: 'admission',
      title: `Admitted (${ad.admissionNumber})`,
      detail: ad.reason,
      status: ad.status,
      refId: ad.id,
      by: doctorName(ad.admittingDoctor),
    });
    if (ad.dischargedAt) {
      events.push({
        at: ad.dischargedAt,
        kind: 'discharge',
        title: `Discharged (${ad.admissionNumber})`,
        detail: ad.dischargeSummary?.finalDiagnosis ?? undefined,
        refId: ad.id,
      });
    }
  }
  for (const h of history) {
    events.push({
      at: h.get('createdAt'),
      kind: 'history',
      title: `${h.type.charAt(0).toUpperCase()}${h.type.slice(1)}: ${h.title}`,
      detail: h.details ?? undefined,
      status: h.status,
      refId: h.id,
      by: (h.recordedBy as unknown as { name?: string } | null)?.name,
    });
  }
  for (const o of ot) {
    events.push({
      at: o.scheduledStart,
      kind: 'procedure',
      title: `Procedure: ${o.procedureName}`,
      status: o.status,
      refId: o.id,
      by: doctorName(o.surgeon),
    });
  }
  for (const inv of invoices) {
    events.push({
      at: inv.get('createdAt'),
      kind: 'invoice',
      title: `Invoice ${inv.invoiceNumber}`,
      status: inv.status,
      refId: inv.id,
    });
  }

  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  await recordAudit(actor, { action: 'patient.view_timeline', resource: 'patient', resourceId: patientId, patient: patientId });
  return events.slice(0, limit);
}

/** Clinical context shown to the doctor during a consultation. */
export async function getClinicalSummary(actor: Actor, patientId: string) {
  await assertClinicalAccess(actor, patientId);
  const [history, recentConsultations, recentPrescriptions, labOrders, referrals, admissions] = await Promise.all([
    MedicalHistory.find({ patient: patientId, status: 'active' }).sort({ createdAt: -1 }),
    Consultation.find({ patient: patientId, status: 'completed' })
      .populate(doctorPopulate('doctor'))
      .sort({ completedAt: -1 })
      .limit(10),
    Prescription.find({ patient: patientId, status: { $ne: 'cancelled' } })
      .populate(doctorPopulate('doctor'))
      .sort({ createdAt: -1 })
      .limit(10),
    LabOrder.find({ patient: patientId, status: { $in: ['verified', 'released'] } })
      .sort({ createdAt: -1 })
      .limit(10),
    Referral.find({ patient: patientId }).sort({ createdAt: -1 }).limit(10),
    Admission.find({ patient: patientId }).sort({ admittedAt: -1 }).limit(5),
  ]);

  const allergies = history.filter((h) => h.type === 'allergy');
  const conditions = history.filter((h) => h.type === 'condition');
  const medications = history.filter((h) => h.type === 'medication');
  const diagnoses = recentConsultations.flatMap((c) =>
    c.diagnoses.map((d) => ({ description: d.description, code: d.code, type: d.type, date: c.date })),
  );
  await recordAudit(actor, {
    action: 'patient.view_clinical_summary',
    resource: 'patient',
    resourceId: patientId,
    patient: patientId,
  });

  return {
    allergies,
    conditions,
    medications,
    otherHistory: history.filter((h) => !['allergy', 'condition', 'medication'].includes(h.type)),
    recentConsultations,
    recentPrescriptions,
    diagnoses,
    labOrders,
    referrals,
    admissions,
  };
}
