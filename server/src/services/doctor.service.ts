import {
  WEEKDAYS,
  minutesToTime,
  timeToMinutes,
  toHospitalDate,
  toHospitalTime,
  weekdayOf,
  type DoctorProfileInput,
} from '@hms/shared';
import { z } from 'zod';
import { doctorProfileUpdateSchema } from '@hms/shared';
import { Appointment, Doctor, Service, User } from '../models/index.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';
import { clearDoctorCache } from './auth.service.js';
import type { Actor } from './actor.js';

type DoctorUpdateInput = z.infer<typeof doctorProfileUpdateSchema>;

const POPULATE = [
  { path: 'user', select: 'name email phone isActive designation' },
  { path: 'consultationService', select: 'code name price' },
  { path: 'followUpService', select: 'code name price' },
];

export async function listDoctors(includeInactive = false) {
  const filter = includeInactive ? {} : { isActive: true };
  const doctors = await Doctor.find(filter).populate(POPULATE);
  return doctors
    .filter((d) => includeInactive || (d.user as unknown as { isActive?: boolean })?.isActive)
    .sort((a, b) =>
      String((a.user as unknown as { name: string })?.name).localeCompare(
        String((b.user as unknown as { name: string })?.name),
      ),
    );
}

export async function getDoctor(id: string) {
  const doctor = await Doctor.findById(id).populate(POPULATE);
  if (!doctor) throw notFound('Doctor');
  return doctor;
}

async function assertServices(input: Partial<DoctorProfileInput>) {
  for (const key of ['consultationService', 'followUpService'] as const) {
    const id = input[key];
    if (id && !(await Service.exists({ _id: id, category: 'consultation' }))) {
      throw badRequest('Consultation fee must reference a service in the consultation category');
    }
  }
}

export async function createDoctorProfile(actor: Actor, input: DoctorProfileInput) {
  const user = await User.findById(input.user);
  if (!user) throw notFound('User');
  if (user.role !== 'doctor') throw badRequest('Doctor profiles can only be attached to users with the doctor role');
  if (await Doctor.exists({ user: input.user })) throw conflict('This user already has a doctor profile');
  await assertServices(input);
  const doctor = await Doctor.create(input);
  clearDoctorCache(user.id);
  await recordAudit(actor, { action: 'doctor.create', resource: 'doctor', resourceId: doctor.id });
  return getDoctor(doctor.id);
}

export async function updateDoctorProfile(actor: Actor, id: string, input: DoctorUpdateInput) {
  const doctor = await Doctor.findById(id);
  if (!doctor) throw notFound('Doctor');
  await assertServices(input);
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) doctor.set(key, value);
  }
  await doctor.save();
  await recordAudit(actor, {
    action: 'doctor.update',
    resource: 'doctor',
    resourceId: id,
    metadata: { fields: Object.keys(input) },
  });
  return getDoctor(id);
}

export interface Slot {
  time: string;
  endTime: string;
  available: boolean;
  past: boolean;
}

/** Slots generated from the doctor's weekly availability minus appointments holding a slot. */
export async function getSlots(doctorId: string, date: string): Promise<{ slots: Slot[]; slotMinutes: number }> {
  const doctor = await Doctor.findById(doctorId);
  if (!doctor || !doctor.isActive) throw notFound('Doctor');
  const day = WEEKDAYS[weekdayOf(date)];
  const windows = doctor.availability.filter((w) => w.day === day);
  const slotMinutes = doctor.slotMinutes ?? 15;

  const booked = await Appointment.find({ doctor: doctorId, date, holdsSlot: true }).select('startMinutes endMinutes');
  const isToday = date === toHospitalDate();
  const nowMinutes = timeToMinutes(toHospitalTime());

  const slots: Slot[] = [];
  for (const w of windows) {
    for (let m = timeToMinutes(w.start); m + slotMinutes <= timeToMinutes(w.end); m += slotMinutes) {
      const end = m + slotMinutes;
      const overlaps = booked.some((b) => b.startMinutes < end && b.endMinutes > m);
      slots.push({
        time: minutesToTime(m),
        endTime: minutesToTime(end),
        available: !overlaps,
        past: isToday && m < nowMinutes,
      });
    }
  }
  slots.sort((a, b) => a.time.localeCompare(b.time));
  return { slots, slotMinutes };
}
