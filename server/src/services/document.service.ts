import { Readable } from 'node:stream';
import mongoose, { Types } from 'mongoose';
import { Patient } from '../models/index.js';
import { badRequest, notFound } from '../utils/errors.js';
import { assertClinicalAccess } from './access.service.js';
import { recordAudit } from './audit.service.js';
import type { Actor } from './actor.js';

export const DOCUMENT_CATEGORIES = [
  'lab_report',
  'imaging',
  'discharge_summary',
  'referral_letter',
  'prescription',
  'consent',
  'other',
] as const;

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const BUCKET = 'patient_documents';

function bucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db!, { bucketName: BUCKET });
}

/** Detects the real file type from its first bytes instead of trusting the browser. */
function detectType(buffer: Buffer): { contentType: string; extension: string } | null {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { contentType: 'application/pdf', extension: 'pdf' };
  if (buffer[0] === 0x89 && buffer.subarray(1, 4).toString('latin1') === 'PNG') {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  return null;
}

interface DocumentMetadata {
  patient: Types.ObjectId;
  category: string;
  title: string;
  originalName: string;
  contentType: string;
  uploadedBy: Types.ObjectId;
  uploadedByName: string;
  voided?: boolean;
  voidReason?: string;
}

export async function uploadDocument(
  actor: Actor,
  patientId: string,
  file: { buffer: Buffer; originalname: string; size: number },
  input: { title: string; category: string },
) {
  if (!(await Patient.exists({ _id: patientId }))) throw notFound('Patient');
  if (file.size > MAX_DOCUMENT_BYTES) throw badRequest('Files must be 10 MB or smaller');
  const type = detectType(file.buffer);
  if (!type) throw badRequest('Only PDF, PNG and JPEG files can be uploaded');

  const metadata: DocumentMetadata = {
    patient: new Types.ObjectId(patientId),
    category: input.category,
    title: input.title,
    originalName: file.originalname.slice(0, 200),
    contentType: type.contentType,
    uploadedBy: new Types.ObjectId(actor.userId),
    uploadedByName: actor.name,
  };
  const filename = `${patientId}-${Date.now()}.${type.extension}`;
  const id = await new Promise<Types.ObjectId>((resolve, reject) => {
    const upload = bucket().openUploadStream(filename, { metadata });
    Readable.from(file.buffer)
      .pipe(upload)
      .on('error', reject)
      .on('finish', () => resolve(upload.id as Types.ObjectId));
  });
  await recordAudit(actor, {
    action: 'document.upload',
    resource: 'document',
    resourceId: id,
    patient: patientId,
    metadata: { category: input.category, size: file.size, contentType: type.contentType },
  });
  return { id: String(id), filename, ...metadata };
}

export async function listDocuments(actor: Actor, patientId: string) {
  await assertClinicalAccess(actor, patientId);
  const files = await bucket()
    .find({ 'metadata.patient': new Types.ObjectId(patientId) })
    .sort({ uploadDate: -1 })
    .toArray();
  return files.map((f) => ({
    id: String(f._id),
    size: f.length,
    uploadedAt: f.uploadDate,
    ...(f.metadata as DocumentMetadata),
  }));
}

export async function openDocument(actor: Actor, patientId: string, documentId: string) {
  await assertClinicalAccess(actor, patientId);
  const [file] = await bucket()
    .find({ _id: new Types.ObjectId(documentId), 'metadata.patient': new Types.ObjectId(patientId) })
    .toArray();
  if (!file) throw notFound('Document');
  const meta = file.metadata as DocumentMetadata;
  await recordAudit(actor, {
    action: 'document.view',
    resource: 'document',
    resourceId: documentId,
    patient: patientId,
  });
  return {
    stream: bucket().openDownloadStream(file._id),
    contentType: meta.contentType,
    size: file.length,
    filename: meta.originalName,
  };
}

/** Documents are never deleted; a voided document stays on record with the reason. */
export async function voidDocument(actor: Actor, patientId: string, documentId: string, reason: string) {
  await assertClinicalAccess(actor, patientId);
  const result = await mongoose.connection.db!.collection(`${BUCKET}.files`).updateOne(
    { _id: new Types.ObjectId(documentId), 'metadata.patient': new Types.ObjectId(patientId) },
    { $set: { 'metadata.voided': true, 'metadata.voidReason': reason } },
  );
  if (result.matchedCount === 0) throw notFound('Document');
  await recordAudit(actor, {
    action: 'document.void',
    resource: 'document',
    resourceId: documentId,
    patient: patientId,
    metadata: { reason },
  });
}
