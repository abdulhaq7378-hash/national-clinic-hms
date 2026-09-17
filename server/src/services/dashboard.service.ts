import { Types, type Model } from 'mongoose';
import { roundMoney, toHospitalDate } from '@hms/shared';
import {
  Appointment,
  AuditLog,
  Bed,
  Charge,
  Consultation,
  Invoice,
  LabOrder,
  Patient,
  Prescription,
  Token,
} from '../models/index.js';
import { stockCounts } from '../repositories/inventory.repository.js';
import { getSettings } from './settings.service.js';
import type { Actor } from './actor.js';

async function countBy(model: Model<any>, match: Record<string, unknown>, field = 'status') {
  const rows = await model.aggregate<{ _id: string; count: number }>([
    { $match: match },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.count])) as Record<string, number>;
}

/**
 * Role-aware overview. Each section is only computed when the user holds the
 * permission for the underlying module.
 */
export async function getDashboard(actor: Actor) {
  const can = (p: string) => actor.permissions.includes(p as never);
  const today = toHospitalDate();
  const settings = await getSettings();
  const modules = {
    pharmacy: Boolean(settings.modules?.pharmacy),
    laboratory: Boolean(settings.modules?.laboratory),
    beds: Boolean(settings.modules?.beds),
    ot: Boolean(settings.modules?.ot),
  };
  const result: Record<string, unknown> = { date: today, modules };

  const tasks: Promise<void>[] = [];

  if (can('appointment:read')) {
    tasks.push(
      countBy(Appointment, { date: today }).then((byStatus) => {
        const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
        result.appointments = { total, byStatus };
      }),
    );
  }

  if (can('queue:read')) {
    const match: Record<string, unknown> = { date: today };
    if (actor.role === 'doctor' && actor.doctorId) match.doctor = new Types.ObjectId(actor.doctorId);
    tasks.push(
      Promise.all([
        countBy(Token, match),
        Token.distinct('patient', { date: today }),
        Patient.countDocuments({ createdAt: { $gte: new Date(`${today}T00:00:00+05:30`) } }),
      ]).then(([byStatus, visitors, registered]) => {
        result.opd = {
          scope: match.doctor ? 'mine' : 'all',
          waiting: byStatus.waiting ?? 0,
          withDoctor: byStatus.with_doctor ?? 0,
          completed: byStatus.completed ?? 0,
          skipped: byStatus.skipped ?? 0,
        };
        result.patientsToday = { visits: visitors.length, newRegistrations: registered };
      }),
    );
  }

  if (actor.role === 'doctor' && actor.doctorId) {
    tasks.push(
      Consultation.countDocuments({ doctor: actor.doctorId, status: 'draft' }).then((drafts) => {
        result.myDraftConsultations = drafts;
      }),
    );
  }

  if (modules.beds && can('bed:read')) {
    tasks.push(
      countBy(Bed, { isActive: true }).then((byStatus) => {
        const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
        result.beds = {
          total,
          available: byStatus.available ?? 0,
          occupied: byStatus.occupied ?? 0,
          reserved: byStatus.reserved ?? 0,
          cleaning: byStatus.cleaning ?? 0,
          maintenance: byStatus.maintenance ?? 0,
        };
      }),
    );
  }

  if (can('billing:read')) {
    tasks.push(
      Promise.all([
        Invoice.aggregate<{ count: number; balance: number }>([
          { $match: { status: { $in: ['unpaid', 'partially_paid'] } } },
          { $group: { _id: null, count: { $sum: 1 }, balance: { $sum: '$balance' } } },
        ]),
        Charge.aggregate<{ count: number; patients: unknown[] }>([
          { $match: { status: 'pending' } },
          { $group: { _id: null, count: { $sum: 1 }, patients: { $addToSet: '$patient' } } },
        ]),
      ]).then(([invoices, charges]) => {
        result.billing = {
          unpaidInvoices: invoices[0]?.count ?? 0,
          outstanding: roundMoney(invoices[0]?.balance ?? 0),
          pendingCharges: charges[0]?.count ?? 0,
          patientsToBill: charges[0]?.patients.length ?? 0,
        };
      }),
    );
  }

  if (modules.pharmacy && can('pharmacy:read')) {
    tasks.push(
      Promise.all([
        stockCounts(settings.pharmacy?.expiryAlertDays ?? 90),
        can('prescription:read')
          ? Prescription.countDocuments({ status: { $in: ['active', 'partially_dispensed'] } })
          : Promise.resolve(null),
      ]).then(([counts, pending]) => {
        result.pharmacy = { ...counts, pendingPrescriptions: pending };
      }),
    );
  }

  if (modules.laboratory && can('lab:read')) {
    const match: Record<string, unknown> = {
      status: { $in: ['ordered', 'sample_collected', 'processing', 'result_entered', 'verified'] },
    };
    if (actor.role === 'doctor' && actor.doctorId) match.doctor = new Types.ObjectId(actor.doctorId);
    tasks.push(
      countBy(LabOrder, match).then((byStatus) => {
        result.laboratory = { byStatus, pending: Object.values(byStatus).reduce((a, b) => a + b, 0) };
      }),
    );
  }

  const activityFilter = can('audit:read') ? {} : { user: new Types.ObjectId(actor.userId) };
  tasks.push(
    AuditLog.find({ ...activityFilter, outcome: 'success', action: { $not: /^patient\.view/ } })
      .select('at userName action resource resourceId')
      .sort({ at: -1 })
      .limit(8)
      .then((rows) => {
        result.recentActivity = { scope: can('audit:read') ? 'all' : 'mine', items: rows };
      }),
  );

  await Promise.all(tasks);
  return result;
}
