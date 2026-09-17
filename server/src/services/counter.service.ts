import type { ClientSession } from 'mongoose';
import { toHospitalDate } from '@hms/shared';
import { Counter } from '../models/index.js';
import { withSession } from '../db/transaction.js';

export async function nextSequence(key: string, session: ClientSession | null = null): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', ...withSession(session) },
  ).lean();
  return counter!.seq;
}

/** Human readable document numbers, for example RX-260917-0004. */
export async function nextDocumentNumber(prefix: string, session: ClientSession | null = null, pad = 4) {
  const date = toHospitalDate().replace(/-/g, '').slice(2);
  const seq = await nextSequence(`${prefix}:${date}`, session);
  return `${prefix}-${date}-${String(seq).padStart(pad, '0')}`;
}

/** Patient UHID with a yearly sequence, for example NC-2026-00042. */
export async function nextUhid(session: ClientSession | null = null) {
  const year = toHospitalDate().slice(0, 4);
  const seq = await nextSequence(`uhid:${year}`, session);
  return `NC-${year}-${String(seq).padStart(5, '0')}`;
}
