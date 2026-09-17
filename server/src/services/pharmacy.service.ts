import type { ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import {
  REALTIME_EVENTS,
  medicineUpdateSchema,
  type DispenseInput,
  type StockInInput,
} from '@hms/shared';
import type { z } from 'zod';
import {
  InventoryBatch,
  InventoryTransaction,
  Medicine,
  Patient,
  Prescription,
} from '../models/index.js';
import { runInTransaction, withSession } from '../db/transaction.js';
import { publish } from '../realtime/event-bus.js';
import { medicineStockList, stockCounts, type StockFilter } from '../repositories/inventory.repository.js';
import { patientPopulate, userNamePopulate } from '../repositories/populate.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { skipFor } from '../utils/http.js';
import { recordAudit } from './audit.service.js';
import { addAutoCharge } from './billing.service.js';
import { nextDocumentNumber } from './counter.service.js';
import { notify } from './notification.service.js';
import { getSettings } from './settings.service.js';
import type { Actor } from './actor.js';

type MedicineUpdateInput = z.infer<typeof medicineUpdateSchema>;

async function expiryDays() {
  const settings = await getSettings();
  return settings.pharmacy?.expiryAlertDays ?? 90;
}

export async function listInventory(q: { q?: string; filter: StockFilter; page: number; limit: number }) {
  return medicineStockList({ ...q, expiryAlertDays: await expiryDays() });
}

export async function inventoryAlerts() {
  const days = await expiryDays();
  const [counts, lowStock, expiring, expired] = await Promise.all([
    stockCounts(days),
    medicineStockList({ filter: 'low_stock', expiryAlertDays: days, page: 1, limit: 10, activeOnly: true }),
    InventoryBatch.find({
      quantity: { $gt: 0 },
      expiryDate: { $gt: new Date(), $lte: new Date(Date.now() + days * 86_400_000) },
    })
      .populate({ path: 'medicine', select: 'name strength form unit' })
      .sort({ expiryDate: 1 })
      .limit(10),
    InventoryBatch.find({ quantity: { $gt: 0 }, expiryDate: { $lte: new Date() } })
      .populate({ path: 'medicine', select: 'name strength form unit' })
      .sort({ expiryDate: 1 })
      .limit(10),
  ]);
  return { counts, expiryAlertDays: days, lowStock: lowStock.items, expiring, expired };
}

export async function getMedicine(id: string) {
  const medicine = await Medicine.findById(id);
  if (!medicine) throw notFound('Medicine');
  const [batches, transactions] = await Promise.all([
    InventoryBatch.find({ medicine: id }).sort({ expiryDate: 1 }).populate(userNamePopulate('receivedBy')),
    InventoryTransaction.find({ medicine: id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate(userNamePopulate('performedBy'))
      .populate({ path: 'batch', select: 'batchNumber' })
      .populate(patientPopulate),
  ]);
  const now = new Date();
  const stock = batches.filter((b) => b.expiryDate > now).reduce((sum, b) => sum + b.quantity, 0);
  return { ...medicine.toJSON(), stock, batches, transactions };
}

export async function createMedicine(actor: Actor, input: Record<string, unknown>) {
  const medicine = await Medicine.create(input);
  await recordAudit(actor, {
    action: 'medicine.create',
    resource: 'medicine',
    resourceId: medicine.id,
    metadata: { name: medicine.name },
  });
  return medicine;
}

export async function updateMedicine(actor: Actor, id: string, input: MedicineUpdateInput) {
  const medicine = await Medicine.findById(id);
  if (!medicine) throw notFound('Medicine');
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) medicine.set(key, value);
  }
  await medicine.save();
  await recordAudit(actor, {
    action: 'medicine.update',
    resource: 'medicine',
    resourceId: id,
    metadata: { fields: Object.keys(input) },
  });
  return medicine;
}

export async function searchMedicinesForPrescribing(q: string) {
  const { items } = await medicineStockList({
    q,
    filter: 'all',
    expiryAlertDays: await expiryDays(),
    page: 1,
    limit: 15,
    activeOnly: true,
  });
  return items;
}

export async function stockIn(actor: Actor, input: StockInInput) {
  const medicine = await Medicine.findById(input.medicine);
  if (!medicine) throw notFound('Medicine');
  const expiry = new Date(`${input.expiryDate}T23:59:59+05:30`);
  if (expiry <= new Date()) throw badRequest('Expired stock cannot be received');
  const batchNumber = input.batchNumber.toUpperCase();

  const result = await runInTransaction(async (session) => {
    const existing = await InventoryBatch.findOne({ medicine: medicine._id, batchNumber }).session(session);
    let batch;
    if (existing) {
      if (existing.expiryDate.toISOString().slice(0, 10) !== expiry.toISOString().slice(0, 10)) {
        throw conflict(`Batch ${batchNumber} is already recorded with a different expiry date`);
      }
      batch = await InventoryBatch.findOneAndUpdate(
        { _id: existing._id },
        {
          $inc: { quantity: input.quantity, receivedQuantity: input.quantity },
          $set: { sellingPrice: input.sellingPrice, purchasePrice: input.purchasePrice },
        },
        { returnDocument: 'after', ...withSession(session) },
      );
    } else {
      [batch] = await InventoryBatch.create(
        [
          {
            medicine: medicine._id,
            batchNumber,
            expiryDate: expiry,
            quantity: input.quantity,
            receivedQuantity: input.quantity,
            purchasePrice: input.purchasePrice,
            sellingPrice: input.sellingPrice,
            supplier: input.supplier ?? undefined,
            supplierInvoice: input.supplierInvoice ?? undefined,
            receivedBy: actor.userId,
          },
        ],
        withSession(session),
      );
    }
    const [tx] = await InventoryTransaction.create(
      [
        {
          medicine: medicine._id,
          batch: batch!._id,
          type: 'stock_in',
          quantity: input.quantity,
          balanceAfter: batch!.quantity,
          unitPrice: input.purchasePrice,
          referenceNumber: input.supplierInvoice ?? undefined,
          reason: input.supplier ? `Received from ${input.supplier}` : 'Stock received',
          performedBy: actor.userId,
        },
      ],
      withSession(session),
    );
    await recordAudit(
      actor,
      {
        action: 'inventory.stock_in',
        resource: 'inventory',
        resourceId: batch!.id,
        metadata: { medicine: medicine.name, batch: batchNumber, quantity: input.quantity, tx: tx.id },
      },
      session,
    );
    return batch!;
  });
  return result;
}

export async function adjustStock(
  actor: Actor,
  input: { batch: string; type: 'adjustment' | 'write_off' | 'return'; quantityChange: number; reason: string },
) {
  if (input.type === 'write_off' && input.quantityChange > 0) {
    throw badRequest('A write-off must reduce stock');
  }
  return runInTransaction(async (session) => {
    const filter: Record<string, unknown> = { _id: input.batch };
    if (input.quantityChange < 0) filter.quantity = { $gte: -input.quantityChange };
    const batch = await InventoryBatch.findOneAndUpdate(
      filter,
      { $inc: { quantity: input.quantityChange } },
      { returnDocument: 'after', ...withSession(session) },
    );
    if (!batch) {
      const exists = await InventoryBatch.exists({ _id: input.batch }).session(session);
      if (!exists) throw notFound('Batch');
      throw conflict('The adjustment would make the batch quantity negative');
    }
    const [tx] = await InventoryTransaction.create(
      [
        {
          medicine: batch.medicine,
          batch: batch._id,
          type: input.type,
          quantity: input.quantityChange,
          balanceAfter: batch.quantity,
          reason: input.reason,
          performedBy: actor.userId,
        },
      ],
      withSession(session),
    );
    await recordAudit(
      actor,
      {
        action: `inventory.${input.type}`,
        resource: 'inventory',
        resourceId: batch.id,
        metadata: { change: input.quantityChange, reason: input.reason, tx: tx.id },
      },
      session,
    );
    return batch;
  });
}

interface DispenseLine {
  medicineId: Types.ObjectId;
  quantity: number;
  prescriptionItemId?: Types.ObjectId;
}

/**
 * Takes stock first-expiry-first-out from unexpired batches. Each batch
 * decrement is conditional, so concurrent dispensing can never oversell.
 */
async function takeStock(
  actor: Actor,
  line: DispenseLine,
  ctx: { referenceNumber: string; patientId: Types.ObjectId; prescriptionId?: Types.ObjectId },
  session: ClientSession | null,
) {
  const medicine = await Medicine.findById(line.medicineId).session(session);
  if (!medicine) throw notFound('Medicine');
  const batches = await InventoryBatch.find({
    medicine: line.medicineId,
    quantity: { $gt: 0 },
    expiryDate: { $gt: new Date() },
  })
    .sort({ expiryDate: 1 })
    .session(session);
  const available = batches.reduce((sum, b) => sum + b.quantity, 0);
  if (available < line.quantity) {
    throw conflict(`Only ${available} ${medicine.unit} of ${medicine.name} in stock`);
  }

  let remaining = line.quantity;
  const taken: { batchNumber: string; quantity: number; unitPrice: number }[] = [];
  for (const batch of batches) {
    if (remaining === 0) break;
    const take = Math.min(batch.quantity, remaining);
    const updated = await InventoryBatch.findOneAndUpdate(
      { _id: batch._id, quantity: { $gte: take } },
      { $inc: { quantity: -take } },
      { returnDocument: 'after', ...withSession(session) },
    );
    if (!updated) throw conflict('Stock changed while dispensing. Please try again.');
    const [tx] = await InventoryTransaction.create(
      [
        {
          medicine: medicine._id,
          batch: batch._id,
          type: 'dispense',
          quantity: -take,
          balanceAfter: updated.quantity,
          unitPrice: batch.sellingPrice,
          referenceNumber: ctx.referenceNumber,
          prescription: ctx.prescriptionId,
          prescriptionItem: line.prescriptionItemId,
          patient: ctx.patientId,
          performedBy: actor.userId,
        },
      ],
      withSession(session),
    );
    await addAutoCharge(
      actor,
      {
        patient: ctx.patientId,
        category: 'pharmacy',
        description: `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ''} (batch ${batch.batchNumber})`,
        quantity: take,
        unitPrice: batch.sellingPrice,
        taxRate: medicine.taxRate ?? 0,
        sourceKind: 'dispense',
        sourceId: tx._id,
        sourceKey: `dispense:${tx.id}`,
      },
      session,
    );
    taken.push({ batchNumber: batch.batchNumber, quantity: take, unitPrice: batch.sellingPrice });
    remaining -= take;
  }

  const stockLeft = available - line.quantity;
  return { medicine, taken, stockLeft };
}

export async function dispense(actor: Actor, input: DispenseInput) {
  const referenceNumber = await nextDocumentNumber('DS');
  const lowStockAlerts: { name: string; stockLeft: number }[] = [];

  const summary = await runInTransaction(async (session) => {
    lowStockAlerts.length = 0;
    let patientId: Types.ObjectId;
    let prescription = null;
    const lines: DispenseLine[] = [];

    if (input.prescription) {
      prescription = await Prescription.findById(input.prescription).session(session);
      if (!prescription) throw notFound('Prescription');
      if (!['active', 'partially_dispensed'].includes(prescription.status)) {
        throw conflict(`Prescription is ${prescription.status.replace('_', ' ')}`);
      }
      patientId = prescription.patient as Types.ObjectId;
      for (const entry of input.items) {
        if (!entry.prescriptionItem) throw badRequest('Each line must reference a prescription item');
        const item = prescription.items.id(entry.prescriptionItem);
        if (!item) throw badRequest('Prescription item not found');
        const medicineId = entry.medicine ?? item.medicine;
        if (!medicineId) {
          throw badRequest(`Select the pharmacy stock item to dispense for "${item.medicineName}"`);
        }
        if (item.quantity) {
          const left = item.quantity - (item.dispensedQuantity ?? 0);
          if (entry.quantity > left) {
            throw badRequest(`Only ${left} left to dispense for ${item.medicineName}`);
          }
        }
        lines.push({
          medicineId: new Types.ObjectId(String(medicineId)),
          quantity: entry.quantity,
          prescriptionItemId: item._id,
        });
        item.dispensedQuantity = (item.dispensedQuantity ?? 0) + entry.quantity;
        if (!item.medicine) item.medicine = new Types.ObjectId(String(medicineId));
      }
    } else {
      const patient = await Patient.findById(input.patient).session(session).select('_id');
      if (!patient) throw notFound('Patient');
      patientId = patient._id;
      for (const entry of input.items) {
        if (!entry.medicine) throw badRequest('Each line must specify a medicine');
        lines.push({ medicineId: new Types.ObjectId(entry.medicine), quantity: entry.quantity });
      }
    }

    const dispensed = [];
    for (const line of lines) {
      const result = await takeStock(
        actor,
        line,
        { referenceNumber, patientId, prescriptionId: prescription?._id },
        session,
      );
      dispensed.push({
        medicine: result.medicine.name,
        strength: result.medicine.strength,
        quantity: line.quantity,
        batches: result.taken,
      });
      if (result.stockLeft <= (result.medicine.reorderLevel ?? 0)) {
        lowStockAlerts.push({ name: result.medicine.name, stockLeft: result.stockLeft });
      }
    }

    if (prescription) {
      // Lines with no stock link and no quantity (advice such as steam inhalation) are not dispensable.
      const allDone = prescription.items.every((i) => {
        if (i.quantity) return (i.dispensedQuantity ?? 0) >= i.quantity;
        return i.medicine ? (i.dispensedQuantity ?? 0) > 0 : true;
      });
      const nextStatus = allDone ? 'dispensed' : 'partially_dispensed';
      if (prescription.status !== nextStatus) {
        prescription.status = nextStatus;
        prescription.statusHistory.push({
          status: nextStatus,
          by: actor.userId,
          at: new Date(),
          note: referenceNumber,
        });
      }
      await prescription.save({ session });
    }

    await recordAudit(
      actor,
      {
        action: 'pharmacy.dispense',
        resource: prescription ? 'prescription' : 'patient',
        resourceId: prescription?.id ?? String(patientId),
        patient: patientId,
        metadata: {
          referenceNumber,
          lines: dispensed.map((d) => ({ medicine: d.medicine, quantity: d.quantity })),
          note: input.note ?? undefined,
        },
      },
      session,
    );
    return { referenceNumber, patient: String(patientId), prescription: prescription?.id, dispensed };
  });

  if (summary.prescription) {
    publish({
      type: REALTIME_EVENTS.prescriptionChanged,
      payload: { id: summary.prescription },
      permission: 'prescription:read',
    });
  }
  for (const alert of lowStockAlerts) {
    await notify({
      roles: ['pharmacist'],
      type: 'pharmacy.low_stock',
      title: 'Low stock',
      message: `${alert.name}: ${alert.stockLeft} left after dispensing`,
      link: '/pharmacy?filter=low_stock',
      severity: alert.stockLeft === 0 ? 'critical' : 'warning',
    });
  }
  return summary;
}

export async function listTransactions(q: {
  medicine?: string;
  type?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}) {
  const filter: Record<string, unknown> = {};
  if (q.medicine) filter.medicine = q.medicine;
  if (q.type) filter.type = q.type;
  if (q.from || q.to) {
    filter.createdAt = {
      ...(q.from && { $gte: new Date(`${q.from}T00:00:00+05:30`) }),
      ...(q.to && { $lte: new Date(`${q.to}T23:59:59.999+05:30`) }),
    };
  }
  const [items, total] = await Promise.all([
    InventoryTransaction.find(filter)
      .populate({ path: 'medicine', select: 'name strength unit' })
      .populate({ path: 'batch', select: 'batchNumber expiryDate' })
      .populate(patientPopulate)
      .populate(userNamePopulate('performedBy'))
      .sort({ createdAt: -1 })
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit),
    InventoryTransaction.countDocuments(filter),
  ]);
  return { items, total };
}
