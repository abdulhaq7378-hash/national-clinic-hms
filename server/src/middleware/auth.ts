import type { NextFunction, Request, Response } from 'express';
import { ROLE_PERMISSIONS, type Permission } from '@hms/shared';
import { doctorIdForUser, verifyAccessToken } from '../services/auth.service.js';
import { loadAuthUser } from '../services/user-cache.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import type { Actor } from '../services/actor.js';

export function clientInfo(req: Request) {
  return { ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) };
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const payload = verifyAccessToken(header.slice(7));
  const user = await loadAuthUser(payload.sub);
  if (!user || !user.isActive) throw unauthorized('Account is not active');
  if (user.passwordChangedAt && payload.iat * 1000 < user.passwordChangedAt - 1000) {
    throw unauthorized('Session expired. Please sign in again.');
  }
  const actor: Actor = {
    userId: payload.sub,
    name: user.name,
    role: user.role,
    permissions: ROLE_PERMISSIONS[user.role],
    doctorId: await doctorIdForUser(payload.sub),
    ...clientInfo(req),
  };
  req.actor = actor;
  next();
}

/** Requires every listed permission. */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const actor = req.actor;
    if (!actor) throw unauthorized();
    if (permissions.some((p) => !actor.permissions.includes(p))) throw forbidden();
    next();
  };
}

/** Requires at least one of the listed permissions. */
export function requireAnyPermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const actor = req.actor;
    if (!actor) throw unauthorized();
    if (!permissions.some((p) => actor.permissions.includes(p))) throw forbidden();
    next();
  };
}

export function getActor(req: Request): Actor {
  if (!req.actor) throw unauthorized();
  return req.actor;
}
