import { Router } from 'express';
import { z } from 'zod';
import {
  appointmentCreateSchema,
  appointmentListQuery,
  appointmentRescheduleSchema,
  appointmentStatusSchema,
  appointmentUpdateSchema,
  checkInSchema,
  consultationAddendumSchema,
  consultationListQuery,
  consultationStartSchema,
  consultationUpdateSchema,
  objectId,
  prescriptionCreateSchema,
  prescriptionListQuery,
  queueQuery,
  reasonBody,
  referralCreateSchema,
  referralListQuery,
  referralStatusSchema,
  slotQuery,
  tokenActionSchema,
  vitalsSchema,
  walkInSchema,
} from '@hms/shared';
import * as c from '../controllers/opd.controller.js';
import { requirePermission } from '../middleware/auth.js';
import { idParams, validate } from '../middleware/validate.js';

export const appointmentRouter = Router();
appointmentRouter.get('/', requirePermission('appointment:read'), validate({ query: appointmentListQuery }), c.listAppointments);
appointmentRouter.get('/slots', requirePermission('appointment:read'), validate({ query: slotQuery }), c.appointmentSlots);
appointmentRouter.post('/', requirePermission('appointment:manage'), validate({ body: appointmentCreateSchema }), c.createAppointment);
appointmentRouter.get('/:id', requirePermission('appointment:read'), validate({ params: idParams }), c.getAppointment);
appointmentRouter.patch(
  '/:id',
  requirePermission('appointment:manage'),
  validate({ params: idParams, body: appointmentUpdateSchema }),
  c.updateAppointment,
);
appointmentRouter.post(
  '/:id/reschedule',
  requirePermission('appointment:manage'),
  validate({ params: idParams, body: appointmentRescheduleSchema }),
  c.rescheduleAppointment,
);
appointmentRouter.post(
  '/:id/status',
  requirePermission('appointment:manage'),
  validate({ params: idParams, body: appointmentStatusSchema }),
  c.appointmentStatus,
);

export const queueRouter = Router();
queueRouter.get('/', requirePermission('queue:read'), validate({ query: queueQuery }), c.getQueue);
queueRouter.post('/walk-in', requirePermission('queue:manage'), validate({ body: walkInSchema }), c.walkIn);
queueRouter.post('/check-in', requirePermission('queue:manage'), validate({ body: checkInSchema }), c.checkIn);
queueRouter.post(
  '/call-next',
  requirePermission('queue:manage'),
  validate({ body: z.object({ doctor: objectId }) }),
  c.callNext,
);
queueRouter.get('/:id', requirePermission('queue:read'), validate({ params: idParams }), c.getToken);
queueRouter.post(
  '/:id/action',
  requirePermission('queue:manage'),
  validate({ params: idParams, body: tokenActionSchema }),
  c.tokenAction,
);
queueRouter.put(
  '/:id/vitals',
  requirePermission('vitals:write'),
  validate({ params: idParams, body: vitalsSchema }),
  c.recordVitals,
);

export const consultationRouter = Router();
consultationRouter.get(
  '/',
  requirePermission('consultation:read'),
  validate({ query: consultationListQuery }),
  c.listConsultations,
);
consultationRouter.post(
  '/',
  requirePermission('consultation:write'),
  validate({ body: consultationStartSchema }),
  c.startConsultation,
);
consultationRouter.get('/:id', requirePermission('consultation:read'), validate({ params: idParams }), c.getConsultation);
consultationRouter.patch(
  '/:id',
  requirePermission('consultation:write'),
  validate({ params: idParams, body: consultationUpdateSchema }),
  c.updateConsultation,
);
consultationRouter.post(
  '/:id/complete',
  requirePermission('consultation:write'),
  validate({ params: idParams, body: consultationUpdateSchema }),
  c.completeConsultation,
);
consultationRouter.post(
  '/:id/addenda',
  requirePermission('consultation:write'),
  validate({ params: idParams, body: consultationAddendumSchema }),
  c.addAddendum,
);

export const prescriptionRouter = Router();
prescriptionRouter.get(
  '/',
  requirePermission('prescription:read'),
  validate({ query: prescriptionListQuery }),
  c.listPrescriptions,
);
prescriptionRouter.post(
  '/',
  requirePermission('prescription:write'),
  validate({ body: prescriptionCreateSchema }),
  c.createPrescription,
);
prescriptionRouter.get('/:id', requirePermission('prescription:read'), validate({ params: idParams }), c.getPrescription);
prescriptionRouter.post(
  '/:id/cancel',
  requirePermission('prescription:write'),
  validate({ params: idParams, body: reasonBody }),
  c.cancelPrescription,
);

export const referralRouter = Router();
referralRouter.get('/', requirePermission('referral:read'), validate({ query: referralListQuery }), c.listReferrals);
referralRouter.post('/', requirePermission('referral:write'), validate({ body: referralCreateSchema }), c.createReferral);
referralRouter.get('/:id', requirePermission('referral:read'), validate({ params: idParams }), c.getReferral);
referralRouter.post(
  '/:id/status',
  requirePermission('referral:write'),
  validate({ params: idParams, body: referralStatusSchema }),
  c.referralStatus,
);
