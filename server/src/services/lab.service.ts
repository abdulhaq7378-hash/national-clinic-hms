import {
  LAB_TRANSITIONS,
  PRIORITIES,
  REALTIME_EVENTS,
  formatEnum,
  labTestUpdateSchema,
  toHospitalDate,
  type LabOrderStatus,
  type LabResultsInput,
  type LabTestInput,
} from '@hms/shared';
import type { z } from 'zod';
import { Charge, Consultation, Doctor, LabOrder, LabTest, Patient } from '../models/index.js';
import { runInTransaction, withSession } from '../db/transaction.js';
import { publish } from '../realtime/event-bus.js';
import { doctorPopulate, userNamePopulate } from '../repositories/populate.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { skipFor } from '../utils/http.js';
import { assertClinicalAccess } from './access.service.js';
import { recordAudit } from './audit.service.js';
import { addAutoCharge } from './billing.service.js';
import { nextDocumentNumber } from './counter.service.js';
import { notify } from './notification.service.js';
import { getSettings } from './settings.service.js';
import type { Actor } from './actor.js';

type LabTestUpdateInput = z.infer<typeof labTestUpdateSchema>;

/* --------------------------------- Catalog --------------------------------- */

export function listLabTests(includeInactive: boolean) {
  return LabTest.find(includeInactive ? {} : { isActive: true }).sort({ category: 1, name: 1 });
}

export async function createLabTest(actor: Actor, input: LabTestInput) {
  if (await LabTest.exists({ code: input.code })) throw conflict('A test with this code already exists');
  const test = await LabTest.create(input);
  await recordAudit(actor, {
    action: 'lab_test.create',
    resource: 'lab_test',
    resourceId: test.id,
    metadata: { code: test.code, price: test.price },
  });
  return test;
}

export async function updateLabTest(actor: Actor, id: string, input: LabTestUpdateInput) {
  const test = await LabTest.findById(id);
  if (!test) throw notFound('Lab test');
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) test.set(key, value);
  }
  await test.save();
  await recordAudit(actor, {
    action: 'lab_test.update',
    resource: 'lab_test',
    resourceId: id,
    metadata: { fields: Object.keys(input) },
  });
  return test;
}

/* --------------------------------- Orders ---------------------------------- */

const ORDER_POPULATE = [
  { path: 'patient', select: 'uhid fullName gender dateOfBirth phone' },
  doctorPopulate('doctor'),
  userNamePopulate('orderedBy'),
  userNamePopulate('sampleCollectedBy'),
  userNamePopulate('resultEnteredBy'),
  userNamePopulate('verifiedBy'),
  userNamePopulate('releasedBy'),
  userNamePopulate('statusHistory.by'),
  userNamePopulate('revisions.by'),
];

const RESULT_VISIBLE_STATUSES = ['verified', 'released'];

function canSeeResults(actor: Actor, status: string) {
  if (actor.permissions.includes('lab:process')) return true;
  if (!actor.permissions.includes('medical:read')) return false;
  // Clinicians see results once verified, so they never act on unchecked values.
  return RESULT_VISIBLE_STATUSES.includes(status);
}

function redact(actor: Actor, order: InstanceType<typeof LabOrder>) {
  const json = order.toJSON() as unknown as Record<string, unknown> & { items: Record<string, unknown>[] };
  if (!canSeeResults(actor, order.status)) {
    json.items = json.items.map(({ results: _r, remarks: _m, ...rest }) => ({ ...rest, results: [] }));
    delete json.revisions;
    json.resultsHidden = true;
  }
  return json;
}

export async function getLabOrder(actor: Actor, id: string) {
  const order = await LabOrder.findById(id).populate(ORDER_POPULATE);
  if (!order) throw notFound('Lab order');
  if (actor.role === 'doctor') {
    await assertClinicalAccess(actor, String((order.patient as unknown as { _id: unknown })._id));
  }
  return redact(actor, order);
}

export async function listLabOrders(
  actor: Actor,
  q: { patient?: string; status?: string; from?: string; to?: string; active?: string; page: number; limit: number },
) {
  const filter: Record<string, unknown> = {};
  if (q.patient) {
    if (actor.role === 'doctor') await assertClinicalAccess(actor, q.patient);
    filter.patient = q.patient;
  } else if (actor.role === 'doctor') {
    filter.doctor = actor.doctorId ?? null;
  }
  if (q.status) filter.status = q.status;
  else if (q.active === 'true') filter.status = { $in: ['ordered', 'sample_collected', 'processing', 'result_entered'] };
  if (q.from || q.to) filter.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  const [orders, total] = await Promise.all([
    LabOrder.find(filter)
      .populate(ORDER_POPULATE.slice(0, 3))
      .sort({ priority: 1, createdAt: q.active === 'true' ? 1 : -1 })
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit),
    LabOrder.countDocuments(filter),
  ]);
  return { items: orders.map((o) => redact(actor, o)), total };
}

