import mongoose, { type ClientSession } from 'mongoose';
import { transactionsSupported } from './connection.js';

/**
 * Runs the callback inside a MongoDB transaction when the deployment supports it.
 * On a standalone server the callback runs without a session; the services
 * still use conditional atomic updates so that stock and counters stay consistent.
 */
export async function runInTransaction<T>(fn: (session: ClientSession | null) => Promise<T>): Promise<T> {
  if (!transactionsSupported()) return fn(null);
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/** Query options for an optional session (mongoose types do not accept `session: null`). */
export function withSession(session: ClientSession | null | undefined): { session?: ClientSession } {
  return session ? { session } : {};
}
