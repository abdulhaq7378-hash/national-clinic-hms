import {
  REALTIME_EVENTS,
  suggestQuantity,
  toHospitalDate,
  type PrescriptionCreateInput,
} from '@hms/shared';
import { Consultation, Medicine, Prescription } from '../models/index.js';
import { publish } from '../realtime/event-bus.js';
import { doctorPopulate, userNamePopulate } from '../repositories/populate.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { skipFor } from '../utils/http.js';
import { assertClinicalAccess } from './access.service.js';
import { recordAudit } from './audit.service.js';
import { nextDocumentNumber } from './counter.service.js';
import type { Actor } from './actor.js';

const COUNTABLE_FORMS = ['tablet', 'capsule'];

export const PRESCRIPTION_POPULATE = [
  { path: 'patient', select: 'uhid fullName gender dateOfBirth phone' },
  doctorPopulate('doctor'),
  { path: 'consultation', select: 'date chiefComplaint diagnoses vitals followUpDate advice' },
  userNamePopulate('statusHistory.by'),
];

/**
 * Pharmacy staff read prescriptions without general access to clinical records.
 * Doctors are additionally subject to the care-relationship rule.
 */
async function assertPrescriptionAccess(actor: Actor, patientId: string) {
  if (actor.role === 'doctor') await assertClinicalAccess(actor, patientId);
}

export async function getPrescription(actor: Actor, id: string) {
  const prescription = await Prescription.findById(id).populate(PRESCRIPTION_POPULATE);
  if (!prescription) throw notFound('Prescription');
  await assertPrescriptionAccess(actor, String((prescription.patient as unknown as { _id: unknown })._id));
  return prescription;
}

export async function listPrescriptions(
  actor: Actor,
  q: { patient?: string; doctor?: string; status?: string; pending?: string; q?: string; page: number; limit: number },
) {
  const filter: Record<string, unknown> = {};
  if (q.patient) {
    await assertPrescriptionAccess(actor, q.patient);
    filter.patient = q.patient;
  } else if (actor.role === 'doctor') {
    filter.doctor = actor.doctorId ?? null;
  }
  if (q.doctor && actor.role !== 'doctor') filter.doctor = q.doctor;
  if (q.status) filter.status = q.status;
  if (q.pending === 'true') filter.status = { $in: ['active', 'partially_dispensed'] };
  if (q.q) filter.number = { $regex: q.q.toUpperCase().replace(/[^A-Z0-9-]/g, '') };
  const [items, total] = await Promise.all([
    Prescription.find(filter)
      .populate(PRESCRIPTION_POPULATE.slice(0, 2))
      .sort({ createdAt: -1 })
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit),
    Prescription.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createPrescription(actor: Actor, input: PrescriptionCreateInput) {
  if (!actor.doctorId) throw forbidden('Only doctors can issue prescriptions');
  const consultation = await Consultation.findById(input.consultation).select('patient doctor status');
  if (!consultation) throw notFound('Consultation');
  if (String(consultation.doctor) !== actor.doctorId) {
    throw forbidden('Prescriptions can only be added to your own consultations');
  }

  const medicineIds = input.items.filter((i) => i.medicine).map((i) => i.medicine!);
  const medicines = await Medicine.find({ _id: { $in: medicineIds } });
  const byId = new Map(medicines.map((m) => [m.id, m]));

  const items = input.items.map((item) => {
    const medicine = item.medicine ? byId.get(item.medicine) : undefined;
    if (item.medicine && !medicine) throw badRequest(`Medicine "${item.medicineName}" is not in the pharmacy catalog`);
    const form = medicine?.form ?? item.form;
    const quantity =
      item.quantity ??
      (COUNTABLE_FORMS.includes(form) ? suggestQuantity(item.frequency, item.durationValue, item.durationUnit) : null);
    return {
      ...item,
      medicine: medicine?._id,
      medicineName: medicine?.name ?? item.medicineName,
      strength: item.strength ?? medicine?.strength,
      form,
      quantity: quantity ?? undefined,
      dispensedQuantity: 0,
    };
  });

  const prescription = await Prescription.create({
    number: await nextDocumentNumber('RX'),
    patient: consultation.patient,
    doctor: actor.doctorId,
    consultation: consultation._id,
    date: toHospitalDate(),
    items,
    notes: input.notes ?? undefined,
    status: 'active',
    createdBy: actor.userId,
    statusHistory: [{ status: 'active', by: actor.userId, at: new Date() }],
  });

  await recordAudit(actor, {
    action: 'prescription.create',
    resource: 'prescription',
    resourceId: prescription.id,
    patient: consultation.patient,
    metadata: { number: prescription.number, items: items.length, consultation: consultation.id },
  });
  publish({
    type: REALTIME_EVENTS.prescriptionChanged,
    payload: { id: prescription.id },
    permission: 'prescription:read',
  });
  return getPrescription(actor, prescription.id);
}

export async function cancelPrescription(actor: Actor, id: string, reason: string) {
  const prescription = await Prescription.findById(id);
  if (!prescription) throw notFound('Prescription');
  if (actor.role !== 'admin' && String(prescription.doctor) !== actor.doctorId) {
    throw forbidden('Only the prescribing doctor can cancel this prescription');
  }
  if (prescription.status !== 'active' || prescription.items.some((i) => (i.dispensedQuantity ?? 0) > 0)) {
    throw conflict('Prescriptions that have been dispensed cannot be cancelled');
  }
  prescription.status = 'cancelled';
  prescription.statusHistory.push({ status: 'cancelled', by: actor.userId, at: new Date(), note: reason });
  await prescription.save();
  await recordAudit(actor, {
    action: 'prescription.cancel',
    resource: 'prescription',
    resourceId: id,
    patient: prescription.patient,
    metadata: { reason },
  });
  publish({ type: REALTIME_EVENTS.prescriptionChanged, payload: { id }, permission: 'prescription:read' });
  return getPrescription(actor, id);
}
