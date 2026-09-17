import type { Request, Response } from 'express';
import { getActor } from '../middleware/auth.js';
import { body, paramId, query } from '../middleware/validate.js';
import * as beds from '../services/beds.service.js';
import * as billing from '../services/billing.service.js';
import * as lab from '../services/lab.service.js';
import * as ot from '../services/ot.service.js';
import * as pharmacy from '../services/pharmacy.service.js';
import { created, ok, pageMeta } from '../utils/http.js';

type Paged = { page: number; limit: number } & Record<string, string>;

/* --------------------------------- Billing --------------------------------- */

export async function listCharges(req: Request, res: Response) {
  return ok(res, await billing.listCharges(query(req)));
}

export async function pendingChargeSummary(_req: Request, res: Response) {
  return ok(res, await billing.pendingChargeSummary());
}

export async function createCharge(req: Request, res: Response) {
  return created(res, await billing.createManualCharge(getActor(req), body(req)));
}

export async function voidCharge(req: Request, res: Response) {
  return ok(res, await billing.voidCharge(getActor(req), paramId(req), body<{ reason: string }>(req).reason));
}

export async function listInvoices(req: Request, res: Response) {
  const q = query<Paged>(req);
  const { items, total } = await billing.listInvoices(q);
  return ok(res, items, pageMeta(q.page, q.limit, total));
}

export async function createInvoice(req: Request, res: Response) {
  return created(res, await billing.createInvoice(getActor(req), body(req)));
}

export async function getInvoice(req: Request, res: Response) {
  return ok(res, await billing.getInvoice(paramId(req)));
}

export async function addPayment(req: Request, res: Response) {
  return ok(res, await billing.recordPayment(getActor(req), paramId(req), body(req)));
}

export async function addRefund(req: Request, res: Response) {
  return ok(res, await billing.recordRefund(getActor(req), paramId(req), body(req)));
}

export async function cancelInvoice(req: Request, res: Response) {
  return ok(res, await billing.cancelInvoice(getActor(req), paramId(req), body<{ reason: string }>(req).reason));
}

/* --------------------------------- Pharmacy -------------------------------- */

export async function listInventory(req: Request, res: Response) {
  const q = query<Paged & { filter: 'all' }>(req);
  const { items, total } = await pharmacy.listInventory(q);
  return ok(res, items, pageMeta(q.page, q.limit, total));
}

export async function searchMedicines(req: Request, res: Response) {
  return ok(res, await pharmacy.searchMedicinesForPrescribing(query<{ q: string }>(req).q));
}

export async function inventoryAlerts(_req: Request, res: Response) {
  return ok(res, await pharmacy.inventoryAlerts());
}

export async function getMedicine(req: Request, res: Response) {
  return ok(res, await pharmacy.getMedicine(paramId(req)));
}

export async function createMedicine(req: Request, res: Response) {
  return created(res, await pharmacy.createMedicine(getActor(req), body(req)));
}

export async function updateMedicine(req: Request, res: Response) {
  return ok(res, await pharmacy.updateMedicine(getActor(req), paramId(req), body(req)));
}

export async function stockIn(req: Request, res: Response) {
  return created(res, await pharmacy.stockIn(getActor(req), body(req)));
}

export async function adjustStock(req: Request, res: Response) {
  return created(res, await pharmacy.adjustStock(getActor(req), body(req)));
}

export async function dispense(req: Request, res: Response) {
  return created(res, await pharmacy.dispense(getActor(req), body(req)));
}

export async function listTransactions(req: Request, res: Response) {
  const q = query<Paged>(req);
  const { items, total } = await pharmacy.listTransactions(q);
  return ok(res, items, pageMeta(q.page, q.limit, total));
}

/* -------------------------------- Laboratory ------------------------------- */

export async function listLabTests(req: Request, res: Response) {
  return ok(res, await lab.listLabTests(query<{ includeInactive?: string }>(req).includeInactive === 'true'));
}

export async function createLabTest(req: Request, res: Response) {
  return created(res, await lab.createLabTest(getActor(req), body(req)));
}

export async function updateLabTest(req: Request, res: Response) {
  return ok(res, await lab.updateLabTest(getActor(req), paramId(req), body(req)));
}

export async function listLabOrders(req: Request, res: Response) {
  const q = query<Paged>(req);
  const { items, total } = await lab.listLabOrders(getActor(req), q);
  return ok(res, items, pageMeta(q.page, q.limit, total));
}

