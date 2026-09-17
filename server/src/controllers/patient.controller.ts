import type { Request, Response } from 'express';
import { getActor } from '../middleware/auth.js';
import { body, paramId, query } from '../middleware/validate.js';
import { Token } from '../models/index.js';
import { doctorPopulate } from '../repositories/populate.js';
import { grantEmergencyAccess } from '../services/access.service.js';
import * as documents from '../services/document.service.js';
import * as patients from '../services/patient.service.js';
import { badRequest } from '../utils/errors.js';
import { created, ok, pageMeta } from '../utils/http.js';

export async function list(req: Request, res: Response) {
  const q = query<{ q?: string; page: number; limit: number }>(req);
  const { items, total } = await patients.listPatients(q.q, q.page, q.limit);
  return ok(res, items, pageMeta(q.page, q.limit, total));
}

export async function duplicates(req: Request, res: Response) {
  const q = query<{ phone: string; name?: string }>(req);
  return ok(res, await patients.findPossibleDuplicates(q.phone, q.name));
}

export async function create(req: Request, res: Response) {
  return created(res, await patients.createPatient(getActor(req), body(req)));
}

export async function get(req: Request, res: Response) {
  return ok(res, await patients.getPatientForActor(getActor(req), paramId(req)));
}

export async function update(req: Request, res: Response) {
  return ok(res, await patients.updatePatient(getActor(req), paramId(req), body(req)));
}

export async function timeline(req: Request, res: Response) {
  return ok(res, await patients.getTimeline(getActor(req), paramId(req)));
}

export async function clinicalSummary(req: Request, res: Response) {
  return ok(res, await patients.getClinicalSummary(getActor(req), paramId(req)));
}

export async function history(req: Request, res: Response) {
  return ok(res, await patients.listHistory(getActor(req), paramId(req)));
}

export async function addHistory(req: Request, res: Response) {
  return created(res, await patients.addHistory(getActor(req), paramId(req), body(req)));
}

export async function amendHistory(req: Request, res: Response) {
  const { entryId } = req.valid!.params as { entryId: string };
  return ok(res, await patients.amendHistory(getActor(req), paramId(req), entryId, body(req)));
}

export async function emergencyAccess(req: Request, res: Response) {
  const { reason } = body<{ reason: string }>(req);
  return created(res, await grantEmergencyAccess(getActor(req), paramId(req), reason));
}

export async function visits(req: Request, res: Response) {
  const tokens = await Token.find({ patient: paramId(req) })
    .select('date number status visitType priority checkedInAt completedAt doctor appointment consultation')
    .populate(doctorPopulate('doctor'))
    .sort({ checkedInAt: -1 })
    .limit(100);
  return ok(res, tokens);
}

export async function listDocuments(req: Request, res: Response) {
  return ok(res, await documents.listDocuments(getActor(req), paramId(req)));
}

export async function uploadDocument(req: Request, res: Response) {
  const file = req.file;
  if (!file) throw badRequest('Choose a file to upload');
  const input = body<{ title: string; category: string }>(req);
  return created(res, await documents.uploadDocument(getActor(req), paramId(req), file, input));
}

export async function downloadDocument(req: Request, res: Response) {
  const { documentId } = req.valid!.params as { documentId: string };
  const doc = await documents.openDocument(getActor(req), paramId(req), documentId);
  res.setHeader('Content-Type', doc.contentType);
  res.setHeader('Content-Length', String(doc.size));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(doc.filename).replace(/"/g, '')}"`,
  );
  doc.stream.on('error', () => res.destroy()).pipe(res);
}

export async function voidDocument(req: Request, res: Response) {
  const { documentId } = req.valid!.params as { documentId: string };
  const { reason } = body<{ reason: string }>(req);
  await documents.voidDocument(getActor(req), paramId(req), documentId, reason);
  return ok(res, { voided: true });
}
