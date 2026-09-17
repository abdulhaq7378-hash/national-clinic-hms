import { Router } from 'express';
import mongoose from 'mongoose';
import { authenticate } from '../middleware/auth.js';
import { eventStream } from '../realtime/sse.js';
import { getDbState } from '../db/connection.js';
import { authRouter } from './auth.routes.js';
import { patientRouter } from './patient.routes.js';
import {
  dashboardRouter,
  doctorRouter,
  notificationRouter,
  serviceRouter,
  settingsRouter,
  userRouter,
} from './admin.routes.js';
import {
  appointmentRouter,
  consultationRouter,
  prescriptionRouter,
  queueRouter,
  referralRouter,
} from './opd.routes.js';
import {
  admissionRouter,
  bedRouter,
  billingRouter,
  labRouter,
  otRouter,
  pharmacyRouter,
  wardRouter,
} from './operations.routes.js';
import { analyticsRouter, auditRouter, reportRouter } from './insights.routes.js';

const startedAt = Date.now();

export const apiRouter = Router();

apiRouter.get('/health', async (_req, res) => {
  const db = getDbState();
  let dbPing = false;
  if (db === 'connected') {
    try {
      await mongoose.connection.db!.admin().ping();
      dbPing = true;
    } catch {
      dbPing = false;
    }
  }
  const healthy = db === 'connected' && dbPing;
  res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: {
      status: healthy ? 'ok' : 'degraded',
      database: dbPing ? 'connected' : db,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      time: new Date().toISOString(),
    },
  });
});

apiRouter.use('/auth', authRouter);

// Everything below requires a signed-in user.
apiRouter.use(authenticate);
apiRouter.get('/events', eventStream);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/doctors', doctorRouter);
apiRouter.use('/services', serviceRouter);
apiRouter.use('/patients', patientRouter);
apiRouter.use('/appointments', appointmentRouter);
apiRouter.use('/queue', queueRouter);
apiRouter.use('/consultations', consultationRouter);
apiRouter.use('/prescriptions', prescriptionRouter);
apiRouter.use('/referrals', referralRouter);
apiRouter.use('/billing', billingRouter);
apiRouter.use('/pharmacy', pharmacyRouter);
apiRouter.use('/laboratory', labRouter);
apiRouter.use('/wards', wardRouter);
apiRouter.use('/beds', bedRouter);
apiRouter.use('/admissions', admissionRouter);
apiRouter.use('/ot', otRouter);
apiRouter.use('/reports', reportRouter);
apiRouter.use('/analytics', analyticsRouter);
apiRouter.use('/audit', auditRouter);