export async function createLabOrder(
  actor: Actor,
  input: {
    patient: string;
    consultation?: string | null;
    tests: string[];
    priority: (typeof PRIORITIES)[number];
    clinicalNotes?: string | null;
  },
) {
  if (!(await Patient.exists({ _id: input.patient }))) throw notFound('Patient');
  if (actor.role === 'doctor') await assertClinicalAccess(actor, input.patient);
  if (input.consultation) {
    const consultation = await Consultation.findById(input.consultation).select('patient');
    if (!consultation || String(consultation.patient) !== input.patient) {
      throw badRequest('The consultation does not belong to this patient');
    }
  }
  const uniqueTests = [...new Set(input.tests)];
  const tests = await LabTest.find({ _id: { $in: uniqueTests }, isActive: true });
  if (tests.length !== uniqueTests.length) throw badRequest('One or more tests are not available');

  const order = await runInTransaction(async (session) => {
    const [created] = await LabOrder.create(
      [
        {
          orderNumber: await nextDocumentNumber('LAB', session),
          patient: input.patient,
          doctor: actor.doctorId,
          consultation: input.consultation ?? undefined,
          orderedBy: actor.userId,
          date: toHospitalDate(),
          priority: input.priority,
          clinicalNotes: input.clinicalNotes ?? undefined,
          status: 'ordered',
          items: tests.map((t) => ({
            test: t._id,
            testCode: t.code,
            testName: t.name,
            sampleType: t.sampleType,
            parameters: t.parameters,
          })),
          statusHistory: [{ status: 'ordered', by: actor.userId, at: new Date() }],
        },
      ],
      withSession(session),
    );
    for (const item of created.items) {
      const test = tests.find((t) => t._id.equals(item.test))!;
      await addAutoCharge(
        actor,
        {
          patient: input.patient,
          category: 'lab',
          description: `${test.name} (${created.orderNumber})`,
          quantity: 1,
          unitPrice: test.price,
          taxRate: test.taxRate ?? 0,
          sourceKind: 'lab_order',
          sourceId: created._id,
          sourceKey: `lab:${created.id}:${String(item._id)}`,
        },
        session,
      );
    }
    await recordAudit(
      actor,
      {
        action: 'lab_order.create',
        resource: 'lab_order',
        resourceId: created.id,
        patient: input.patient,
        metadata: { orderNumber: created.orderNumber, tests: tests.map((t) => t.code), priority: input.priority },
      },
      session,
    );
    return created;
  });

  publish({ type: REALTIME_EVENTS.labOrderChanged, payload: { id: order.id }, permission: 'lab:read' });
  if (input.priority !== 'routine') {
    await notify({
      roles: ['lab_staff'],
      type: 'lab.priority_order',
      title: `${formatEnum(input.priority)} lab order`,
      message: `${order.orderNumber}: ${tests.map((t) => t.name).join(', ')}`,
      link: `/laboratory/orders/${order.id}`,
      severity: input.priority === 'emergency' ? 'critical' : 'warning',
    });
  }
  return getLabOrder(actor, order.id);
}

async function transition(
  actor: Actor,
  order: InstanceType<typeof LabOrder>,
  to: LabOrderStatus,
  note?: string | null,
) {
  const from = order.status as LabOrderStatus;
  if (!LAB_TRANSITIONS[from].includes(to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `Cannot move order from ${formatEnum(from)} to ${formatEnum(to)}`);
  }
  order.status = to;
  order.statusHistory.push({ status: to, by: actor.userId, at: new Date(), note: note ?? undefined });
}

async function saveAndAnnounce(actor: Actor, order: InstanceType<typeof LabOrder>, action: string, metadata?: Record<string, unknown>) {
  await order.save();
  await recordAudit(actor, {
    action: `lab_order.${action}`,
    resource: 'lab_order',
    resourceId: order.id,
    patient: order.patient,
    metadata: { orderNumber: order.orderNumber, ...metadata },
  });
  publish({ type: REALTIME_EVENTS.labOrderChanged, payload: { id: order.id }, permission: 'lab:read' });
  return getLabOrder(actor, order.id);
}

async function loadOrder(id: string) {
  const order = await LabOrder.findById(id);
  if (!order) throw notFound('Lab order');
  return order;
}

export async function collectSample(actor: Actor, id: string, note?: string | null) {
  const order = await loadOrder(id);
  await transition(actor, order, 'sample_collected', note);
  order.sampleCollectedAt = new Date();
  order.sampleCollectedBy = actor.userId as never;
  return saveAndAnnounce(actor, order, 'sample_collected');
}

