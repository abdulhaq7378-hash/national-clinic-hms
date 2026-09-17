import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import {
  PAYMENT_METHODS,
  calculateLine,
  calculateTotals,
  roundMoney,
  toHospitalDate,
  type InvoiceCreateInput,
  type InvoiceStatus,
  type ServiceCategory,
} from '@hms/shared';
import { Charge, Invoice, Patient, Payment, Service } from '../models/index.js';
import { runInTransaction, withSession } from '../db/transaction.js';
import { patientPopulate, userNamePopulate } from '../repositories/populate.js';
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js';
import { skipFor } from '../utils/http.js';
import { recordAudit } from './audit.service.js';
import { nextSequence } from './counter.service.js';
import { getSettings } from './settings.service.js';
import type { Actor } from './actor.js';

type PaymentMethod = (typeof PAYMENT_METHODS)[number];
type ChargeSource = 'manual' | 'consultation' | 'dispense' | 'lab_order' | 'admission' | 'ot';

export interface AutoChargeInput {
  patient: string | Types.ObjectId;
  service?: string | Types.ObjectId | null;
  category: ServiceCategory;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  sourceKind: ChargeSource;
  sourceId: string | Types.ObjectId;
  /** Unique key that prevents the same event from being billed twice. */
  sourceKey: string;
}

/** Records a charge raised by another module. Duplicate keys are ignored. */
export async function addAutoCharge(actor: Actor, input: AutoChargeInput, session: ClientSession | null = null) {
  // Checked first because a duplicate-key error would abort an enclosing transaction.
  if (await Charge.exists({ sourceKey: input.sourceKey }).session(session)) return null;
  try {
    const [charge] = await Charge.create(
      [{ ...input, date: toHospitalDate(), status: 'pending', createdBy: actor.userId }],
      withSession(session),
    );
    return charge;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return null;
    throw err;
  }
}

/** Raises the charge for a priced service, if the service exists and is active. */
export async function chargeForService(
  actor: Actor,
  serviceId: string | Types.ObjectId | null | undefined,
  base: Omit<AutoChargeInput, 'service' | 'category' | 'description' | 'unitPrice' | 'taxRate'> & {
    description?: string;
  },
  session: ClientSession | null = null,
) {
  if (!serviceId) return null;
  const service = await Service.findOne({ _id: serviceId, isActive: true }).session(session);
  if (!service) return null;
  return addAutoCharge(
    actor,
    {
      ...base,
      service: service._id,
      category: service.category as ServiceCategory,
      description: base.description ?? service.name,
      unitPrice: service.price,
      taxRate: service.taxRate ?? 0,
    },
    session,
  );
}

export async function createManualCharge(
  actor: Actor,
  input: {
    patient: string;
    service?: string | null;
    description?: string | null;
    category?: ServiceCategory;
    quantity: number;
    unitPrice?: number;
    taxRate?: number;
  },
) {
  if (!(await Patient.exists({ _id: input.patient }))) throw notFound('Patient');
  let line: { description: string; category: ServiceCategory; unitPrice: number; taxRate: number; service?: Types.ObjectId };
  if (input.service) {
    const service = await Service.findOne({ _id: input.service, isActive: true });
    if (!service) throw notFound('Service');
    line = {
      service: service._id,
      description: input.description ?? service.name,
      category: service.category as ServiceCategory,
      unitPrice: service.price,
      taxRate: service.taxRate ?? 0,
    };
  } else {
    if (!input.description || !input.category || input.unitPrice === undefined) {
      throw badRequest('Description, category and price are required for items not in the price list');
    }
    line = {
      description: input.description,
      category: input.category,
      unitPrice: input.unitPrice,
      taxRate: input.taxRate ?? 0,
    };
  }
  const charge = await Charge.create({
    ...line,
    patient: input.patient,
    quantity: input.quantity,
    date: toHospitalDate(),
    sourceKind: 'manual',
    status: 'pending',
    createdBy: actor.userId,
  });
  await recordAudit(actor, {
    action: 'charge.create',
    resource: 'charge',
    resourceId: charge.id,
    patient: input.patient,
    metadata: { amount: roundMoney(charge.quantity * charge.unitPrice), category: charge.category },
  });
  return charge;
}

