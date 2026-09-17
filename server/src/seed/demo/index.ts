import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { WEEKDAYS, addDays, toHospitalDate } from '@hms/shared';
import { env } from '../../config/env.js';
import { Bed, Doctor, LabTest, Medicine, Patient, Service, User } from '../../models/index.js';
import type { Actor } from '../../services/actor.js';
import { createAppointment } from '../../services/appointment.service.js';
import { hashPassword } from '../../services/auth.service.js';
import { createPatient } from '../../services/patient.service.js';
import { stockIn } from '../../services/pharmacy.service.js';
import { registerWalkIn } from '../../services/queue.service.js';
import { logger } from '../../utils/logger.js';
import { ensureHospitalStructure } from '../base.js';
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_LAB_TESTS,
  DEMO_MEDICINES,
  DEMO_PATIENTS,
  DEMO_SERVICES,
  DEMO_USERS,
} from './data.js';

const DEMO_GENERAL_WARD_BEDS = 6;

function assertDemoDatabase() {
  const dbName = mongoose.connection.name;
  if (env.isProduction) throw new Error('Demo data cannot be loaded in production');
  if (!env.useMemoryDb && !/demo|test/i.test(dbName)) {
    throw new Error(
      `Refusing to load demo data into database "${dbName}". Use a database whose name contains "demo".`,
    );
  }
}

export async function seedDemoData() {
  assertDemoDatabase();
  if (await User.exists({ email: `admin@${DEMO_EMAIL_DOMAIN}` })) {
    logger.info('Demo data already present');
    return;
  }

  const password = process.env.DEMO_PASSWORD || `Demo-${randomBytes(6).toString('hex')}A1`;
  const passwordHash = await hashPassword(password);
  const users = new Map<string, InstanceType<typeof User>>();
  for (const u of DEMO_USERS) {
    const user = await User.create({
      name: u.name,
      email: `${u.key}@${DEMO_EMAIL_DOMAIN}`,
      role: u.role,
      designation: u.designation,
      passwordHash,
    });
    users.set(u.key, user);
  }
  const admin = users.get('admin')!;
  const actor: Actor = { userId: admin.id, name: admin.name, role: 'admin', permissions: [] };

  const services = new Map<string, InstanceType<typeof Service>>();
  for (const s of DEMO_SERVICES) {
    services.set(
      s.code,
      await Service.create({ ...s, description: 'Demo price. Replace before real use.' }),
    );
  }

  const fullWeek = WEEKDAYS.filter((d) => d !== 'sun').flatMap((day) => [
    { day, start: '09:00', end: '13:00' },
    { day, start: '17:00', end: '21:00' },
  ]);
  const doctorProfiles = [];
  for (const key of ['doctor1', 'doctor2']) {
    doctorProfiles.push(
      await Doctor.create({
        user: users.get(key)!._id,
        specialization: 'General Physician',
        department: 'General Medicine',
        qualification: 'MBBS',
        consultationService: services.get('CONS-GEN')!._id,
        followUpService: services.get('CONS-FU')!._id,
        slotMinutes: 15,
        availability: fullWeek,
      }),
    );
  }

  await ensureHospitalStructure(DEMO_GENERAL_WARD_BEDS);
  await Bed.updateMany({ type: 'private' }, { $set: { dailyService: services.get('ROOM-PVT')!._id } });
  await Bed.updateMany({ type: 'general' }, { $set: { dailyService: services.get('ROOM-GEN')!._id } });

  for (const m of DEMO_MEDICINES) {
    const { batches, ...fields } = m;
    const medicine = await Medicine.create(fields);
    for (const [i, b] of batches.entries()) {
      if (!b.qty) continue;
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + b.months);
      await stockIn(actor, {
        medicine: medicine.id,
        batchNumber: `DEMO-${m.genericName.slice(0, 3).toUpperCase()}-${i + 1}`,
        expiryDate: toHospitalDate(expiry),
        quantity: b.qty,
        purchasePrice: b.cost,
        sellingPrice: b.mrp,
        supplier: 'Demo supplier',
      });
    }
  }

  for (const t of DEMO_LAB_TESTS) {
    await LabTest.create({ ...t, parameters: t.parameters.map((p) => ({ ...p })) });
  }

  const patients = [];
  for (const p of DEMO_PATIENTS) {
    patients.push(
      await createPatient(actor, {
        ...p,
        address: { city: 'Aurangabad', state: 'Maharashtra' },
        maritalStatus: 'unknown',
      }),
    );
  }

  // A few appointments tomorrow and two walk-ins today, so every screen has something to show.
  const tomorrow = addDays(toHospitalDate(), 1);
  const [d1, d2] = doctorProfiles;
  const bookings = [
    { patient: patients[0].id, doctor: d1.id, startTime: '09:30' },
    { patient: patients[1].id, doctor: d1.id, startTime: '09:45' },
    { patient: patients[2].id, doctor: d2.id, startTime: '10:00' },
  ];
  for (const b of bookings) {
    try {
      await createAppointment(actor, { ...b, date: tomorrow, type: 'new', source: 'reception' });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Skipped a demo appointment');
    }
  }
  await registerWalkIn(actor, { patient: patients[3].id, doctor: d1.id, priority: 'routine' });
  await registerWalkIn(actor, { patient: patients[4].id, doctor: d1.id, priority: 'urgent' });

  const accountList = DEMO_USERS.map((u) => `  ${u.role.padEnd(14)} ${u.key}@${DEMO_EMAIL_DOMAIN}`).join('\n');
  logger.warn(
    `Demo data loaded. All demo accounts use the password: ${password}\n${accountList}\n` +
      (process.env.DEMO_PASSWORD ? '' : 'Set DEMO_PASSWORD in server/.env to keep the same password between runs.'),
  );
  return { patients: await Patient.countDocuments(), password };
}
