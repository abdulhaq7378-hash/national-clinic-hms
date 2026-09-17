import { z } from 'zod';
import {
  APPOINTMENT_SOURCES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  PRIORITIES,
  TOKEN_STATUSES,
} from '../constants.js';
import { isoDate, objectId, optionalText, paginationQuery, time24 } from './common.js';

export const appointmentCreateSchema = z.object({
  patient: objectId,
  doctor: objectId,
  date: isoDate,
  startTime: time24,
  type: z.enum(APPOINTMENT_TYPES).default('new'),
  source: z.enum(APPOINTMENT_SOURCES).default('reception'),
  notes: optionalText(1000),
});

export const appointmentRescheduleSchema = z.object({
  doctor: objectId.optional(),
  date: isoDate,
  startTime: time24,
  reason: optionalText(500),
});

export const appointmentUpdateSchema = z.object({
  type: z.enum(APPOINTMENT_TYPES).optional(),
  notes: optionalText(1000),
});

export const appointmentStatusSchema = z.object({
  status: z.enum(['confirmed', 'cancelled', 'no_show']),
  reason: optionalText(500),
});

export const appointmentListQuery = paginationQuery.extend({
  date: isoDate.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  doctor: objectId.optional(),
  patient: objectId.optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const slotQuery = z.object({
  doctor: objectId,
  date: isoDate,
});

export const walkInSchema = z.object({
  patient: objectId,
  doctor: objectId,
  priority: z.enum(PRIORITIES).default('routine'),
  notes: optionalText(500),
});

export const checkInSchema = z.object({
  appointment: objectId,
});

export const tokenActionSchema = z.object({
  action: z.enum(['call', 'complete', 'skip', 'requeue', 'cancel']),
  reason: optionalText(300),
});

export const queueQuery = z.object({
  date: isoDate.optional(),
  doctor: objectId.optional(),
  status: z.enum(TOKEN_STATUSES).optional(),
});

export type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>;
export type WalkInInput = z.infer<typeof walkInSchema>;