export function listCharges(params: { patient?: string; status?: string }) {
  const filter: Record<string, unknown> = {};
  if (params.patient) filter.patient = params.patient;
  filter.status = params.status ?? 'pending';
  return Charge.find(filter).populate(patientPopulate).sort({ createdAt: 1 }).limit(500);
}

/** Patients with charges waiting to be invoiced. */
export async function pendingChargeSummary() {
  const rows = await Charge.aggregate<{ _id: Types.ObjectId; count: number; amount: number; oldest: Date }>([
    { $match: { status: 'pending' } },
    {
      $group: {
        _id: '$patient',
        count: { $sum: 1 },
        amount: { $sum: { $multiply: ['$quantity', '$unitPrice'] } },
        oldest: { $min: '$createdAt' },
      },
    },
    { $sort: { oldest: 1 } },
    { $limit: 200 },
  ]);
  const patients = await Patient.find({ _id: { $in: rows.map((r) => r._id) } }).select('uhid fullName phone');
  const byId = new Map(patients.map((p) => [p.id, p]));
  return rows.map((r) => ({
    patient: byId.get(String(r._id)),
    count: r.count,
    amount: roundMoney(r.amount),
    oldest: r.oldest,
  }));
}

export async function voidCharge(actor: Actor, id: string, reason: string) {
  const charge = await Charge.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: { status: 'void' } },
    { returnDocument: 'after' },
  );
  if (!charge) throw conflict('Only pending charges can be voided');
  await recordAudit(actor, {
    action: 'charge.void',
    resource: 'charge',
    resourceId: id,
    patient: charge.patient,
    metadata: { reason, amount: roundMoney(charge.quantity * charge.unitPrice) },
  });
  return charge;
}

function statusFor(total: number, paid: number, refunded: number): InvoiceStatus {
  if (refunded > 0 && roundMoney(paid - refunded) <= 0) return 'refunded';
  if (paid <= 0) return total <= 0 ? 'paid' : 'unpaid';
  if (paid >= total) return 'paid';
  return 'partially_paid';
}

async function nextInvoiceNumber(session: ClientSession | null) {
  const settings = await getSettings();
  const prefix = settings.billing?.invoicePrefix || 'INV';
  const year = toHospitalDate().slice(0, 4);
  const seq = await nextSequence(`invoice:${year}`, session);
  return `${prefix}-${year}-${String(seq).padStart(6, '0')}`;
}

async function nextReceiptNumber(session: ClientSession | null) {
  const year = toHospitalDate().slice(0, 4);
  const seq = await nextSequence(`receipt:${year}`, session);
  return `RCT-${year}-${String(seq).padStart(6, '0')}`;
}

