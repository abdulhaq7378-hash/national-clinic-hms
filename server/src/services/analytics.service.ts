import { HOSPITAL_TIMEZONE, addDays, roundMoney } from '@hms/shared';
import {
  Admission,
  Appointment,
  Bed,
  Consultation,
  InventoryTransaction,
  Invoice,
  Patient,
  Payment,
  Token,
} from '../models/index.js';
import { badRequest } from '../utils/errors.js';

const MAX_DAYS = 366;

function days(from: string, to: string) {
  const list: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) list.push(d);
  return list;
}

const istDate = (field: string) => ({
  $dateToString: { format: '%Y-%m-%d', date: field, timezone: HOSPITAL_TIMEZONE },
});

/**
 * Operational time series for the analytics page. Every figure is computed
 * from recorded transactions; nothing is estimated or projected.
 */
export async function getAnalytics(from: string, to: string) {
  if (from > to) throw badRequest('Start date must be on or before end date');
  const dayList = days(from, to);
  if (dayList.length > MAX_DAYS) throw badRequest(`Analytics are limited to ${MAX_DAYS} days`);
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(`${to}T23:59:59.999+05:30`);

  const [registrations, visits, appointments, consultations, billed, payments, pharmacy, beds, admissions] =
    await Promise.all([
      Patient.aggregate<{ _id: string; n: number }>([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: istDate('$createdAt'), n: { $sum: 1 } } },
      ]),
      Token.aggregate<{ _id: string; n: number }>([
        { $match: { date: { $gte: from, $lte: to }, status: { $ne: 'cancelled' } } },
        { $group: { _id: '$date', n: { $sum: 1 } } },
      ]),
      Appointment.aggregate<{ _id: { date: string; status: string }; n: number }>([
        { $match: { date: { $gte: from, $lte: to } } },
        { $group: { _id: { date: '$date', status: '$status' }, n: { $sum: 1 } } },
      ]),
      Consultation.aggregate<{ _id: string; n: number }>([
        { $match: { status: 'completed', completedAt: { $gte: start, $lte: end } } },
        { $group: { _id: istDate('$completedAt'), n: { $sum: 1 } } },
      ]),
      Invoice.aggregate<{ _id: string; total: number }>([
        { $match: { date: { $gte: from, $lte: to }, status: { $ne: 'cancelled' } } },
        { $group: { _id: '$date', total: { $sum: '$total' } } },
      ]),
      Payment.aggregate<{ _id: { date: string; type: string }; amount: number }>([
        { $match: { date: { $gte: from, $lte: to } } },
        { $group: { _id: { date: '$date', type: '$type' }, amount: { $sum: '$amount' } } },
      ]),
      InventoryTransaction.aggregate<{ _id: { date: string; type: string }; units: number }>([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: { date: istDate('$createdAt'), type: '$type' }, units: { $sum: '$quantity' } } },
      ]),
      Bed.countDocuments({ isActive: true }),
      Admission.find({
        admittedAt: { $lte: end },
        $or: [{ dischargedAt: null }, { dischargedAt: { $gte: start } }],
      }).select('admittedAt dischargedAt'),
    ]);

  const map = <T extends { _id: string }>(rows: T[], pick: (r: T) => number) =>
    new Map(rows.map((r) => [r._id, pick(r)]));
  const regMap = map(registrations, (r) => r.n);
  const visitMap = map(visits, (r) => r.n);
  const consultMap = map(consultations, (r) => r.n);
  const billedMap = map(billed, (r) => r.total);

  const series = dayList.map((date) => {
    const apptFor = appointments.filter((a) => a._id.date === date);
    const count = (statuses: string[]) =>
      apptFor.filter((a) => statuses.includes(a._id.status)).reduce((n, a) => n + a.n, 0);
    const collected = payments
      .filter((p) => p._id.date === date)
      .reduce((n, p) => n + (p._id.type === 'refund' ? -p.amount : p.amount), 0);
    const tx = pharmacy.filter((p) => p._id.date === date);
    const dispensed = -tx.filter((t) => t._id.type === 'dispense').reduce((n, t) => n + t.units, 0);
    const received = tx.filter((t) => t._id.type === 'stock_in').reduce((n, t) => n + t.units, 0);

    // Beds occupied at the end of the day (or now, for today).
    const dayEnd = new Date(`${date}T23:59:59.999+05:30`);
    const pointInTime = dayEnd > new Date() ? new Date() : dayEnd;
    const occupied = admissions.filter(
      (a) => a.admittedAt <= pointInTime && (!a.dischargedAt || a.dischargedAt > pointInTime),
    ).length;

    return {
      date,
      newPatients: regMap.get(date) ?? 0,
      visits: visitMap.get(date) ?? 0,
      appointmentsBooked: apptFor.reduce((n, a) => n + a.n, 0),
      appointmentsCompleted: count(['completed']),
      appointmentsMissed: count(['no_show', 'cancelled']),
      consultationsCompleted: consultMap.get(date) ?? 0,
      billed: roundMoney(billedMap.get(date) ?? 0),
      collected: roundMoney(collected),
      unitsDispensed: dispensed,
      unitsReceived: received,
      bedsOccupied: occupied,
      occupancyPercent: beds ? roundMoney((occupied / beds) * 100) : 0,
    };
  });

  const sum = (k: keyof (typeof series)[number]) =>
    roundMoney(series.reduce((n, s) => n + (s[k] as number), 0));
  return {
    from,
    to,
    totalBeds: beds,
    totals: {
      newPatients: sum('newPatients'),
      visits: sum('visits'),
      appointmentsBooked: sum('appointmentsBooked'),
      appointmentsCompleted: sum('appointmentsCompleted'),
      appointmentsMissed: sum('appointmentsMissed'),
      consultationsCompleted: sum('consultationsCompleted'),
      billed: sum('billed'),
      collected: sum('collected'),
      unitsDispensed: sum('unitsDispensed'),
      averageOccupancy: series.length ? roundMoney(sum('occupancyPercent') / series.length) : 0,
    },
    series,
  };
}
