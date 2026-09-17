import mongoose from 'mongoose';
import { passwordSchema } from '@hms/shared';
import { env } from '../config/env.js';
import { Bed, Room, User, Ward } from '../models/index.js';
import { hashPassword } from '../services/auth.service.js';
import { getSettings } from '../services/settings.service.js';
import { logger } from '../utils/logger.js';

/**
 * Idempotent start-up tasks that are safe in every environment: settings
 * document, storage indexes and (optionally) the first administrator.
 */
export async function ensureBaseData() {
  await getSettings();
  await mongoose.connection.db!.collection('patient_documents.files').createIndex({ 'metadata.patient': 1 });

  if ((await User.estimatedDocumentCount()) > 0) return;
  const { BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_PASSWORD: password, BOOTSTRAP_ADMIN_NAME: name } = env;
  if (!email || !password) {
    if (!env.useMemoryDb) {
      logger.warn('No users exist yet. Run "npm run create-admin" to create the first administrator.');
    }
    return;
  }
  const check = passwordSchema.safeParse(password);
  if (!check.success) {
    logger.error(`BOOTSTRAP_ADMIN_PASSWORD is too weak: ${check.error.issues[0]?.message}`);
    return;
  }
  await User.create({
    name: name || 'Administrator',
    email: email.toLowerCase(),
    role: 'admin',
    passwordHash: await hashPassword(password),
  });
  logger.info({ email }, 'Created the first administrator from BOOTSTRAP_ADMIN_* variables');
}

/**
 * Creates National Clinic's known inpatient structure: three private rooms
 * (one bed each) and two general wards. General ward bed counts must be
 * supplied because they have not been confirmed.
 */
export async function ensureHospitalStructure(generalWardBeds: number | null) {
  const privateWard = await Ward.findOneAndUpdate(
    { code: 'PVT' },
    { $setOnInsert: { name: 'Private Rooms', code: 'PVT', type: 'private', isActive: true } },
    { upsert: true, returnDocument: 'after' },
  );
  for (let i = 1; i <= 3; i += 1) {
    const room = await Room.findOneAndUpdate(
      { ward: privateWard._id, number: `P${i}` },
      { $setOnInsert: { ward: privateWard._id, number: `P${i}`, isActive: true } },
      { upsert: true, returnDocument: 'after' },
    );
    await Bed.updateOne(
      { code: `P${i}-1` },
      {
        $setOnInsert: {
          code: `P${i}-1`,
          ward: privateWard._id,
          room: room._id,
          type: 'private',
          status: 'available',
          statusChangedAt: new Date(),
          isActive: true,
        },
      },
      { upsert: true },
    );
  }

  const created: string[] = [];
  for (const [index, code] of ['GW1', 'GW2'].entries()) {
    const ward = await Ward.findOneAndUpdate(
      { code },
      { $setOnInsert: { name: `General Ward ${index + 1}`, code, type: 'general', isActive: true } },
      { upsert: true, returnDocument: 'after' },
    );
    if (!generalWardBeds) continue;
    for (let b = 1; b <= generalWardBeds; b += 1) {
      const bedCode = `${code}-${String(b).padStart(2, '0')}`;
      const result = await Bed.updateOne(
        { code: bedCode },
        {
          $setOnInsert: {
            code: bedCode,
            ward: ward._id,
            type: 'general',
            status: 'available',
            statusChangedAt: new Date(),
            isActive: true,
          },
        },
        { upsert: true },
      );
      if (result.upsertedCount) created.push(bedCode);
    }
  }
  return { generalWardBedsCreated: created.length };
}
