import { escapeRegex } from '@hms/shared';
import { AuditLog } from '../models/index.js';
import { skipFor } from '../utils/http.js';

export interface AuditQuery {
  user?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  patient?: string;
  outcome?: 'success' | 'failure';
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

function buildFilter(q: AuditQuery) {
  const filter: Record<string, unknown> = {};
  if (q.user) filter.user = q.user;
  if (q.action) filter.action = { $regex: `^${escapeRegex(q.action)}` };
  if (q.resource) filter.resource = q.resource;
  if (q.resourceId) filter.resourceId = q.resourceId;
  if (q.patient) filter.patient = q.patient;
  if (q.outcome) filter.outcome = q.outcome;
  if (q.from || q.to) {
    filter.at = {
      ...(q.from && { $gte: new Date(`${q.from}T00:00:00+05:30`) }),
      ...(q.to && { $lte: new Date(`${q.to}T23:59:59.999+05:30`) }),
    };
  }
  return filter;
}

export async function listAuditLogs(q: AuditQuery) {
  const filter = buildFilter(q);
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .populate({ path: 'patient', select: 'uhid fullName' })
      .sort({ at: -1 })
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit),
    AuditLog.countDocuments(filter),
  ]);
  return { items, total };
}

export async function exportAuditLogs(q: Omit<AuditQuery, 'page' | 'limit'>) {
  const rows = await AuditLog.find(buildFilter({ ...q, page: 1, limit: 1 }))
    .populate({ path: 'patient', select: 'uhid' })
    .sort({ at: -1 })
    .limit(50_000)
    .lean();
  return rows.map((r) => ({
    at: r.at?.toISOString(),
    user: r.userName,
    role: r.role,
    action: r.action,
    resource: r.resource,
    resourceId: r.resourceId,
    patient: (r.patient as { uhid?: string } | undefined)?.uhid ?? '',
    outcome: r.outcome,
    ip: r.ip,
    metadata: r.metadata ? JSON.stringify(r.metadata) : '',
  }));
}

export function auditActions() {
  return AuditLog.distinct('action');
}
