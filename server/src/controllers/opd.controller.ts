import type { Request, Response } from 'express';
import { getActor } from '../middleware/auth.js';
import { body, paramId, query } from '../middleware/validate.js';
import * as appointments from '../services/appointment.service.js';
import * as consultations from '../services/consultation.service.js';
import * as doctors from '../services/doctor.service.js';
import * as prescriptions from '../services/prescription.service.js';
import * as queue from '../services/queue.service.js';
import * as referrals from '../services/referral.service.js';
import { created, ok, pageMeta } from '../utils/http.js';

type Paged = { page: number; limit: number };

/* ------------------------------- Appointments ------------------------------ */

export async function listAppointments(req: Request, res: Response) {
  const q = query<Paged & Record<string, string>>(req);
  const { items, total } = await appointments.listAppointments(q);
  return ok(res, items, pageMeta(q.page, q.limit, total));
}

export async function appointmentSlots(req: Request, res: Response) {
  const q = query<{ doctor: string; date: string }>(req);
  return ok(res, await doctors.getSlots(q.doctor, q.date));
}

export async function createAppointment(req: Request, res: Response) {
  return created(res, await appointments.createAppointment(getActor(req), body(req)));
}

export async function getAppointment(req: Request, res: Response) {
  return ok(res, await appointments.getAppointment(paramId(req)));
}

export async function updateAppointment(req: Request, res: Response) {
  return ok(res, await appointments.updateAppointmentDetails(getActor(req), paramId(req), body(req)));
}

export async function rescheduleAppointment(req: Request, res: Response) {
  return ok(res, await appointments.rescheduleAppointment(getActor(req), paramId(req), body(req)));
}

export async function appointmentStatus(req: Request, res: Response) {
  const { status, reason } = body<{ status: 'confirmed' | 'cancelled' | 'no_show'; reason?: string }>(req);
  return ok(res, await appointments.changeAppointmentStatus(getActor(req), paramId(req), status, reason));
}

/* ---------------------------------- Queue ---------------------------------- */

export async function getQueue(req: Request, res: Response) {
  return ok(res, await queue.getQueue(query(req)));
}

export async function walkIn(req: Request, res: Response) {
  return created(res, await queue.registerWalkIn(getActor(req), body(req)));
}

export async function checkIn(req: Request, res: Response) {
  return created(res, await queue.checkInAppointment(getActor(req), body<{ appointment: string }>(req).appointment));
}

export async function callNext(req: Request, res: Response) {
  return ok(res, await queue.callNext(getActor(req), body<{ doctor: string }>(req).doctor));
}

export async function getToken(req: Request, res: Response) {
  return ok(res, await queue.getToken(paramId(req)));
}

export async function tokenAction(req: Request, res: Response) {
  const { action, reason } = body<{ action: 'call' | 'complete' | 'skip' | 'requeue' | 'cancel'; reason?: string }>(req);
  return ok(res, await queue.applyTokenAction(getActor(req), paramId(req), action, reason));
}

export async function recordVitals(req: Request, res: Response) {
  return ok(res, await queue.recordVitals(getActor(req), paramId(req), body(req)));
}

/* ------------------------------ Consultations ------------------------------ */

export async function listConsultations(req: Request, res: Response) {
  const q = query<Paged & Record<string, string>>(req);
  const { items, total } = await consultations.listConsultations(getActor(req), q);
  return ok(res, items, pageMeta(q.page, q.limit, total));
}

export async function startConsultation(req: Request, res: Response) {
  return created(res, await consultations.startConsultation(getActor(req), body(req)));
}

export async function getConsultation(req: Request, res: Response) {
  return ok(res, await consultations.getConsultation(getActor(req), paramId(req)));
}

export async function updateConsultation(req: Request, res: Response) {
  return ok(res, await consultations.updateConsultation(getActor(req), paramId(req), body(req)));
}

export async function completeConsultation(req: Request, res: Response) {
  return ok(res, await consultations.completeConsultation(getActor(req), paramId(req), body(req)));
}

export async function addAddendum(req: Request, res: Response) {
  return ok(res, await consultations.addAddendum(getActor(req), paramId(req), body<{ text: string }>(req).text));
}

/* ------------------------------ Prescriptions ------------------------------ */

export async function listPrescriptions(req: Request, res: Response) {
  const q = query<Paged & Record<string, string>>(req);
  const { items, total } = await prescriptions.listPrescriptions(getActor(req), q);
  return ok(res, items, pageMeta(q.page, q.limit, total));
}

export async function createPrescription(req: Request, res: Response) {
  return created(res, await prescriptions.createPrescription(getActor(req), body(req)));
}

export async function getPrescription(req: Request, res: Response) {
  return ok(res, await prescriptions.getPrescription(getActor(req), paramId(req)));
}

export async function cancelPrescription(req: Request, res: Response) {
  return ok(res, await prescriptions.cancelPrescription(getActor(req), paramId(req), body<{ reason: string }>(req).reason));
}

/* -------------------------------- Referrals -------------------------------- */

export async function listReferrals(req: Request, res: Response) {
  const q = query<Paged & Record<string, string>>(req);
  const { items, total } = await referrals.listReferrals(getActor(req), q);
  return ok(res, items, pageMeta(q.page, q.limit, total));
}

export async function createReferral(req: Request, res: Response) {
  return created(res, await referrals.createReferral(getActor(req), body(req)));
}

export async function getReferral(req: Request, res: Response) {
  return ok(res, await referrals.getReferral(getActor(req), paramId(req)));
}

export async function referralStatus(req: Request, res: Response) {
  const { status, note } = body<{ status: never; note?: string }>(req);
  return ok(res, await referrals.updateReferralStatus(getActor(req), paramId(req), status, note));
}
