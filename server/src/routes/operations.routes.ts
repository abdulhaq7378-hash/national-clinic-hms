import { Router } from 'express';
import { z } from 'zod';
import {
  admissionCreateSchema,
  admissionListQuery,
  bedCreateSchema,
  bedStatusSchema,
  bedTransferSchema,
  bedUpdateSchema,
  chargeCreateSchema,
  dischargeSchema,
  dispenseSchema,
  inventoryListQuery,
  invoiceCreateSchema,
  invoiceListQuery,
  labOrderCreateSchema,
  labOrderListQuery,
  labResultsSchema,
  labSampleSchema,
  labTestCreateSchema,
  labTestUpdateSchema,
  medicineCreateSchema,
  medicineUpdateSchema,
  objectId,
  otCreateSchema,
  otListQuery,
  otStatusSchema,
  otUpdateSchema,
  paymentCreateSchema,
  reasonBody,
  refundCreateSchema,
  requiredText,
  roomCreateSchema,
  stockAdjustmentSchema,
  stockInSchema,
  transactionListQuery,
  wardCreateSchema,
  wardUpdateSchema,
} from '@hms/shared';
import * as c from '../controllers/operations.controller.js';
import { requireAnyPermission, requirePermission } from '../middleware/auth.js';
import { requireModule } from '../middleware/guards.js';
import { idParams, validate } from '../middleware/validate.js';

const includeInactive = z.object({ includeInactive: z.enum(['true', 'false']).optional() });

/* --------------------------------- Billing --------------------------------- */

export const billingRouter = Router();
billingRouter.get(
  '/charges',
  requirePermission('billing:read'),
  validate({ query: z.object({ patient: objectId.optional(), status: z.enum(['pending', 'billed', 'void']).optional() }) }),
  c.listCharges,
);
billingRouter.get('/charges/pending-summary', requirePermission('billing:read'), c.pendingChargeSummary);
billingRouter.post('/charges', requirePermission('billing:manage'), validate({ body: chargeCreateSchema }), c.createCharge);
billingRouter.post(
  '/charges/:id/void',
  requirePermission('billing:manage'),
  validate({ params: idParams, body: reasonBody }),
  c.voidCharge,
);
billingRouter.get('/invoices', requirePermission('billing:read'), validate({ query: invoiceListQuery }), c.listInvoices);
billingRouter.post('/invoices', requirePermission('billing:manage'), validate({ body: invoiceCreateSchema }), c.createInvoice);
billingRouter.get('/invoices/:id', requirePermission('billing:read'), validate({ params: idParams }), c.getInvoice);
billingRouter.post(
  '/invoices/:id/payments',
  requirePermission('billing:manage'),
  validate({ params: idParams, body: paymentCreateSchema }),
  c.addPayment,
);
billingRouter.post(
  '/invoices/:id/refunds',
  requirePermission('billing:refund'),
  validate({ params: idParams, body: refundCreateSchema }),
  c.addRefund,
);
billingRouter.post(
  '/invoices/:id/cancel',
  requirePermission('billing:manage'),
  validate({ params: idParams, body: reasonBody }),
  c.cancelInvoice,
);

/* --------------------------------- Pharmacy -------------------------------- */

export const pharmacyRouter = Router();
pharmacyRouter.use(requireModule('pharmacy'));
pharmacyRouter.get('/medicines', requirePermission('pharmacy:read'), validate({ query: inventoryListQuery }), c.listInventory);
pharmacyRouter.get(
  '/medicines/search',
  requireAnyPermission('pharmacy:read', 'prescription:write'),
  validate({ query: z.object({ q: z.string().trim().min(1).max(60) }) }),
  c.searchMedicines,
);
pharmacyRouter.post(
  '/medicines',
  requirePermission('pharmacy:inventory'),
  validate({ body: medicineCreateSchema }),
  c.createMedicine,
);
pharmacyRouter.get('/medicines/:id', requirePermission('pharmacy:read'), validate({ params: idParams }), c.getMedicine);
pharmacyRouter.patch(
  '/medicines/:id',
  requirePermission('pharmacy:inventory'),
  validate({ params: idParams, body: medicineUpdateSchema }),
  c.updateMedicine,
);
pharmacyRouter.get('/alerts', requirePermission('pharmacy:read'), c.inventoryAlerts);
pharmacyRouter.post('/stock-in', requirePermission('pharmacy:inventory'), validate({ body: stockInSchema }), c.stockIn);
pharmacyRouter.post(
  '/adjustments',
  requirePermission('pharmacy:inventory'),
  validate({ body: stockAdjustmentSchema }),
  c.adjustStock,
);
pharmacyRouter.post('/dispense', requirePermission('pharmacy:dispense'), validate({ body: dispenseSchema }), c.dispense);
pharmacyRouter.get(
  '/transactions',
  requirePermission('pharmacy:read'),
  validate({ query: transactionListQuery }),
  c.listTransactions,
);

/* -------------------------------- Laboratory ------------------------------- */

