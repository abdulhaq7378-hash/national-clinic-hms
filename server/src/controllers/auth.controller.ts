import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env.js';
import { clientInfo, getActor } from '../middleware/auth.js';
import { body } from '../middleware/validate.js';
import * as auth from '../services/auth.service.js';
import { User } from '../models/index.js';
import { ok } from '../utils/http.js';
import { unauthorized } from '../utils/errors.js';

export const REFRESH_COOKIE = 'hms_rt';

function cookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api/auth',
    expires,
  };
}

export async function login(req: Request, res: Response) {
  const { email, password } = body<{ email: string; password: string }>(req);
  const result = await auth.login(email, password, clientInfo(req));
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions(result.expiresAt));
  return ok(res, { accessToken: result.accessToken, user: result.user });
}

export async function refresh(req: Request, res: Response) {
  try {
    const result = await auth.refresh(req.cookies?.[REFRESH_COOKIE], clientInfo(req));
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions(result.expiresAt));
    return ok(res, { accessToken: result.accessToken, user: result.user });
  } catch (err) {
    if ((err as { code?: string }).code !== 'REFRESH_RACE') res.clearCookie(REFRESH_COOKIE, cookieOptions());
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  await auth.logout(req.cookies?.[REFRESH_COOKIE], req.actor);
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  return ok(res, { loggedOut: true });
}

export async function me(req: Request, res: Response) {
  const actor = getActor(req);
  const user = await User.findById(actor.userId);
  if (!user) throw unauthorized();
  return ok(res, await auth.publicUser(user));
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = body<{ currentPassword: string; newPassword: string }>(req);
  await auth.changePassword(getActor(req), currentPassword, newPassword);
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  return ok(res, { changed: true });
}