export async function createInvoice(actor: Actor, input: InvoiceCreateInput) {
  if (!(await Patient.exists({ _id: input.patient }))) throw notFound('Patient');
  const chargeIds = input.items.filter((i) => i.charge).map((i) => i.charge!);
  if (new Set(chargeIds).size !== chargeIds.length) throw badRequest('A charge can only appear once on an invoice');

  const invoice = await runInTransaction(async (session) => {
    const invoiceId = new Types.ObjectId();
    const lines = [];
    for (const item of input.items) {
      if (item.charge) {
        // Claim the charge atomically so that it can never be billed on two invoices.
        const charge = await Charge.findOneAndUpdate(
          { _id: item.charge, patient: input.patient, status: 'pending' },
          { $set: { status: 'billed', invoice: invoiceId } },
          { returnDocument: 'after', ...withSession(session) },
        );
        if (!charge) throw conflict('One of the selected charges has already been billed or voided');
        lines.push({
          charge: charge._id,
          service: charge.service,
          category: charge.category,
          description: charge.description,
          quantity: charge.quantity,
          unitPrice: charge.unitPrice,
          discount: item.discount ?? 0,
          taxRate: charge.taxRate ?? 0,
        });
      } else if (item.service) {
        const service = await Service.findOne({ _id: item.service, isActive: true }).session(session);
        if (!service) throw notFound('Service');
        lines.push({
          service: service._id,
          category: service.category,
          description: item.description ?? service.name,
          quantity: item.quantity,
          unitPrice: service.price,
          discount: item.discount ?? 0,
          taxRate: service.taxRate ?? 0,
        });
      } else {
        if (!item.description || !item.category || item.unitPrice === undefined) {
          throw badRequest('Description, category and price are required for items not in the price list');
        }
        lines.push({
          category: item.category,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount ?? 0,
          taxRate: item.taxRate ?? 0,
        });
      }
    }

    const items = lines.map((line) => {
      const c = calculateLine(line);
      return { ...line, discount: c.discount, taxAmount: c.tax, amount: c.amount };
    });
    const totals = calculateTotals(lines);
    const [created] = await Invoice.create(
      [
        {
          _id: invoiceId,
          invoiceNumber: await nextInvoiceNumber(session),
          patient: input.patient,
          date: toHospitalDate(),
          items,
          ...totals,
          amountPaid: 0,
          amountRefunded: 0,
          balance: totals.total,
          status: statusFor(totals.total, 0, 0),
          notes: input.notes ?? undefined,
          createdBy: actor.userId,
        },
      ],
      withSession(session),
    );
    await recordAudit(
      actor,
      {
        action: 'invoice.create',
        resource: 'invoice',
        resourceId: created.id,
        patient: input.patient,
        metadata: { invoiceNumber: created.invoiceNumber, total: totals.total, items: items.length },
      },
      session,
    );
    return created;
  });
  return getInvoice(invoice.id);
}

export async function getInvoice(id: string) {
  const invoice = await Invoice.findById(id)
    .populate({ path: 'patient', select: 'uhid fullName gender dateOfBirth phone address' })
    .populate(userNamePopulate('createdBy'))
    .populate(userNamePopulate('cancelledBy'));
  if (!invoice) throw notFound('Invoice');
  const payments = await Payment.find({ invoice: id }).populate(userNamePopulate('receivedBy')).sort({ createdAt: 1 });
  return { ...invoice.toJSON(), payments };
}

export async function listInvoices(q: {
  patient?: string;
  status?: string;
  from?: string;
  to?: string;
  q?: string;
  page: number;
  limit: number;
}) {
  const filter: Record<string, unknown> = {};
  if (q.patient) filter.patient = q.patient;
  if (q.status) filter.status = q.status;
  if (q.from || q.to) filter.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.q) filter.invoiceNumber = { $regex: q.q.toUpperCase().replace(/[^A-Z0-9-]/g, '') };
  const [items, total] = await Promise.all([
    Invoice.find(filter)
      .select('-items')
      .populate(patientPopulate)
      .sort({ createdAt: -1 })
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit),
    Invoice.countDocuments(filter),
  ]);
  return { items, total };
}

export async function recordPayment(
  actor: Actor,
  invoiceId: string,
  input: { amount: number; method: PaymentMethod; reference?: string | null; note?: string | null },
) {
  const amount = roundMoney(input.amount);
  await runInTransaction(async (session) => {
    const invoice = await Invoice.findById(invoiceId).session(session);
    if (!invoice) throw notFound('Invoice');
    if (['cancelled', 'refunded'].includes(invoice.status)) throw conflict(`Invoice is ${invoice.status}`);
    if (amount > roundMoney(invoice.balance)) {
      throw badRequest(`Payment exceeds the outstanding balance of ${invoice.balance.toFixed(2)}`);
    }
    const paid = roundMoney(invoice.amountPaid + amount);
    const balance = roundMoney(invoice.total - paid);
    const updated = await Invoice.updateOne(
      { _id: invoice._id, amountPaid: invoice.amountPaid },
      { $set: { amountPaid: paid, balance, status: statusFor(invoice.total, paid, invoice.amountRefunded) } },
      withSession(session),
    );
    if (updated.modifiedCount === 0) throw conflict('The invoice changed while saving. Refresh and try again.');
    const [payment] = await Payment.create(
      [
        {
          receiptNumber: await nextReceiptNumber(session),
          invoice: invoice._id,
          patient: invoice.patient,
          type: 'payment',
          amount,
          method: input.method,
          reference: input.reference ?? undefined,
          note: input.note ?? undefined,
          date: toHospitalDate(),
          receivedBy: actor.userId,
        },
      ],
      withSession(session),
    );
    await recordAudit(
      actor,
      {
        action: 'invoice.payment',
        resource: 'invoice',
        resourceId: invoice.id,
        patient: invoice.patient,
        metadata: { receipt: payment.receiptNumber, amount, method: input.method },
      },
      session,
    );
  });
  return getInvoice(invoiceId);
}

