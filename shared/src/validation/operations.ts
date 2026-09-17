import { z } from 'zod';
import {
  INVOICE_STATUSES,
  MEDICINE_FORMS,
  OT_STATUSES,
  PAYMENT_METHODS,
  PRIORITIES,
  SAMPLE_TYPES,
  SERVICE_CATEGORIES,
  WARD_TYPES,
  LAB_ORDER_STATUSES,
} from '../constants.js';
import {
  isoDate,
  money,
  objectId,
  optionalIsoDate,
  optionalObjectId,
  optionalText,
  paginationQuery,
  percentage,
  requiredText,
} from './common.js';

/* ---------------------------------- Billing --------------------------------- */

export const chargeCreateSchema = z.object({
  patient: objectId,
  service: optionalObjectId,
  description: optionalText(200),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  quantity: z.coerce.number().min(0.01).max(10000).default(1),
  unitPrice: money.optional(),
  taxRate: percentage.optional(),
});

export const invoiceItemSchema = z.object({
  charge: optionalObjectId,
  service: optionalObjectId,
  description: optionalText(200),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  quantity: z.coerce.number().min(0.01).max(10000).default(1),
  unitPrice: money.optional(),
  discount: money.default(0),
  taxRate: percentage.optional(),
});

export const invoiceCreateSchema = z.object({
  patient: objectId,
  items: z.array(invoiceItemSchema).min(1, 'Add at least one item').max(100),
  notes: optionalText(1000),
});

export const paymentCreateSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than zero').max(10_000_000),
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(100),
  note: optionalText(300),
});

export const refundCreateSchema = paymentCreateSchema.extend({
  note: requiredText(300, 'Refund reason'),
});

export const invoiceListQuery = paginationQuery.extend({
  patient: objectId.optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(60).optional(),
});

/* --------------------------------- Pharmacy --------------------------------- */

const medicineFields = {
  name: requiredText(150, 'Medicine name'),
  genericName: optionalText(150),
  brand: optionalText(120),
  manufacturer: optionalText(150),
  category: optionalText(80),
  form: z.enum(MEDICINE_FORMS),
  strength: optionalText(60),
  unit: requiredText(30, 'Unit'),
  reorderLevel: z.coerce.number().int().min(0).max(100000),
  hsnCode: optionalText(20),
  taxRate: percentage,
  isActive: z.boolean(),
};

export const medicineCreateSchema = z.object({
  ...medicineFields,
  form: medicineFields.form.default('tablet'),
  unit: medicineFields.unit.default('tablet'),
  reorderLevel: medicineFields.reorderLevel.default(10),
  taxRate: percentage.default(0),
  isActive: z.boolean().default(true),
});

export const medicineUpdateSchema = z.object(medicineFields).partial();

export const stockInSchema = z.object({
  medicine: objectId,
  batchNumber: requiredText(60, 'Batch number'),
  expiryDate: isoDate,
  quantity: z.coerce.number().int().min(1).max(1_000_000),
  purchasePrice: money,
  sellingPrice: money,
  supplier: optionalText(150),
  supplierInvoice: optionalText(60),
});

export const stockAdjustmentSchema = z.object({
  batch: objectId,
  type: z.enum(['adjustment', 'write_off', 'return']),
  quantityChange: z.coerce
    .number()
    .int()
    .refine((v) => v !== 0, 'Quantity change cannot be zero'),
  reason: requiredText(300, 'Reason'),
});

export const dispenseSchema = z
  .object({
    prescription: optionalObjectId,
    patient: optionalObjectId,
    items: z
      .array(
        z.object({
          prescriptionItem: optionalObjectId,
          medicine: optionalObjectId,
          quantity: z.coerce.number().int().min(1).max(10000),
        }),
      )
      .min(1, 'Nothing to dispense')
      .max(50),
    note: optionalText(300),
  })
  .refine((v) => v.prescription || v.patient, {
    message: 'A prescription or patient is required',
    path: ['patient'],
  });

export const inventoryListQuery = paginationQuery.extend({
  q: z.string().trim().max(60).optional(),
  filter: z.enum(['all', 'low_stock', 'expiring', 'expired', 'out_of_stock']).default('all'),
});