export async function createLabOrder(req: Request, res: Response) {
  return created(res, await lab.createLabOrder(getActor(req), body(req)));
}

export async function getLabOrder(req: Request, res: Response) {
  return ok(res, await lab.getLabOrder(getActor(req), paramId(req)));
}

export async function collectSample(req: Request, res: Response) {
  return ok(res, await lab.collectSample(getActor(req), paramId(req), body<{ note?: string }>(req).note));
}

export async function startProcessing(req: Request, res: Response) {
  return ok(res, await lab.startProcessing(getActor(req), paramId(req)));
}

export async function enterResults(req: Request, res: Response) {
  return ok(res, await lab.enterResults(getActor(req), paramId(req), body(req)));
}

export async function verifyResults(req: Request, res: Response) {
  return ok(res, await lab.verifyResults(getActor(req), paramId(req)));
}

export async function releaseReport(req: Request, res: Response) {
  return ok(res, await lab.releaseReport(getActor(req), paramId(req)));
}

export async function amendResults(req: Request, res: Response) {
  const { reason, ...results } = body<{ reason: string; items: never }>(req);
  return ok(res, await lab.amendResults(getActor(req), paramId(req), reason, results));
}

export async function cancelLabOrder(req: Request, res: Response) {
  return ok(res, await lab.cancelLabOrder(getActor(req), paramId(req), body<{ reason: string }>(req).reason));
}

/* ------------------------------ Wards and beds ------------------------------ */

export async function listWards(req: Request, res: Response) {
  return ok(res, await beds.listWards(query<{ includeInactive?: string }>(req).includeInactive === 'true'));
}

export async function createWard(req: Request, res: Response) {
  return created(res, await beds.createWard(getActor(req), body(req)));
}

export async function updateWard(req: Request, res: Response) {
  return ok(res, await beds.updateWard(getActor(req), paramId(req), body(req)));
}

export async function createRoom(req: Request, res: Response) {
  return created(res, await beds.createRoom(getActor(req), { ...body<object>(req), ward: paramId(req) } as never));
}

export async function bedBoard(_req: Request, res: Response) {
  return ok(res, await beds.getBedBoard());
}

export async function createBed(req: Request, res: Response) {
  return created(res, await beds.createBed(getActor(req), body(req)));
}

export async function updateBed(req: Request, res: Response) {
  return ok(res, await beds.updateBed(getActor(req), paramId(req), body(req)));
}

export async function bedStatus(req: Request, res: Response) {
  const { status, note } = body<{ status: string; note?: string }>(req);
  return ok(res, await beds.setBedStatus(getActor(req), paramId(req), status, note));
}

export async function listAdmissions(req: Request, res: Response) {
  const q = query<Paged>(req);
  const { items, total } = await beds.listAdmissions(getActor(req), q);
  return ok(res, items, pageMeta(q.page, q.limit, total));
}

export async function admit(req: Request, res: Response) {
  return created(res, await beds.admitPatient(getActor(req), body(req)));
}

export async function getAdmission(req: Request, res: Response) {
  return ok(res, await beds.getAdmission(paramId(req), getActor(req)));
}

export async function transfer(req: Request, res: Response) {
  const { bed, reason } = body<{ bed: string; reason: string }>(req);
  return ok(res, await beds.transferBed(getActor(req), paramId(req), bed, reason));
}

export async function discharge(req: Request, res: Response) {
  return ok(res, await beds.dischargePatient(getActor(req), paramId(req), body(req)));
}

/* ---------------------------- Operation theatre ---------------------------- */

export async function listOt(req: Request, res: Response) {
  const q = query<Paged>(req);
  const { items, total } = await ot.listOtBookings(q);
  return ok(res, items, pageMeta(q.page, q.limit, total));
}

export async function createOt(req: Request, res: Response) {
  return created(res, await ot.createOtBooking(getActor(req), body(req)));
}

export async function getOt(req: Request, res: Response) {
  return ok(res, await ot.getOtBooking(paramId(req)));
}

export async function updateOt(req: Request, res: Response) {
  return ok(res, await ot.updateOtBooking(getActor(req), paramId(req), body(req)));
}

export async function otStatus(req: Request, res: Response) {
  const { status, note } = body<{ status: never; note?: string }>(req);
  return ok(res, await ot.changeOtStatus(getActor(req), paramId(req), status, note));
}