/**
 * Refunds reduce the net amount collected. The billed total is unchanged, so the
 * original invoice remains an accurate record of the services provided.
 */
export async function recordRefund(
  actor: Actor,
  invoiceId: string,
  input: { amount: number; method: PaymentMethod; reference?: string | null; note: string },
) {
  const amount = roundMoney(input.amount);
  await runInTransaction(async (session) => {
    const invoice = await Invoice.findById(invoiceId).session(session);
    if (!invoice) throw notFound('Invoice');
    const refundable = roundMoney(invoice.amountPaid - invoice.amountRefunded);
    if (amount > refundable) throw badRequest(`Refund exceeds the refundable amount of ${refundable.toFixed(2)}`);
    const refunded = roundMoney(invoice.amountRefunded + amount);
    const updated = await Invoice.updateOne(
      { _id: invoice._id, amountRefunded: invoice.amountRefunded },
      { $set: { amountRefunded: refunded, status: statusFor(invoice.total, invoice.amountPaid, refunded) } },
      withSession(session),
    );
    if (updated.modifiedCount === 0) throw conflict('The invoice changed while saving. Refresh and try again.');
    const [refund] = await Payment.create(
      [
        {
          receiptNumber: await nextReceiptNumber(session),
          invoice: invoice._id,
          patient: invoice.patient,
          type: 'refund',
          amount,
          method: input.method,
          reference: input.reference ?? undefined,
          note: input.note,
          date: toHospitalDate(),
          receivedBy: actor.userId,
        },
      ],
      withSession(session),
    );
    await recordAudit(
      actor,
      {
        action: 'invoice.refund',
        resource: 'invoice',
        resourceId: invoice.id,
        patient: invoice.patient,
        metadata: { receipt: refund.receiptNumber, amount, reason: input.note },
      },
      session,
    );
  });
  return getInvoice(invoiceId);
}

export async function cancelInvoice(actor: Actor, invoiceId: string, reason: string) {
  await runInTransaction(async (session) => {
    const invoice = await Invoice.findById(invoiceId).session(session);
    if (!invoice) throw notFound('Invoice');
    if (invoice.status === 'cancelled') throw conflict('Invoice is already cancelled');
    if (invoice.amountPaid > 0) {
      throw new AppError(409, 'HAS_PAYMENTS', 'Invoices with payments cannot be cancelled. Record a refund instead.');
    }
    invoice.status = 'cancelled';
    invoice.cancelledAt = new Date();
    invoice.cancelledBy = actor.userId as never;
    invoice.cancelReason = reason;
    await invoice.save({ session });
    // Linked charges return to the pending list so they can be billed correctly.
    await Charge.updateMany(
      { invoice: invoice._id, status: 'billed' },
      { $set: { status: 'pending' }, $unset: { invoice: 1 } },
      withSession(session),
    );
    await recordAudit(
      actor,
      {
        action: 'invoice.cancel',
        resource: 'invoice',
        resourceId: invoice.id,
        patient: invoice.patient,
        metadata: { reason, total: invoice.total },
      },
      session,
    );
  });
  return getInvoice(invoiceId);
}
