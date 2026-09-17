import type { ClientSession } from 'mongoose';
import { AuditLog } from '../models/index.js';
import { withSession } from '../db/transaction.js';
import { logger } from '../utils/logger.js';
import type { Actor } from './actor.js';

export interface AuditEntry {
  action: string;
  resource: string;
  resourceId?: string | { toString(): string } | null;
  patient?: string | { toString(): string } | null;
  outcome?: 'success' | 'failure';
  /** Identifiers and changed field names only. Never put clinical content or credentials here. */
  metadata?: Record<string, unknown>;
}

export async function recordAudit(actor: Partial<Actor> | null, entry: AuditEntry, session: ClientSession | null = null) {
  try {
    await AuditLog.create(
      [
        {
          user: actor?.userId,
          userName: actor?.name,
          role: actor?.role,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId ? String(entry.resourceId) : undefined,
          patient: entry.patient ? String(entry.patient) : undefined,
          outcome: entry.outcome ?? 'success',
          ip: actor?.ip,
          userAgent: actor?.userAgent,
          metadata: entry.metadata,
        },
      ],
      withSession(session),
    );
  } catch (err) {
    // Inside a transaction the failure must abort the whole operation.
    if (session) throw err;
    logger.error({ err: (err as Error).message, action: entry.action }, 'Failed to write audit log');
  }
}

/** Names of fields that differ between two plain objects, for audit metadata. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}