export const transactionListQuery = paginationQuery.extend({
  medicine: objectId.optional(),
  type: z.enum(['stock_in', 'dispense', 'adjustment', 'return', 'write_off']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/* -------------------------------- Laboratory -------------------------------- */

export const labParameterSchema = z.object({
  name: requiredText(100, 'Parameter name'),
  unit: optionalText(30),
  referenceRange: optionalText(100),
  refLow: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().optional()),
  refHigh: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().optional()),
});

const labTestFields = {
  code: requiredText(20, 'Code').transform((v) => v.toUpperCase()),
  name: requiredText(150, 'Test name'),
  category: optionalText(80),
  sampleType: z.enum(SAMPLE_TYPES),
  price: money,
  taxRate: percentage,
  turnaroundHours: z.coerce.number().int().min(1).max(720),
  parameters: z.array(labParameterSchema).min(1, 'Add at least one parameter').max(60),
  isActive: z.boolean(),
};

export const labTestCreateSchema = z.object({
  ...labTestFields,
  taxRate: percentage.default(0),
  turnaroundHours: labTestFields.turnaroundHours.default(24),
  isActive: z.boolean().default(true),
});

export const labTestUpdateSchema = z.object(labTestFields).partial();

export const labOrderCreateSchema = z.object({
  patient: objectId,
  consultation: optionalObjectId,
  tests: z.array(objectId).min(1, 'Select at least one test').max(30),
  priority: z.enum(PRIORITIES).default('routine'),
  clinicalNotes: optionalText(1000),
});

export const labSampleSchema = z.object({
  note: optionalText(300),
});

export const labResultsSchema = z.object({
  items: z
    .array(
      z.object({
        item: objectId,
        values: z
          .array(
            z.object({
              parameter: requiredText(100, 'Parameter'),
              value: requiredText(100, 'Value'),
              flag: z.enum(['normal', 'low', 'high', 'abnormal']).optional(),
            }),
          )
          .min(1),
        remarks: optionalText(500),
      }),
    )
    .min(1),
});

export const labOrderListQuery = paginationQuery.extend({
  patient: objectId.optional(),
  status: z.enum(LAB_ORDER_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  active: z.enum(['true', 'false']).optional(),
});

/* ------------------------------- Wards and beds ------------------------------ */

export const wardCreateSchema = z.object({
  name: requiredText(100, 'Ward name'),
  code: requiredText(20, 'Code').transform((v) => v.toUpperCase()),
  type: z.enum(WARD_TYPES),
  floor: optionalText(30),
  description: optionalText(300),
  isActive: z.boolean().default(true),
});

export const wardUpdateSchema = z.object({
  name: requiredText(100, 'Ward name').optional(),
  type: z.enum(WARD_TYPES).optional(),
  floor: optionalText(30),
  description: optionalText(300),
  isActive: z.boolean().optional(),
});

export const roomCreateSchema = z.object({
  ward: objectId,
  number: requiredText(20, 'Room number'),
  description: optionalText(300),
});

export const bedCreateSchema = z.object({
  ward: objectId,
  room: optionalObjectId,
  code: requiredText(20, 'Bed code').transform((v) => v.toUpperCase()),
  type: z.enum(WARD_TYPES),
  dailyService: optionalObjectId,
  notes: optionalText(300),
});

export const bedUpdateSchema = z.object({
  room: optionalObjectId,
  type: z.enum(WARD_TYPES).optional(),
  dailyService: optionalObjectId,
  notes: optionalText(300),
  isActive: z.boolean().optional(),
});

export const bedStatusSchema = z.object({
  status: z.enum(['available', 'reserved', 'cleaning', 'maintenance']),
  note: optionalText(300),
});

export const admissionCreateSchema = z.object({
  patient: objectId,
  bed: objectId,
  admittingDoctor: objectId,
  reason: requiredText(1000, 'Reason for admission'),
  provisionalDiagnosis: optionalText(500),
  expectedDischargeDate: optionalIsoDate,
});

export const bedTransferSchema = z.object({
  bed: objectId,
  reason: requiredText(300, 'Reason'),
});

export const dischargeSchema = z.object({
  finalDiagnosis: requiredText(1000, 'Final diagnosis'),
  treatmentGiven: optionalText(3000),
  conditionAtDischarge: z.enum(['recovered', 'improved', 'unchanged', 'referred', 'lama', 'deceased']),
  advice: optionalText(2000),
  followUpDate: optionalIsoDate,
});

export const admissionListQuery = paginationQuery.extend({
  status: z.enum(['admitted', 'discharged']).optional(),
  patient: objectId.optional(),
});

/* ---------------------------- Operation theatre ---------------------------- */

const otFields = {
  patient: objectId,
  admission: optionalObjectId,
  procedureName: requiredText(200, 'Procedure'),
  surgeon: objectId,
  assistant: optionalText(120),
  anaesthetist: optionalText(120),
  anaesthesiaType: z.enum(['general', 'spinal', 'epidural', 'regional', 'local', 'sedation', 'none']).optional(),
  theatre: requiredText(60, 'Theatre'),
  scheduledStart: z.iso.datetime({ offset: true, message: 'Invalid date and time' }),
  estimatedMinutes: z.coerce.number().int().min(5).max(1440),
  priority: z.enum(PRIORITIES),
  preOpNotes: optionalText(3000),
};

export const otCreateSchema = z.object({
  ...otFields,
  estimatedMinutes: otFields.estimatedMinutes.default(60),
  priority: otFields.priority.default('routine'),
});

export const otUpdateSchema = z
  .object({
    ...otFields,
    postOpNotes: optionalText(3000),
  })
  .omit({ patient: true })
  .partial();

export const otStatusSchema = z.object({
  status: z.enum(OT_STATUSES),
  note: optionalText(300),
});

export const otListQuery = paginationQuery.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(OT_STATUSES).optional(),
});

export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;
export type StockInInput = z.infer<typeof stockInSchema>;
export type DispenseInput = z.infer<typeof dispenseSchema>;
export type LabTestInput = z.infer<typeof labTestCreateSchema>;
export type LabResultsInput = z.infer<typeof labResultsSchema>;
export type AdmissionCreateInput = z.infer<typeof admissionCreateSchema>;
export type DischargeInput = z.infer<typeof dischargeSchema>;
export type OtCreateInput = z.infer<typeof otCreateSchema>;
