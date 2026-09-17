import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  medicalHistoryAmendSchema,
  medicalHistoryCreateSchema,
  objectId,
  patientCreateSchema,
  patientSearchQuery,
  patientUpdateSchema,
  phone,
  reasonBody,
  requiredText,
} from '@hms/shared';
import * as controller from '../controllers/patient.controller.js';
import { requireAnyPermission, requirePermission } from '../middleware/auth.js';
import { idParams, validate } from '../middleware/validate.js';
import { DOCUMENT_CATEGORIES, MAX_DOCUMENT_BYTES } from '../services/document.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
});

const documentParams = z.object({ id: objectId, documentId: objectId });
const historyParams = z.object({ id: objectId, entryId: objectId });

export const patientRouter = Router();

patientRouter.get('/', requirePermission('patient:read'), validate({ query: patientSearchQuery }), controller.list);
patientRouter.get(
  '/duplicates',
  requirePermission('patient:read'),
  validate({ query: z.object({ phone, name: z.string().trim().max(150).optional() }) }),
  controller.duplicates,
);
patientRouter.post('/', requirePermission('patient:create'), validate({ body: patientCreateSchema }), controller.create);
patientRouter.get('/:id', requirePermission('patient:read'), validate({ params: idParams }), controller.get);
patientRouter.patch(
  '/:id',
  requirePermission('patient:update'),
  validate({ params: idParams, body: patientUpdateSchema }),
  controller.update,
);
patientRouter.get(
  '/:id/visits',
  requirePermission('patient:read', 'queue:read'),
  validate({ params: idParams }),
  controller.visits,
);

// Clinical record
patientRouter.get('/:id/timeline', requirePermission('medical:read'), validate({ params: idParams }), controller.timeline);
patientRouter.get(
  '/:id/clinical-summary',
  requirePermission('medical:read'),
  validate({ params: idParams }),
  controller.clinicalSummary,
);
patientRouter.get('/:id/history', requirePermission('medical:read'), validate({ params: idParams }), controller.history);
patientRouter.post(
  '/:id/history',
  requirePermission('medical:write'),
  validate({ params: idParams, body: medicalHistoryCreateSchema }),
  controller.addHistory,
);
patientRouter.post(
  '/:id/history/:entryId/amend',
  requirePermission('medical:write'),
  validate({ params: historyParams, body: medicalHistoryAmendSchema }),
  controller.amendHistory,
);
patientRouter.post(
  '/:id/emergency-access',
  requirePermission('medical:read'),
  validate({ params: idParams, body: reasonBody }),
  controller.emergencyAccess,
);

// Documents
patientRouter.get(
  '/:id/documents',
  requirePermission('medical:read'),
  validate({ params: idParams }),
  controller.listDocuments,
);
patientRouter.post(
  '/:id/documents',
  requireAnyPermission('medical:write', 'patient:update'),
  upload.single('file'),
  validate({
    params: idParams,
    body: z.object({ title: requiredText(150, 'Title'), category: z.enum(DOCUMENT_CATEGORIES) }),
  }),
  controller.uploadDocument,
);
patientRouter.get(
  '/:id/documents/:documentId',
  requirePermission('medical:read'),
  validate({ params: documentParams }),
  controller.downloadDocument,
);
patientRouter.post(
  '/:id/documents/:documentId/void',
  requirePermission('medical:write'),
  validate({ params: documentParams, body: reasonBody }),
  controller.voidDocument,
);
