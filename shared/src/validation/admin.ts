import { z } from 'zod';
import { ROLES } from '../roles.js';
import {
  SERVICE_CATEGORIES,
  TOKEN_RESET_POLICIES,
  WEEKDAYS,
} from '../constants.js';
import {
  money,
  objectId,
  optionalObjectId,
  optionalPhone,
  optionalText,
  percentage,
  requiredText,
  time24,
} from './common.js';

export const PASSWORD_MIN_LENGTH = 10;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(128)
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const loginSchema = z.object({
  email: z.email('Enter a valid email address').transform((v) => v.toLowerCase()),
  password: z.string().min(1, 'Password is required').max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

export const userCreateSchema = z.object({
  name: requiredText(120, 'Name'),
  email: z.email('Enter a valid email address').transform((v) => v.toLowerCase()),
  role: z.enum(ROLES),
  phone: optionalPhone,
  designation: optionalText(120),
  password: passwordSchema,
});

export const userUpdateSchema = z.object({
  name: requiredText(120, 'Name').optional(),
  role: z.enum(ROLES).optional(),
  phone: optionalPhone,
  designation: optionalText(120),
  isActive: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export const availabilitySlotSchema = z
  .object({
    day: z.enum(WEEKDAYS),
    start: time24,
    end: time24,
  })
  .refine((v) => v.start < v.end, { message: 'End time must be after start time', path: ['end'] });

const doctorProfileFields = {
  specialization: requiredText(120, 'Specialization'),
  qualification: optionalText(200),
  registrationNumber: optionalText(60),
  department: optionalText(120),
  consultationService: optionalObjectId,
  followUpService: optionalObjectId,
  slotMinutes: z.coerce.number().int().min(5).max(120),
  availability: z.array(availabilitySlotSchema).max(50),
  isActive: z.boolean(),
};

export const doctorProfileSchema = z.object({
  ...doctorProfileFields,
  user: objectId,
  slotMinutes: doctorProfileFields.slotMinutes.default(15),
  availability: doctorProfileFields.availability.default([]),
  isActive: doctorProfileFields.isActive.default(true),
});

// Update schemas never carry defaults: zod applies defaults inside optional wrappers.
export const doctorProfileUpdateSchema = z.object(doctorProfileFields).partial();

const serviceFields = {
  code: requiredText(30, 'Code').transform((v) => v.toUpperCase()),
  name: requiredText(150, 'Name'),
  category: z.enum(SERVICE_CATEGORIES),
  price: money,
  taxRate: percentage,
  description: optionalText(300),
  isActive: z.boolean(),
};

export const serviceSchema = z.object({
  ...serviceFields,
  taxRate: percentage.default(0),
  isActive: z.boolean().default(true),
});

export const serviceUpdateSchema = z.object(serviceFields).partial();

export const opdSessionSchema = z
  .object({
    name: requiredText(40, 'Session name'),
    start: time24,
    end: time24,
  })
  .refine((v) => v.start < v.end, { message: 'End time must be after start time', path: ['end'] });

export const settingsUpdateSchema = z.object({
  hospital: z
    .object({
      name: requiredText(150, 'Hospital name'),
      shortName: optionalText(60),
      addressLine: optionalText(300),
      city: optionalText(80),
      state: optionalText(80),
      pincode: optionalText(10),
      phone: optionalText(40),
      email: optionalText(120),
      registrationNumber: optionalText(80),
      gstin: optionalText(20),
      establishedYear: z.coerce.number().int().min(1900).max(2100).nullable().optional(),
    })
    .optional(),
  opd: z
    .object({
      sessions: z.array(opdSessionSchema).min(1).max(6),
      tokenReset: z.enum(TOKEN_RESET_POLICIES),
      tokenPerDoctor: z.boolean(),
      defaultSlotMinutes: z.coerce.number().int().min(5).max(120),
    })
    .optional(),
  modules: z
    .object({
      pharmacy: z.boolean(),
      laboratory: z.boolean(),
      beds: z.boolean(),
      ot: z.boolean(),
    })
    .optional(),
  ot: z
    .object({
      theatres: z.array(requiredText(60, 'Theatre name')).max(10),
    })
    .optional(),
  billing: z
    .object({
      invoicePrefix: requiredText(10, 'Invoice prefix'),
      invoiceFooter: optionalText(500),
    })
    .optional(),
  clinical: z
    .object({
      restrictDoctorsToAssignedPatients: z.boolean(),
      prescriptionFooter: optionalText(500),
      requireIndependentLabVerification: z.boolean(),
    })
    .optional(),
  pharmacy: z
    .object({
      expiryAlertDays: z.coerce.number().int().min(1).max(365),
    })
    .optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type DoctorProfileInput = z.infer<typeof doctorProfileSchema>;
export type ServiceInput = z.infer<typeof serviceSchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
