import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { isoDate, objectId, paginationQuery } from '@hms/shared';
import { getActor, requirePermission } from '../middleware/auth.js';
import { query, validate } from '../middleware/validate.js';
import { getAnalytics } from '../services/analytics.service.js';
import { auditActions, exportAuditLogs, listAuditLogs, type AuditQuery } from '../services/audit-query.service.js';
import { recordAudit } from '../services/audit.service.js';
import { listReports, runReport } from '../services/report.service.js';
import { toCsv } from '../utils/csv.js';
import { ok, pageMeta } from '../utils/http.js';

function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}

export const reportRouter = Router();
reportRouter.get('/', requirePermission('report:read'), (req, res) => ok(res, listReports(getActor(req))));
reportRouter.get(
  '/:key',
  requirePermission('report:read'),
  validate({
    params: z.object({ key: z.string().regex(/^[a-z-]{2,40}$/) }),
    query: z.object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      format: z.enum(['json', 'csv']).default('json'),
    }),
  }),
  async (req: Request, res: Response) => {
    const { key } = req.valid!.params as { key: string };
    const q = query<{ from?: string; to?: string; format: 'json' | 'csv' }>(req);
    const actor = getActor(req);
    const report = await runReport(actor, key, q);
    if (q.format === 'csv') {
      await recordAudit(actor, {
        action: 'report.export',
        resource: 'report',
        resourceId: key,
        metadata: { from: q.from, to: q.to, rows: report.rows.length },
      });
      const suffix = report.range ? `${report.range.from}_to_${report.range.to}` : new Date().toISOString().slice(0, 10);
      return sendCsv(res, `${key}_${suffix}.csv`, toCsv(report.columns, report.rows));
    }
    return ok(res, report);
  },
);

export const analyticsRouter = Router();
analyticsRouter.get(
  '/',
  requirePermission('analytics:read'),
  validate({ query: z.object({ from: isoDate, to: isoDate }) }),
  async (req, res) => {
    const q = query<{ from: string; to: string }>(req);
    return ok(res, await getAnalytics(q.from, q.to));
  },
);

const auditFilter = z.object({
  user: objectId.optional(),
  action: z.string().trim().max(80).optional(),
  resource: z.string().trim().max(40).optional(),
  resourceId: z.string().trim().max(60).optional(),
  patient: objectId.optional(),
  outcome: z.enum(['success', 'failure']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/** Read-only by design: there are no routes that modify or delete audit entries. */
export const auditRouter = Router();
auditRouter.get(
  '/',
  requirePermission('audit:read'),
  validate({ query: paginationQuery.extend(auditFilter.shape).extend({ limit: z.coerce.number().int().min(1).max(200).default(50) }) }),
  async (req, res) => {
    const q = query<AuditQuery>(req);
    const { items, total } = await listAuditLogs(q);
    return ok(res, items, pageMeta(q.page, q.limit, total));
  },
);
auditRouter.get('/actions', requirePermission('audit:read'), async (_req, res) => ok(res, await auditActions()));
auditRouter.get(
  '/export',
  requirePermission('audit:read'),
  validate({ query: auditFilter }),
  async (req, res) => {
    const actor = getActor(req);
    const q = query<Omit<AuditQuery, 'page' | 'limit'>>(req);
    const rows = await exportAuditLogs(q);
    await recordAudit(actor, { action: 'audit.export', resource: 'audit_log', metadata: { ...q, rows: rows.length } });
    const columns = ['at', 'user', 'role', 'action', 'resource', 'resourceId', 'patient', 'outcome', 'ip', 'metadata'].map(
      (key) => ({ key, label: key }),
    );
    return sendCsv(res, `audit_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(columns, rows));
  },
);
