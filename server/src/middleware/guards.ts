import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { isModuleEnabled, type ModuleName } from '../services/settings.service.js';
import { AppError } from '../utils/errors.js';

const MODULE_LABELS: Record<ModuleName, string> = {
  pharmacy: 'Pharmacy',
  laboratory: 'Laboratory',
  beds: 'Rooms and beds',
  ot: 'Operation theatre',
};

/** Rejects requests to a module that the administrator has switched off. */
export function requireModule(name: ModuleName) {
  return async (_req: Request, _res: Response, next: NextFunction) => {
    if (!(await isModuleEnabled(name))) {
      throw new AppError(403, 'MODULE_DISABLED', `${MODULE_LABELS[name]} module is not enabled`);
    }
    next();
  };
}

const rateLimitBody = (message: string) => ({
  success: false,
  error: { code: 'RATE_LIMITED', message },
});

export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.isTest,
  message: rateLimitBody('Too many requests. Please slow down.'),
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => env.isTest,
  message: rateLimitBody('Too many sign-in attempts. Try again in a few minutes.'),
});
