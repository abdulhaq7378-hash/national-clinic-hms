import type { PipelineStage } from 'mongoose';
import { escapeRegex } from '@hms/shared';
import { Medicine } from '../models/index.js';

export type StockFilter = 'all' | 'low_stock' | 'expiring' | 'expired' | 'out_of_stock';

/**
 * Medicine list with stock derived from batches. Stock is never stored twice:
 * batches are the single source of on-hand quantity.
 */
export async function medicineStockList(params: {
  q?: string;
  filter: StockFilter;
  expiryAlertDays: number;
  page: number;
  limit: number;
  activeOnly?: boolean;
}) {
  const now = new Date();
  const soon = new Date(now.getTime() + params.expiryAlertDays * 24 * 60 * 60 * 1000);
  const match: Record<string, unknown> = {};
  if (params.activeOnly) match.isActive = true;
  if (params.q) {
    const rx = { $regex: escapeRegex(params.q), $options: 'i' };
    match.$or = [{ name: rx }, { genericName: rx }, { brand: rx }];
  }

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $lookup: {
        from: 'inventory',
        localField: '_id',
        foreignField: 'medicine',
        as: 'batches',
        pipeline: [{ $match: { quantity: { $gt: 0 } } }, { $project: { quantity: 1, expiryDate: 1 } }],
      },
    },
    {
      $addFields: {
        stock: {
          $sum: {
            $map: {
              input: { $filter: { input: '$batches', cond: { $gt: ['$$this.expiryDate', now] } } },
              in: '$$this.quantity',
            },
          },
        },
        expiredStock: {
          $sum: {
            $map: {
              input: { $filter: { input: '$batches', cond: { $lte: ['$$this.expiryDate', now] } } },
              in: '$$this.quantity',
            },
          },
        },
        nearestExpiry: {
          $min: {
            $map: {
              input: { $filter: { input: '$batches', cond: { $gt: ['$$this.expiryDate', now] } } },
              in: '$$this.expiryDate',
            },
          },
        },
        batchCount: { $size: '$batches' },
      },
    },
    { $project: { batches: 0, __v: 0 } },
  ];

  const filterStage: Record<StockFilter, Record<string, unknown> | null> = {
    all: null,
    low_stock: { $expr: { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$reorderLevel'] }] }, isActive: true },
    out_of_stock: { stock: 0, isActive: true },
    expiring: { nearestExpiry: { $lte: soon } },
    expired: { expiredStock: { $gt: 0 } },
  };
  const extra = filterStage[params.filter];
  if (extra) pipeline.push({ $match: extra });

  const [result] = await Medicine.aggregate<{
    // Aggregation output: medicine fields plus computed stock figures.
    items: Record<string, any>[];
    total: { count: number }[];
  }>([
    ...pipeline,
    { $sort: { name: 1, strength: 1 } },
    {
      $facet: {
        items: [{ $skip: (params.page - 1) * params.limit }, { $limit: params.limit }],
        total: [{ $count: 'count' }],
      },
    },
  ]);
  const items: Record<string, any>[] = result.items.map((row) => ({ ...row, id: String(row._id) }));
  return { items, total: result.total[0]?.count ?? 0 };
}

export async function stockCounts(expiryAlertDays: number) {
  const [low, out, expiring, expired] = await Promise.all(
    (['low_stock', 'out_of_stock', 'expiring', 'expired'] as const).map((filter) =>
      medicineStockList({ filter, expiryAlertDays, page: 1, limit: 1, activeOnly: filter !== 'expired' }).then(
        (r) => r.total,
      ),
    ),
  );
  return { lowStock: low, outOfStock: out, expiring, expired };
}