export async function startProcessing(actor: Actor, id: string) {
  const order = await loadOrder(id);
  await transition(actor, order, 'processing');
  return saveAndAnnounce(actor, order, 'processing');
}

function flagFor(value: string, low?: number | null, high?: number | null) {
  const n = Number(value);
  if (!Number.isFinite(n) || (low == null && high == null)) return 'normal';
  if (low != null && n < low) return 'low';
  if (high != null && n > high) return 'high';
  return 'normal';
}

function applyResults(order: InstanceType<typeof LabOrder>, input: LabResultsInput) {
  for (const entry of input.items) {
    const item = order.items.id(entry.item);
    if (!item) throw badRequest('Result refers to a test that is not part of this order');
    const params = new Map(item.parameters.map((p) => [p.name, p]));
    item.set(
      'results',
      entry.values.map((v) => {
        const param = params.get(v.parameter);
        return {
          parameter: v.parameter,
          value: v.value,
          unit: param?.unit,
          referenceRange: param?.referenceRange,
          flag: v.flag ?? flagFor(v.value, param?.refLow, param?.refHigh),
        };
      }),
    );
    item.remarks = entry.remarks ?? undefined;
  }
}

/** Saves results. The order moves to "result entered" once every test has values. */
export async function enterResults(actor: Actor, id: string, input: LabResultsInput) {
  const order = await loadOrder(id);
  if (!['processing', 'result_entered'].includes(order.status)) {
    throw conflict(`Results cannot be entered while the order is ${formatEnum(order.status).toLowerCase()}`);
  }
  applyResults(order, input);
  order.resultEnteredAt = new Date();
  order.resultEnteredBy = actor.userId as never;
  const complete = order.items.every((i) => i.results.length > 0);
  if (complete && order.status === 'processing') await transition(actor, order, 'result_entered');
  return saveAndAnnounce(actor, order, 'results_entered', { complete, tests: input.items.length });
}

export async function verifyResults(actor: Actor, id: string) {
  const order = await loadOrder(id);
  const settings = await getSettings();
  if (settings.clinical?.requireIndependentLabVerification && String(order.resultEnteredBy) === actor.userId) {
    throw forbidden('Results must be verified by a different staff member');
  }
  await transition(actor, order, 'verified');
  order.verifiedAt = new Date();
  order.verifiedBy = actor.userId as never;
  return saveAndAnnounce(actor, order, 'verified');
}

export async function releaseReport(actor: Actor, id: string) {
  const order = await loadOrder(id);
  await transition(actor, order, 'released');
  order.releasedAt = new Date();
  order.releasedBy = actor.userId as never;
  const result = await saveAndAnnounce(actor, order, 'released');

  if (order.doctor) {
    const doctor = await Doctor.findById(order.doctor).select('user');
    const abnormal = order.items.some((i) => i.results.some((r) => r.flag !== 'normal'));
    if (doctor) {
      await notify({
        users: [String(doctor.user)],
        type: 'lab.report_released',
        title: abnormal ? 'Lab report with abnormal values' : 'Lab report ready',
        message: `${order.orderNumber}: ${order.items.map((i) => i.testName).join(', ')}`,
        link: `/laboratory/orders/${order.id}`,
        severity: abnormal ? 'warning' : 'info',
      });
    }
  }
  return result;
}

/**
 * Corrects results after verification or release. The previous values are
 * preserved in `revisions`, and the order must be verified again.
 */
export async function amendResults(actor: Actor, id: string, reason: string, input: LabResultsInput) {
  const order = await loadOrder(id);
  if (!['verified', 'released', 'result_entered'].includes(order.status)) {
    throw conflict('Only orders with entered results can be amended');
  }
  order.revisions.push({
    items: order.items.map((i) => ({ testName: i.testName, results: i.results, remarks: i.remarks })),
    reason,
    previousStatus: order.status,
    by: actor.userId,
    at: new Date(),
  });
  applyResults(order, input);
  order.status = 'result_entered';
  order.statusHistory.push({ status: 'result_entered', by: actor.userId, at: new Date(), note: `Amended: ${reason}` });
  order.resultEnteredAt = new Date();
  order.resultEnteredBy = actor.userId as never;
  order.set({ verifiedAt: undefined, verifiedBy: undefined, releasedAt: undefined, releasedBy: undefined });
  return saveAndAnnounce(actor, order, 'amended', { reason });
}

export async function cancelLabOrder(actor: Actor, id: string, reason: string) {
  const order = await loadOrder(id);
  await transition(actor, order, 'cancelled', reason);
  await runInTransaction(async (session) => {
    await order.save({ session });
    await Charge.updateMany(
      { sourceKind: 'lab_order', sourceId: order._id, status: 'pending' },
      { $set: { status: 'void' } },
      withSession(session),
    );
  });
  return saveAndAnnounce(actor, order, 'cancelled', { reason });
}
