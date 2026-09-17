import { Router } from 'express';
import { z } from 'zod';
import {
  ROLES,
  SERVICE_CATEGORIES,
  doctorProfileSchema,
  doctorProfileUpdateSchema,
  isoDate,
  objectId,
  paginationQuery,
  resetPasswordSchema,
  serviceSchema,
  serviceUpdateSchema,
  settingsUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@hms/shared';
import * as controller from '../controllers/admin.controller.js';
import { requirePermission } from '../middleware/auth.js';
import { idParams, validate } from '../middleware/validate.js';

const includeInactive = z.object({ includeInactive: z.enum(['true', 'false']).optional() });

export const userRouter = Router();
userRouter.get(
  '/',
  requirePermission('user:read'),
  validate({
    query: paginationQuery.extend({ q: z.string().trim().max(60).optional(), role: z.enum(ROLES).optional() }),
  }),
  controller.listUsers,
);
userRouter.get('/roles', requirePermission('user:read'), controller.roleMatrix);
userRouter.post('/', requirePermission('user:manage'), validate({ body: userCreateSchema }), controller.createUser);
userRouter.patch(
  '/:id',
  requirePermission('user:manage'),
  validate({ params: idParams, body: userUpdateSchema }),
  controller.updateUser,
);
userRouter.post(
  '/:id/reset-password',
  requirePermission('user:manage'),
  validate({ params: idParams, body: resetPasswordSchema }),
  controller.resetPassword,
);
userRouter.post('/:id/unlock', requirePermission('user:manage'), validate({ params: idParams }), controller.unlockUser);

export const doctorRouter = Router();
doctorRouter.get('/', requirePermission('doctor:read'), validate({ query: includeInactive }), controller.listDoctors);
doctorRouter.get('/:id', requirePermission('doctor:read'), validate({ params: idParams }), controller.getDoctor);
doctorRouter.get(
  '/:id/slots',
  requirePermission('appointment:read'),
  validate({ params: idParams, query: z.object({ date: isoDate }) }),
  controller.doctorSlots,
);
doctorRouter.post('/', requirePermission('doctor:manage'), validate({ body: doctorProfileSchema }), controller.createDoctor);
doctorRouter.patch(
  '/:id',
  requirePermission('doctor:manage'),
  validate({ params: idParams, body: doctorProfileUpdateSchema }),
  controller.updateDoctor,
);

export const serviceRouter = Router();
serviceRouter.get(
  '/',
  requirePermission('service:read'),
  validate({ query: includeInactive.extend({ category: z.enum(SERVICE_CATEGORIES).optional() }) }),
  controller.listServices,
);
serviceRouter.post('/', requirePermission('service:manage'), validate({ body: serviceSchema }), controller.createService);
serviceRouter.patch(
  '/:id',
  requirePermission('service:manage'),
  validate({ params: idParams, body: serviceUpdateSchema }),
  controller.updateService,
);

export const settingsRouter = Router();
settingsRouter.get('/', controller.getSettings);
settingsRouter.patch('/', requirePermission('settings:manage'), validate({ body: settingsUpdateSchema }), controller.updateSettings);

export const dashboardRouter = Router();
dashboardRouter.get('/', controller.dashboard);

export const notificationRouter = Router();
notificationRouter.get('/', controller.listNotifications);
notificationRouter.post(
  '/read',
  validate({ body: z.object({ ids: z.array(objectId).max(200).optional() }) }),
  controller.markNotificationsRead,
);
