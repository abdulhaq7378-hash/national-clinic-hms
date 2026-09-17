import type { Request, Response } from 'express';
import { ROLE_LABELS, ROLE_PERMISSIONS, ROLES } from '@hms/shared';
import { getActor } from '../middleware/auth.js';
import { body, paramId, query } from '../middleware/validate.js';
import * as catalog from '../services/catalog.service.js';
import * as doctors from '../services/doctor.service.js';
import * as notifications from '../services/notification.service.js';
import * as settings from '../services/settings.service.js';
import * as users from '../services/user.service.js';
import { getDashboard } from '../services/dashboard.service.js';
import { forbidden } from '../utils/errors.js';
import { created, ok, pageMeta } from '../utils/http.js';

/* ---------------------------------- Users ---------------------------------- */

export async function listUsers(req: Request, res: Response) {
  const q = query<{ q?: string; role?: string; page: number; limit: number }>(req);
  const { items, total } = await users.listUsers(q);
  return ok(res, items, pageMeta(q.page, q.limit, total));
}

export async function createUser(req: Request, res: Response) {
  return created(res, await users.createUser(getActor(req), body(req)));
}

export async function updateUser(req: Request, res: Response) {
  return ok(res, await users.updateUser(getActor(req), paramId(req), body(req)));
}

export async function resetPassword(req: Request, res: Response) {
  await users.resetUserPassword(getActor(req), paramId(req), body<{ newPassword: string }>(req).newPassword);
  return ok(res, { reset: true });
}

export async function unlockUser(req: Request, res: Response) {
  await users.unlockUser(getActor(req), paramId(req));
  return ok(res, { unlocked: true });
}

export function roleMatrix(_req: Request, res: Response) {
  return ok(
    res,
    ROLES.map((role) => ({ role, label: ROLE_LABELS[role], permissions: ROLE_PERMISSIONS[role] })),
  );
}

/* --------------------------------- Doctors --------------------------------- */

export async function listDoctors(req: Request, res: Response) {
  const { includeInactive } = query<{ includeInactive?: string }>(req);
  const actor = getActor(req);
  if (includeInactive === 'true' && !actor.permissions.includes('doctor:manage')) throw forbidden();
  return ok(res, await doctors.listDoctors(includeInactive === 'true'));
}

export async function getDoctor(req: Request, res: Response) {
  return ok(res, await doctors.getDoctor(paramId(req)));
}

export async function doctorSlots(req: Request, res: Response) {
  const { date } = query<{ date: string }>(req);
  return ok(res, await doctors.getSlots(paramId(req), date));
}

export async function createDoctor(req: Request, res: Response) {
  return created(res, await doctors.createDoctorProfile(getActor(req), body(req)));
}

export async function updateDoctor(req: Request, res: Response) {
  return ok(res, await doctors.updateDoctorProfile(getActor(req), paramId(req), body(req)));
}

/* ------------------------------ Price list ------------------------------ */

export async function listServices(req: Request, res: Response) {
  const q = query<{ category?: string; includeInactive?: string }>(req);
  return ok(res, await catalog.listServices({ category: q.category, includeInactive: q.includeInactive === 'true' }));
}

export async function createService(req: Request, res: Response) {
  return created(res, await catalog.createService(getActor(req), body(req)));
}

export async function updateService(req: Request, res: Response) {
  return ok(res, await catalog.updateService(getActor(req), paramId(req), body(req)));
}

/* ------------------------------- Settings ------------------------------- */

export async function getSettings(_req: Request, res: Response) {
  return ok(res, await settings.getSettings());
}

export async function updateSettings(req: Request, res: Response) {
  return ok(res, await settings.updateSettings(getActor(req), body(req)));
}

/* ------------------------ Dashboard and notifications ------------------------ */

export async function dashboard(req: Request, res: Response) {
  return ok(res, await getDashboard(getActor(req)));
}

export async function listNotifications(req: Request, res: Response) {
  return ok(res, await notifications.listNotifications(getActor(req)));
}

export async function markNotificationsRead(req: Request, res: Response) {
  const { ids } = body<{ ids?: string[] }>(req);
  await notifications.markNotificationsRead(getActor(req), ids);
  return ok(res, { updated: true });
}
