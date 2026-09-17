import type { Permission } from '@hms/shared';
import { HOSPITAL_TIMEZONE, addDays, formatEnum, roundMoney, toHospitalDate } from '@hms/shared';
import {
  Admission,
  Appointment,
  Bed,
  Consultation,
  InventoryBatch,
  Invoice,
  LabOrder,
  Patient,
  Payment,
  Referral,
  Token,
  Ward,
} from '../models/index.js';
import { medicineStockList } from '../repositories/inventory.repository.js';
import { doctorPopulate, patientPopulate } from '../repositories/populate.js';
import type { ReportColumn } from '../utils/csv.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { getSettings } from './settings.service.js';
import type { Actor } from './actor.js';

export interface ReportResult {
  key: string;
  title: string;
  range?: { from: string; to: string };
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summary?: { label: string; value: string | number; type?: ReportColumn['type'] }[];
}

interface Range {
  from: string;
  to: string;
}

interface ReportDefinition {
  title: string;
  description: string;
  permissions: Permission[];
  needsRange: boolean;
  run: (range: Range) => Promise<Omit<ReportResult, 'key' | 'title' | 'range'>>;
}

const MAX_RANGE_DAYS = 366;

const istDate = (field: string) => ({
  $dateToString: { format: '%Y-%m-%d', date: field, timezone: HOSPITAL_TIMEZONE },
});
const startOf = (date: string) => new Date(`${date}T00:00:00+05:30`);
const endOf = (date: string) => new Date(`${date}T23:59:59.999+05:30`);

function eachDay(range: Range) {
  const days: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d);
  return days;
}

type Named = { user?: { name?: string } } | null | undefined;
const doctorName = (d: unknown) => (d as Named)?.user?.name ?? '';
type PatientRef = { uhid?: string; fullName?: string } | null | undefined;