export const labRouter = Router();
labRouter.use(requireModule('laboratory'));
labRouter.get(
  '/tests',
  requireAnyPermission('lab:read', 'lab:order'),
  validate({ query: includeInactive }),
  c.listLabTests,
);
labRouter.post('/tests', requirePermission('lab:catalog'), validate({ body: labTestCreateSchema }), c.createLabTest);
labRouter.patch(
  '/tests/:id',
  requirePermission('lab:catalog'),
  validate({ params: idParams, body: labTestUpdateSchema }),
  c.updateLabTest,
);
labRouter.get('/orders', requirePermission('lab:read'), validate({ query: labOrderListQuery }), c.listLabOrders);
labRouter.post('/orders', requirePermission('lab:order'), validate({ body: labOrderCreateSchema }), c.createLabOrder);
labRouter.get('/orders/:id', requirePermission('lab:read'), validate({ params: idParams }), c.getLabOrder);
labRouter.post(
  '/orders/:id/collect',
  requirePermission('lab:process'),
  validate({ params: idParams, body: labSampleSchema }),
  c.collectSample,
);
labRouter.post('/orders/:id/process', requirePermission('lab:process'), validate({ params: idParams }), c.startProcessing);
labRouter.put(
  '/orders/:id/results',
  requirePermission('lab:process'),
  validate({ params: idParams, body: labResultsSchema }),
  c.enterResults,
);
labRouter.post('/orders/:id/verify', requirePermission('lab:verify'), validate({ params: idParams }), c.verifyResults);
labRouter.post('/orders/:id/release', requirePermission('lab:verify'), validate({ params: idParams }), c.releaseReport);
labRouter.post(
  '/orders/:id/amend',
  requirePermission('lab:verify'),
  validate({ params: idParams, body: labResultsSchema.extend({ reason: requiredText(500, 'Reason') }) }),
  c.amendResults,
);
labRouter.post(
  '/orders/:id/cancel',
  requireAnyPermission('lab:order', 'lab:process'),
  validate({ params: idParams, body: reasonBody }),
  c.cancelLabOrder,
);

/* ------------------------------ Wards and beds ------------------------------ */

export const wardRouter = Router();
wardRouter.use(requireModule('beds'));
wardRouter.get('/', requirePermission('bed:read'), validate({ query: includeInactive }), c.listWards);
wardRouter.post('/', requirePermission('ward:configure'), validate({ body: wardCreateSchema }), c.createWard);
wardRouter.patch(
  '/:id',
  requirePermission('ward:configure'),
  validate({ params: idParams, body: wardUpdateSchema }),
  c.updateWard,
);
wardRouter.post(
  '/:id/rooms',
  requirePermission('ward:configure'),
  validate({ params: idParams, body: roomCreateSchema.omit({ ward: true }) }),
  c.createRoom,
);

export const bedRouter = Router();
bedRouter.use(requireModule('beds'));
bedRouter.get('/board', requirePermission('bed:read'), c.bedBoard);
bedRouter.post('/', requirePermission('ward:configure'), validate({ body: bedCreateSchema }), c.createBed);
bedRouter.patch(
  '/:id',
  requirePermission('ward:configure'),
  validate({ params: idParams, body: bedUpdateSchema }),
  c.updateBed,
);
bedRouter.post(
  '/:id/status',
  requirePermission('bed:manage'),
  validate({ params: idParams, body: bedStatusSchema }),
  c.bedStatus,
);

export const admissionRouter = Router();
admissionRouter.use(requireModule('beds'));
admissionRouter.get('/', requirePermission('bed:read'), validate({ query: admissionListQuery }), c.listAdmissions);
admissionRouter.post('/', requirePermission('admission:manage'), validate({ body: admissionCreateSchema }), c.admit);
admissionRouter.get('/:id', requirePermission('bed:read'), validate({ params: idParams }), c.getAdmission);
admissionRouter.post(
  '/:id/transfer',
  requirePermission('admission:manage'),
  validate({ params: idParams, body: bedTransferSchema }),
  c.transfer,
);
admissionRouter.post(
  '/:id/discharge',
  requirePermission('admission:manage'),
  validate({ params: idParams, body: dischargeSchema }),
  c.discharge,
);

/* ---------------------------- Operation theatre ---------------------------- */

export const otRouter = Router();
otRouter.use(requireModule('ot'));
otRouter.get('/', requirePermission('ot:read'), validate({ query: otListQuery }), c.listOt);
otRouter.post('/', requirePermission('ot:manage'), validate({ body: otCreateSchema }), c.createOt);
otRouter.get('/:id', requirePermission('ot:read'), validate({ params: idParams }), c.getOt);
otRouter.patch('/:id', requirePermission('ot:manage'), validate({ params: idParams, body: otUpdateSchema }), c.updateOt);
otRouter.post(
  '/:id/status',
  requirePermission('ot:manage'),
  validate({ params: idParams, body: otStatusSchema }),
  c.otStatus,
);
