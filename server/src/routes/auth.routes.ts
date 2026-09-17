import { Router, type NextFunction, type Request, type Response } from 'express';
import { changePasswordSchema, loginSchema } from '@hms/shared';
import * as controller from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/guards.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../utils/errors.js';

/**
 * Cookie-authenticated endpoints require a custom header. Browsers cannot send it
 * cross-site without a CORS preflight, which adds CSRF protection on top of SameSite.
 */
function requireAppHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.get('x-requested-with') !== 'hms') throw new AppError(403, 'FORBIDDEN', 'Missing request header');
  next();
}

export const authRouter = Router();

authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), controller.login);
authRouter.post('/refresh', requireAppHeader, controller.refresh);
authRouter.post('/logout', requireAppHeader, async (req, res, next) => {
  // Logout works with or without a valid access token.
  if (req.get('authorization')) {
    try {
      await authenticate(req, res, () => undefined);
    } catch {
      req.actor = undefined;
    }
  }
  return controller.logout(req, res).catch(next);
});
authRouter.get('/me', authenticate, controller.me);
authRouter.post('/change-password', authenticate, validate({ body: changePasswordSchema }), controller.changePassword);