const REPORTS: Record<string, ReportDefinition> = {
  'daily-patients': {
    title: 'Daily patient report',
    description: 'New registrations and OPD visits per day',
    permissions: ['report:read', 'queue:read'],
    needsRange: true,
    async run(range) {
      const [registrations, visits] = await Promise.all([
        Patient.aggregate<{ _id: string; count: number }>([
          { $match: { createdAt: { $gte: startOf(range.from), $lte: endOf(range.to) } } },
          { $group: { _id: istDate('$createdAt'), count: { $sum: 1 } } },
        ]),
        Token.aggregate<{ _id: string; visits: number; walkIns: number; completed: number; patients: unknown[] }>([
          { $match: { date: { $gte: range.from, $lte: range.to }, status: { $ne: 'cancelled' } } },
          {
            $group: {
              _id: '$date',
              visits: { $sum: 1 },
              walkIns: { $sum: { $cond: [{ $eq: ['$visitType', 'walk_in'] }, 1, 0] } },
              completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
              patients: { $addToSet: '$patient' },
            },
          },
        ]),
      ]);
      const reg = new Map(registrations.map((r) => [r._id, r.count]));
      const vis = new Map(visits.map((v) => [v._id, v]));
      const rows = eachDay(range).map((date) => {
        const v = vis.get(date);
        return {
          date,
          newRegistrations: reg.get(date) ?? 0,
          visits: v?.visits ?? 0,
          uniquePatients: v?.patients.length ?? 0,
          walkIns: v?.walkIns ?? 0,
          appointments: (v?.visits ?? 0) - (v?.walkIns ?? 0),
          completed: v?.completed ?? 0,
        };
      });
      const sum = (k: keyof (typeof rows)[number]) => rows.reduce((n, r) => n + (r[k] as number), 0);
      return {
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'newRegistrations', label: 'New registrations', type: 'number' },
          { key: 'visits', label: 'OPD visits', type: 'number' },
          { key: 'uniquePatients', label: 'Unique patients', type: 'number' },
          { key: 'appointments', label: 'By appointment', type: 'number' },
          { key: 'walkIns', label: 'Walk-ins', type: 'number' },
          { key: 'completed', label: 'Consulted', type: 'number' },
        ],
        rows,
        summary: [
          { label: 'New registrations', value: sum('newRegistrations') },
          { label: 'OPD visits', value: sum('visits') },
          { label: 'Walk-ins', value: sum('walkIns') },
        ],
      };
    },
  },

  appointments: {
    title: 'Appointment report',
    description: 'All appointments with status and source',
    permissions: ['report:read', 'appointment:read'],
    needsRange: true,
    async run(range) {
      const items = await Appointment.find({ date: { $gte: range.from, $lte: range.to } })
        .populate(patientPopulate)
        .populate(doctorPopulate('doctor'))
        .sort({ date: 1, startTime: 1 })
        .limit(5000);
      const byStatus = new Map<string, number>();
      const rows = items.map((a) => {
        byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1);
        const p = a.patient as unknown as PatientRef;
        return {
          date: a.date,
          time: a.startTime,
          uhid: p?.uhid,
          patient: p?.fullName,
          doctor: doctorName(a.doctor),
          type: formatEnum(a.type),
          source: formatEnum(a.source),
          status: formatEnum(a.status),
        };
      });
      return {
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'time', label: 'Time' },
          { key: 'uhid', label: 'UHID' },
          { key: 'patient', label: 'Patient' },
          { key: 'doctor', label: 'Doctor' },
          { key: 'type', label: 'Type' },
          { key: 'source', label: 'Source' },
          { key: 'status', label: 'Status' },
        ],
        rows,
        summary: [
          { label: 'Total', value: rows.length },
          ...[...byStatus.entries()].map(([status, count]) => ({ label: formatEnum(status), value: count })),
        ],
      };
    },
  },

  consultations: {
    title: 'Doctor consultation report',
    description: 'Consultations per doctor',
    permissions: ['report:read', 'analytics:read'],
    needsRange: true,
    async run(range) {
      const grouped = await Consultation.aggregate<{
        _id: unknown;
        completed: number;
        drafts: number;
        followUps: number;
        patients: unknown[];
      }>([
        { $match: { date: { $gte: range.from, $lte: range.to } } },
        {
          $group: {
            _id: '$doctor',
            completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            drafts: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
            followUps: { $sum: { $cond: [{ $ifNull: ['$followUpDate', false] }, 1, 0] } },
            patients: { $addToSet: '$patient' },
          },
        },
      ]);
      const doctors = await Consultation.populate(
        grouped.map((g) => ({ doctor: g._id })),
        doctorPopulate('doctor'),
      );
      const rows = grouped
        .map((g, i) => ({
          doctor: doctorName(doctors[i].doctor),
          specialization: (doctors[i].doctor as { specialization?: string } | null)?.specialization ?? '',
          completed: g.completed,
          drafts: g.drafts,
          uniquePatients: g.patients.length,
          followUps: g.followUps,
        }))
        .sort((a, b) => b.completed - a.completed);
      return {
        columns: [
          { key: 'doctor', label: 'Doctor' },
          { key: 'specialization', label: 'Specialization' },
          { key: 'completed', label: 'Completed', type: 'number' },
          { key: 'drafts', label: 'Open drafts', type: 'number' },
          { key: 'uniquePatients', label: 'Unique patients', type: 'number' },
          { key: 'followUps', label: 'Follow-ups advised', type: 'number' },
        ],
        rows,
        summary: [{ label: 'Completed consultations', value: rows.reduce((n, r) => n + r.completed, 0) }],
      };
    },
  },

  revenue: {
    title: 'Revenue report',
    description: 'Billing and collections per day',
    permissions: ['report:read', 'billing:read'],
    needsRange: true,
    async run(range) {
      const [billed, collections, byMethod, byCategory] = await Promise.all([
        Invoice.aggregate<{ _id: string; invoices: number; total: number; discount: number; tax: number }>([
          { $match: { date: { $gte: range.from, $lte: range.to }, status: { $ne: 'cancelled' } } },
          {
            $group: {
              _id: '$date',
              invoices: { $sum: 1 },
              total: { $sum: '$total' },
              discount: { $sum: '$discountTotal' },
              tax: { $sum: '$taxTotal' },
            },
          },
        ]),
        Payment.aggregate<{ _id: { date: string; type: string }; amount: number }>([
          { $match: { date: { $gte: range.from, $lte: range.to } } },
          { $group: { _id: { date: '$date', type: '$type' }, amount: { $sum: '$amount' } } },
        ]),
        Payment.aggregate<{ _id: { method: string; type: string }; amount: number }>([
          { $match: { date: { $gte: range.from, $lte: range.to } } },
          { $group: { _id: { method: '$method', type: '$type' }, amount: { $sum: '$amount' } } },
        ]),
        Invoice.aggregate<{ _id: string; amount: number }>([
          { $match: { date: { $gte: range.from, $lte: range.to }, status: { $ne: 'cancelled' } } },
          { $unwind: '$items' },
          { $group: { _id: '$items.category', amount: { $sum: '$items.amount' } } },
        ]),
      ]);
      const billedByDay = new Map(billed.map((b) => [b._id, b]));
      const paid = new Map<string, { payment: number; refund: number }>();
      for (const c of collections) {
        const entry = paid.get(c._id.date) ?? { payment: 0, refund: 0 };
        entry[c._id.type as 'payment' | 'refund'] += c.amount;
        paid.set(c._id.date, entry);
      }
      const rows = eachDay(range).map((date) => {
        const b = billedByDay.get(date);
        const p = paid.get(date);
        return {
          date,
          invoices: b?.invoices ?? 0,
          billed: roundMoney(b?.total ?? 0),
          discounts: roundMoney(b?.discount ?? 0),
          tax: roundMoney(b?.tax ?? 0),
          collected: roundMoney(p?.payment ?? 0),
          refunded: roundMoney(p?.refund ?? 0),
          net: roundMoney((p?.payment ?? 0) - (p?.refund ?? 0)),
        };
      });
      const total = (k: 'billed' | 'collected' | 'refunded' | 'net') =>
        roundMoney(rows.reduce((n, r) => n + r[k], 0));
      const methods = new Map<string, number>();
      for (const m of byMethod) {
        const sign = m._id.type === 'refund' ? -1 : 1;
        methods.set(m._id.method, roundMoney((methods.get(m._id.method) ?? 0) + sign * m.amount));
      }
      return {
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'invoices', label: 'Invoices', type: 'number' },
          { key: 'billed', label: 'Billed', type: 'currency' },
          { key: 'discounts', label: 'Discounts', type: 'currency' },
          { key: 'tax', label: 'Tax', type: 'currency' },
          { key: 'collected', label: 'Collected', type: 'currency' },
          { key: 'refunded', label: 'Refunded', type: 'currency' },
          { key: 'net', label: 'Net collection', type: 'currency' },
        ],
        rows,
        summary: [
          { label: 'Billed', value: total('billed'), type: 'currency' },
          { label: 'Collected', value: total('collected'), type: 'currency' },
          { label: 'Refunded', value: total('refunded'), type: 'currency' },
          { label: 'Net collection', value: total('net'), type: 'currency' },
          ...[...methods.entries()].map(([method, amount]) => ({
            label: `Net via ${formatEnum(method)}`,
            value: amount,
            type: 'currency' as const,
          })),
          ...byCategory.map((c) => ({
            label: `Billed for ${formatEnum(c._id)}`,
            value: roundMoney(c.amount),
            type: 'currency' as const,
          })),
        ],
      };
    },
  },

  'pharmacy-stock': {
    title: 'Pharmacy stock report',
    description: 'Current stock and value for every medicine',
    permissions: ['report:read', 'pharmacy:read'],
    needsRange: false,
    async run() {
      const settings = await getSettings();
      const { items } = await medicineStockList({
        filter: 'all',
        expiryAlertDays: settings.pharmacy?.expiryAlertDays ?? 90,
        page: 1,
        limit: 100000,
      });
      const values = await InventoryBatch.aggregate<{ _id: unknown; purchase: number; selling: number }>([
        { $match: { quantity: { $gt: 0 }, expiryDate: { $gt: new Date() } } },
        {
          $group: {
            _id: '$medicine',
            purchase: { $sum: { $multiply: ['$quantity', '$purchasePrice'] } },
            selling: { $sum: { $multiply: ['$quantity', '$sellingPrice'] } },
          },
        },
      ]);
      const valueMap = new Map(values.map((v) => [String(v._id), v]));
      const rows = items.map((m) => {
        const v = valueMap.get(String(m._id));
        return {
          medicine: m.name,
          genericName: m.genericName ?? '',
          form: formatEnum(m.form as string),
          strength: m.strength ?? '',
          stock: m.stock,
          unit: m.unit,
          reorderLevel: m.reorderLevel,
          purchaseValue: roundMoney(v?.purchase ?? 0),
          sellingValue: roundMoney(v?.selling ?? 0),
          nearestExpiry: m.nearestExpiry ? toHospitalDate(m.nearestExpiry as Date) : '',
          expiredStock: m.expiredStock,
        };
      });
      return {
        columns: [
          { key: 'medicine', label: 'Medicine' },
          { key: 'genericName', label: 'Generic name' },
          { key: 'form', label: 'Form' },
          { key: 'strength', label: 'Strength' },
          { key: 'stock', label: 'Usable stock', type: 'number' },
          { key: 'unit', label: 'Unit' },
          { key: 'reorderLevel', label: 'Reorder level', type: 'number' },
          { key: 'purchaseValue', label: 'Value at cost', type: 'currency' },
          { key: 'sellingValue', label: 'Value at MRP', type: 'currency' },
          { key: 'nearestExpiry', label: 'Nearest expiry', type: 'date' },
          { key: 'expiredStock', label: 'Expired units', type: 'number' },
        ],
        rows,
        summary: [
          { label: 'Medicines', value: rows.length },
          {
            label: 'Stock value at cost',
            value: roundMoney(rows.reduce((n, r) => n + r.purchaseValue, 0)),
            type: 'currency',
          },
        ],
      };
    },
  },

  'low-stock': {
    title: 'Low stock report',
    description: 'Medicines at or below reorder level',
    permissions: ['report:read', 'pharmacy:read'],
    needsRange: false,
    async run() {
      const settings = await getSettings();
      const days = settings.pharmacy?.expiryAlertDays ?? 90;
      const [low, out] = await Promise.all([
        medicineStockList({ filter: 'low_stock', expiryAlertDays: days, page: 1, limit: 100000, activeOnly: true }),
        medicineStockList({ filter: 'out_of_stock', expiryAlertDays: days, page: 1, limit: 100000, activeOnly: true }),
      ]);
      const rows = [...out.items, ...low.items].map((m) => ({
        medicine: m.name,
        strength: m.strength ?? '',
        stock: m.stock,
        reorderLevel: m.reorderLevel,
        shortfall: Math.max(0, (m.reorderLevel as number) - (m.stock as number)),
        status: m.stock === 0 ? 'Out of stock' : 'Low',
      }));
      return {
        columns: [
          { key: 'medicine', label: 'Medicine' },
          { key: 'strength', label: 'Strength' },
          { key: 'stock', label: 'Stock', type: 'number' },
          { key: 'reorderLevel', label: 'Reorder level', type: 'number' },
          { key: 'shortfall', label: 'Shortfall', type: 'number' },
          { key: 'status', label: 'Status' },
        ],
        rows,
        summary: [
          { label: 'Out of stock', value: out.total },
          { label: 'Low stock', value: low.total },
        ],
      };
    },
  },

  expiry: {
    title: 'Expiry report',
    description: 'Batches expired or expiring within the alert window',
    permissions: ['report:read', 'pharmacy:read'],
    needsRange: false,
    async run() {
      const settings = await getSettings();
      const days = settings.pharmacy?.expiryAlertDays ?? 90;
      const limit = new Date(Date.now() + days * 86_400_000);
      const batches = await InventoryBatch.find({ quantity: { $gt: 0 }, expiryDate: { $lte: limit } })
        .populate({ path: 'medicine', select: 'name strength unit' })
        .sort({ expiryDate: 1 });
      const now = new Date();
      const rows = batches.map((b) => {
        const m = b.medicine as unknown as { name: string; strength?: string; unit?: string };
        return {
          medicine: m?.name,
          strength: m?.strength ?? '',
          batch: b.batchNumber,
          expiry: toHospitalDate(b.expiryDate),
          quantity: b.quantity,
          value: roundMoney(b.quantity * b.purchasePrice),
          status: b.expiryDate <= now ? 'Expired' : `Expires in ${Math.ceil((b.expiryDate.getTime() - now.getTime()) / 86_400_000)} days`,
        };
      });
      return {
        columns: [
          { key: 'medicine', label: 'Medicine' },
          { key: 'strength', label: 'Strength' },
          { key: 'batch', label: 'Batch' },
          { key: 'expiry', label: 'Expiry', type: 'date' },
          { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'value', label: 'Value at cost', type: 'currency' },
          { key: 'status', label: 'Status' },
        ],
        rows,
        summary: [
          { label: 'Alert window (days)', value: days },
          { label: 'Batches', value: rows.length },
          { label: 'Value at risk', value: roundMoney(rows.reduce((n, r) => n + r.value, 0)), type: 'currency' },
        ],
      };
    },
  },

  lab: {
    title: 'Laboratory report',
    description: 'Orders and turnaround per test',
    permissions: ['report:read', 'lab:read'],
    needsRange: true,
    async run(range) {
      const rowsRaw = await LabOrder.aggregate<{
        _id: { code: string; name: string };
        ordered: number;
        released: number;
        cancelled: number;
        tatHours: number | null;
      }>([
        { $match: { date: { $gte: range.from, $lte: range.to } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: { code: '$items.testCode', name: '$items.testName' },
            ordered: { $sum: 1 },
            released: { $sum: { $cond: [{ $eq: ['$status', 'released'] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
            tatHours: {
              $avg: {
                $cond: [
                  { $ifNull: ['$releasedAt', false] },
                  { $divide: [{ $subtract: ['$releasedAt', '$createdAt'] }, 3_600_000] },
                  null,
                ],
              },
            },
          },
        },
        { $sort: { ordered: -1 } },
      ]);
      const rows = rowsRaw.map((r) => ({
        code: r._id.code,
        test: r._id.name,
        ordered: r.ordered,
        released: r.released,
        pending: r.ordered - r.released - r.cancelled,
        cancelled: r.cancelled,
        tatHours: r.tatHours === null ? '' : roundMoney(r.tatHours),
      }));
      return {
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'test', label: 'Test' },
          { key: 'ordered', label: 'Ordered', type: 'number' },
          { key: 'released', label: 'Reported', type: 'number' },
          { key: 'pending', label: 'Pending', type: 'number' },
          { key: 'cancelled', label: 'Cancelled', type: 'number' },
          { key: 'tatHours', label: 'Avg turnaround (hours)', type: 'number' },
        ],
        rows,
        summary: [{ label: 'Tests ordered', value: rows.reduce((n, r) => n + r.ordered, 0) }],
      };
    },
  },

  'bed-occupancy': {
    title: 'Bed occupancy report',
    description: 'Admissions, discharges and occupied bed-days per ward',
    permissions: ['report:read', 'bed:read'],
    needsRange: true,
    async run(range) {
      const rangeStart = startOf(range.from);
      const rangeEnd = endOf(range.to);
      const days = eachDay(range).length;
      const [wards, beds, admissions] = await Promise.all([
        Ward.find({ isActive: true }).sort({ name: 1 }),
        Bed.find({ isActive: true }).select('ward'),
        Admission.find({
          admittedAt: { $lte: rangeEnd },
          $or: [{ dischargedAt: null }, { dischargedAt: { $gte: rangeStart } }],
        }).select('stays admittedAt dischargedAt'),
      ]);
      // Includes inactive beds so that historical stays are still attributed to a ward.
      const allBeds = await Bed.find().select('ward');
      const bedWard = new Map(allBeds.map((b) => [String(b._id), String(b.ward)]));

      const stats = new Map<string, { admissions: number; discharges: number; bedDays: number }>();
      const stat = (ward: string) => {
        if (!stats.has(ward)) stats.set(ward, { admissions: 0, discharges: 0, bedDays: 0 });
        return stats.get(ward)!;
      };
      for (const a of admissions) {
        const first = a.stays[0];
        const last = a.stays[a.stays.length - 1];
        if (first && a.admittedAt >= rangeStart && a.admittedAt <= rangeEnd) {
          stat(bedWard.get(String(first.bed)) ?? '').admissions += 1;
        }
        if (last && a.dischargedAt && a.dischargedAt >= rangeStart && a.dischargedAt <= rangeEnd) {
          stat(bedWard.get(String(last.bed)) ?? '').discharges += 1;
        }
        for (const s of a.stays) {
          const from = Math.max(s.from.getTime(), rangeStart.getTime());
          const to = Math.min((s.to ?? new Date()).getTime(), rangeEnd.getTime());
          if (to > from) stat(bedWard.get(String(s.bed)) ?? '').bedDays += (to - from) / 86_400_000;
        }
      }
      const rows = wards.map((w) => {
        const bedCount = beds.filter((b) => String(b.ward) === w.id).length;
        const s = stats.get(w.id) ?? { admissions: 0, discharges: 0, bedDays: 0 };
        return {
          ward: w.name,
          beds: bedCount,
          admissions: s.admissions,
          discharges: s.discharges,
          bedDays: roundMoney(s.bedDays),
          occupancy: bedCount ? roundMoney((s.bedDays / (bedCount * days)) * 100) : 0,
        };
      });
      const totalBeds = rows.reduce((n, r) => n + r.beds, 0);
      const totalBedDays = rows.reduce((n, r) => n + r.bedDays, 0);
      return {
        columns: [
          { key: 'ward', label: 'Ward' },
          { key: 'beds', label: 'Beds', type: 'number' },
          { key: 'admissions', label: 'Admissions', type: 'number' },
          { key: 'discharges', label: 'Discharges', type: 'number' },
          { key: 'bedDays', label: 'Occupied bed-days', type: 'number' },
          { key: 'occupancy', label: 'Occupancy %', type: 'number' },
        ],
        rows,
        summary: [
          { label: 'Beds', value: totalBeds },
          {
            label: 'Overall occupancy %',
            value: totalBeds ? roundMoney((totalBedDays / (totalBeds * days)) * 100) : 0,
          },
        ],
      };
    },
  },

  referrals: {
    title: 'Referral report',
    description: 'Referrals with destination, priority and status',
    permissions: ['report:read', 'referral:read'],
    needsRange: true,
    async run(range) {
      const items = await Referral.find({ referralDate: { $gte: range.from, $lte: range.to } })
        .select('-clinicalNotes -reason')
        .populate(patientPopulate)
        .populate(doctorPopulate('referringDoctor'))
        .sort({ referralDate: 1 })
        .limit(5000);
      const bySpecialty = new Map<string, number>();
      const rows = items.map((r) => {
        bySpecialty.set(r.specialty, (bySpecialty.get(r.specialty) ?? 0) + 1);
        const p = r.patient as unknown as PatientRef;
        return {
          date: r.referralDate,
          number: r.number,
          uhid: p?.uhid,
          patient: p?.fullName,
          specialty: r.specialty,
          referredTo: [r.referredToDoctor, r.hospital].filter(Boolean).join(', '),
          priority: formatEnum(r.priority),
          status: formatEnum(r.status),
          referringDoctor: doctorName(r.referringDoctor),
        };
      });
      return {
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'number', label: 'Referral no.' },
          { key: 'uhid', label: 'UHID' },
          { key: 'patient', label: 'Patient' },
          { key: 'specialty', label: 'Specialty' },
          { key: 'referredTo', label: 'Referred to' },
          { key: 'priority', label: 'Priority' },
          { key: 'status', label: 'Status' },
          { key: 'referringDoctor', label: 'Referred by' },
        ],
        rows,
        summary: [
          { label: 'Referrals', value: rows.length },
          ...[...bySpecialty.entries()].map(([label, value]) => ({ label, value })),
        ],
      };
    },
  },
};

function allowed(actor: Actor, def: ReportDefinition) {
  return def.permissions.every((p) => actor.permissions.includes(p));
}

export function listReports(actor: Actor) {
  return Object.entries(REPORTS)
    .filter(([, def]) => allowed(actor, def))
    .map(([key, def]) => ({ key, title: def.title, description: def.description, needsRange: def.needsRange }));
}

export async function runReport(actor: Actor, key: string, range: Partial<Range>): Promise<ReportResult> {
  const def = REPORTS[key];
  if (!def) throw notFound('Report');
  if (!allowed(actor, def)) throw forbidden();
  let resolved: Range | undefined;
  if (def.needsRange) {
    if (!range.from || !range.to) throw badRequest('Select a date range');
    if (range.from > range.to) throw badRequest('Start date must be on or before end date');
    const span = (new Date(range.to).getTime() - new Date(range.from).getTime()) / 86_400_000;
    if (span > MAX_RANGE_DAYS) throw badRequest(`Reports are limited to ${MAX_RANGE_DAYS} days`);
    resolved = { from: range.from, to: range.to };
  }
  const result = await def.run(resolved ?? { from: '', to: '' });
  return { key, title: def.title, range: resolved, ...result };
}
