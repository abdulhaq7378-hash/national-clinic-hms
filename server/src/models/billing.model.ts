import { Schema, model } from 'mongoose';
import { INVOICE_STATUSES, PAYMENT_METHODS, PAYMENT_TYPES, SERVICE_CATEGORIES } from '@hms/shared';
import { applyJsonTransform } from './_helpers.js';

/** Configurable price list. Prices are never hard-coded in the application. */
const serviceSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: SERVICE_CATEGORIES, required: true },
    price: { type: Number, required: true, min: 0 },
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    description: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
serviceSchema.index({ category: 1, isActive: 1 });
applyJsonTransform(serviceSchema);

export const Service = model('Service', serviceSchema, 'services');

export const CHARGE_SOURCES = ['manual', 'consultation', 'dispense', 'lab_order', 'admission', 'ot'] as const;

/**
 * A billable event recorded by the module where it happened (consultation,
 * pharmacy, laboratory, admission). Billing staff turn pending charges into invoices,
 * so every module feeds one billing ledger without duplicating patient data.
 */
const chargeSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    service: { type: Schema.Types.ObjectId, ref: 'Service' },
    category: { type: String, enum: SERVICE_CATEGORIES, required: true },
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    taxRate: { type: Number, default: 0 },
    date: { type: String, required: true },
    sourceKind: { type: String, enum: CHARGE_SOURCES, default: 'manual' },
    sourceId: { type: Schema.Types.ObjectId },
    /** Unique key for automatic charges so that a retried workflow never bills twice. */
    sourceKey: { type: String },
    status: { type: String, enum: ['pending', 'billed', 'void'], default: 'pending' },
    invoice: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
chargeSchema.index({ patient: 1, status: 1 });
chargeSchema.index({ sourceKey: 1 }, { unique: true, partialFilterExpression: { sourceKey: { $type: 'string' } } });
applyJsonTransform(chargeSchema);

export const Charge = model('Charge', chargeSchema, 'charges');

const invoiceItemSchema = new Schema({
  charge: { type: Schema.Types.ObjectId, ref: 'Charge' },
  service: { type: Schema.Types.ObjectId, ref: 'Service' },
  category: { type: String, enum: SERVICE_CATEGORIES, required: true },
  description: { type: String, required: true },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  taxRate: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  amount: { type: Number, required: true },
});

const invoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    date: { type: String, required: true },
    items: { type: [invoiceItemSchema], required: true },
    subtotal: { type: Number, required: true },
    discountTotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    total: { type: Number, required: true },
    amountPaid: { type: Number, default: 0 },
    amountRefunded: { type: Number, default: 0 },
    balance: { type: Number, required: true },
    status: { type: String, enum: INVOICE_STATUSES, default: 'unpaid' },
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: Date,
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelReason: String,
  },
  { timestamps: true },
);
invoiceSchema.index({ patient: 1, createdAt: -1 });
invoiceSchema.index({ date: 1, status: 1 });
invoiceSchema.index({ status: 1 });
applyJsonTransform(invoiceSchema);

export const Invoice = model('Invoice', invoiceSchema, 'invoices');

const paymentSchema = new Schema(
  {
    receiptNumber: { type: String, required: true, unique: true },
    invoice: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    type: { type: String, enum: PAYMENT_TYPES, default: 'payment' },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    reference: String,
    note: String,
    date: { type: String, required: true },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
paymentSchema.index({ invoice: 1 });
paymentSchema.index({ date: 1 });
applyJsonTransform(paymentSchema);

export const Payment = model('Payment', paymentSchema, 'payments');
