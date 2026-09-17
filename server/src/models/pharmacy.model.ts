import { Schema, model } from 'mongoose';
import { INVENTORY_TX_TYPES, MEDICINE_FORMS } from '@hms/shared';
import { applyJsonTransform } from './_helpers.js';

const medicineSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    genericName: { type: String, trim: true },
    brand: { type: String, trim: true },
    manufacturer: { type: String, trim: true },
    category: { type: String, trim: true },
    form: { type: String, enum: MEDICINE_FORMS, default: 'tablet' },
    strength: { type: String, trim: true },
    unit: { type: String, default: 'tablet' },
    reorderLevel: { type: Number, default: 10, min: 0 },
    hsnCode: String,
    taxRate: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
medicineSchema.index({ name: 1, strength: 1, form: 1 }, { unique: true });
medicineSchema.index({ genericName: 1 });
applyJsonTransform(medicineSchema);

export const Medicine = model('Medicine', medicineSchema, 'medications');

/**
 * Stock is held per batch. Quantities only change through inventory
 * transactions, so every unit can be traced.
 */
const batchSchema = new Schema(
  {
    medicine: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true },
    batchNumber: { type: String, required: true, trim: true, uppercase: true },
    expiryDate: { type: Date, required: true },
    quantity: { type: Number, required: true, min: 0 },
    receivedQuantity: { type: Number, required: true, min: 0 },
    purchasePrice: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    supplier: String,
    supplierInvoice: String,
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
batchSchema.index({ medicine: 1, batchNumber: 1 }, { unique: true });
batchSchema.index({ medicine: 1, expiryDate: 1 });
batchSchema.index({ expiryDate: 1, quantity: 1 });
applyJsonTransform(batchSchema);

export const InventoryBatch = model('InventoryBatch', batchSchema, 'inventory');

const inventoryTransactionSchema = new Schema(
  {
    medicine: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true },
    batch: { type: Schema.Types.ObjectId, ref: 'InventoryBatch', required: true },
    type: { type: String, enum: INVENTORY_TX_TYPES, required: true },
    /** Signed change: positive adds stock, negative removes it. */
    quantity: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    unitPrice: Number,
    referenceNumber: String,
    prescription: { type: Schema.Types.ObjectId, ref: 'Prescription' },
    prescriptionItem: { type: Schema.Types.ObjectId },
    patient: { type: Schema.Types.ObjectId, ref: 'Patient' },
    reason: String,
    performedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
inventoryTransactionSchema.index({ medicine: 1, createdAt: -1 });
inventoryTransactionSchema.index({ type: 1, createdAt: -1 });
inventoryTransactionSchema.index({ referenceNumber: 1 });
applyJsonTransform(inventoryTransactionSchema);

export const InventoryTransaction = model(
  'InventoryTransaction',
  inventoryTransactionSchema,
  'inventory_transactions',
);
