/**
 * End-to-end hospital workflow against a real MongoDB replica set:
 * registration, appointment, reception token, consultation, prescription,
 * pharmacy, billing, laboratory, beds, operation theatre, referrals and audit.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addDays, toHospitalDate, WEEKDAYS } from '@hms/shared';
import { AuditLog, Doctor, User } from '../src/models/index.js';
import { client, createUser, login, PASSWORD, startTestServer, stopTestServer } from './helpers.js';

type App = Awaited<ReturnType<typeof startTestServer>>;
type Client = ReturnType<typeof client>;

let app: App;
const as: Record<string, Client> = {};
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

// 10:00 in Aurangabad, so that same-day slots are always in the future.
const NOW = new Date(`${toHospitalDate()}T10:00:00+05:30`);
const today = toHospitalDate(NOW);
const tomorrow = addDays(today, 1);

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW, shouldAdvanceTime: true });
  app = await startTestServer();

  const users = {
    admin: await createUser('admin', 'admin'),
    doctor: await createUser('doctor', 'doctor'),
    doctor2: await createUser('doctor', 'doctor2'),
    reception: await createUser('receptionist', 'reception'),
    nurse: await createUser('nurse', 'nurse'),
    pharmacist: await createUser('pharmacist', 'pharmacist'),
    lab: await createUser('lab_staff', 'lab'),
    billing: await createUser('billing_staff', 'billing'),
    management: await createUser('management', 'management'),
  };
  for (const [key, user] of Object.entries(users)) {
    tokens[key] = await login(app, user.email);
    as[key] = client(app, tokens[key]);
    ids[`user_${key}`] = user.id;
  }
});

afterAll(async () => {
  vi.useRealTimers();
  await stopTestServer();
});

describe('health and authentication', () => {
  it('reports a healthy database connection', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.database).toBe('connected');
  });

  it('rejects bad credentials without revealing which part was wrong', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'x' });
    expect(unknown.body.error.message).toBe('Invalid email or password');
  });

  it('never returns the password hash', async () => {
    const res = await as.admin.get('/api/users');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('requires a token and enforces permissions on the API', async () => {
    expect((await request(app).get('/api/patients')).status).toBe(401);
    expect((await as.reception.get('/api/audit')).status).toBe(403);
    expect((await as.pharmacist.post('/api/patients', {})).status).toBe(403);
    expect((await as.management.post('/api/users', {})).status).toBe(403);
  });

  it('rotates refresh tokens and supports logout', async () => {
    const agent = request.agent(app);
    const loginRes = await agent.post('/api/auth/login').send({ email: 'nurse@test.local', password: PASSWORD });
    expect(loginRes.headers['set-cookie']?.[0]).toMatch(/hms_rt=.*HttpOnly/i);
    expect((await agent.post('/api/auth/refresh')).status).toBe(403); // missing app header
    const refreshed = await agent.post('/api/auth/refresh').set('X-Requested-With', 'hms');
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.user.role).toBe('nurse');
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${refreshed.body.data.accessToken}`);
    expect(me.body.data.permissions).toContain('vitals:write');
    expect((await agent.post('/api/auth/logout').set('X-Requested-With', 'hms')).status).toBe(200);
    expect((await agent.post('/api/auth/refresh').set('X-Requested-With', 'hms')).status).toBe(401);
  });
});

describe('configuration', () => {
  it('creates priced services, a doctor profile, medicine stock and lab tests', async () => {
    const fee = await as.admin.post('/api/services', { code: 'cons-gen', name: 'Consultation', category: 'consultation', price: 300 });
    expect(fee.status).toBe(201);
    expect(fee.body.data.code).toBe('CONS-GEN');
    ids.feeService = fee.body.data.id;
    const room = await as.admin.post('/api/services', { code: 'ROOM-PVT', name: 'Private room', category: 'room', price: 2000 });
    ids.roomService = room.body.data.id;

    const allDay = WEEKDAYS.map((day) => ({ day, start: '00:00', end: '23:45' }));
    for (const key of ['doctor', 'doctor2']) {
      const res = await as.admin.post('/api/doctors', {
        user: ids[`user_${key}`],
        specialization: 'General Physician',
        consultationService: ids.feeService,
        slotMinutes: 15,
        availability: allDay,
      });
      expect(res.status).toBe(201);
      ids[`${key}Profile`] = res.body.data.id;
    }
    // A doctor profile cannot be attached to a non-doctor.
    const wrong = await as.admin.post('/api/doctors', { user: ids.user_nurse, specialization: 'X' });
    expect(wrong.status).toBe(400);

    const med = await as.pharmacist.post('/api/pharmacy/medicines', {
      name: 'Paracetamol',
      genericName: 'Paracetamol',
      strength: '500 mg',
      form: 'tablet',
      unit: 'tablet',
      reorderLevel: 5,
    });
    expect(med.status).toBe(201);
    ids.medicine = med.body.data.id;

    const test = await as.lab.post('/api/laboratory/tests', {
      code: 'fbs',
      name: 'Blood sugar (fasting)',
      sampleType: 'plasma',
      price: 80,
      parameters: [{ name: 'Glucose', unit: 'mg/dL', referenceRange: '70-100', refLow: 70, refHigh: 100 }],
    });
    expect(test.status).toBe(201);
    ids.labTest = test.body.data.id;
  });
});

describe('patient registration', () => {
  const patient = {
    fullName: 'Asha Kulkarni',
    dateOfBirth: '1980-05-14',
    gender: 'female',
    phone: '9876543210',
    address: { city: 'Aurangabad', state: 'Maharashtra', pincode: '431001' },
    emergencyContact: { name: 'R Kulkarni', relation: 'Spouse', phone: '9876500000' },
  };

  it('registers a patient with a UHID', async () => {
    const res = await as.reception.post('/api/patients', patient);
    expect(res.status).toBe(201);
    expect(res.body.data.uhid).toMatch(/^NC-\d{4}-\d{5}$/);
    expect(res.body.data.age).toBeGreaterThan(40);
    ids.patient = res.body.data.id;
    ids.uhid = res.body.data.uhid;
  });

  it('validates input and blocks exact duplicates', async () => {
    const invalid = await as.reception.post('/api/patients', { ...patient, phone: '123' });
    expect(invalid.status).toBe(400);
    const noAge = await as.reception.post('/api/patients', { ...patient, dateOfBirth: undefined });
    expect(noAge.status).toBe(400);
    const dup = await as.reception.post('/api/patients', patient);
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.uhid).toBe(ids.uhid);
  });

  it('accepts age when the date of birth is unknown', async () => {
    const res = await as.reception.post('/api/patients', { fullName: 'Rahul Shinde', ageYears: 34, gender: 'male', phone: '9123456780' });
    expect(res.status).toBe(201);
    expect(res.body.data.dobEstimated).toBe(true);
    ids.patient2 = res.body.data.id;
  });

  it('finds patients by name, phone and UHID', async () => {
    for (const q of ['kulk', 'asha kul', '98765', ids.uhid]) {
      const res = await as.reception.get(`/api/patients?q=${encodeURIComponent(q)}`);
      expect(res.body.data.map((p: { id: string }) => p.id)).toContain(ids.patient);
    }
    const none = await as.reception.get('/api/patients?q=zzzz');
    expect(none.body.data).toHaveLength(0);
  });

  it('updates demographics and records changed fields in the audit log', async () => {
    const res = await as.reception.patch(`/api/patients/${ids.patient}`, { alternatePhone: '9000011111', address: { line: 'Station Road' } });
    expect(res.status).toBe(200);
    expect(res.body.data.address.city).toBe('Aurangabad');
    expect(res.body.data.address.line).toBe('Station Road');
    const audit = await AuditLog.findOne({ action: 'patient.update', resourceId: ids.patient });
    expect(audit?.metadata.fields).toEqual(expect.arrayContaining(['alternatePhone', 'address']));
  });

  it('hides clinical data from reception', async () => {
    const res = await as.reception.get(`/api/patients/${ids.patient}`);
    expect(res.body.data.clinicalAccess).toBe(false);
    expect(res.body.data.alerts).toBeNull();
    expect((await as.reception.get(`/api/patients/${ids.patient}/timeline`)).status).toBe(403);
  });
});

describe('appointments', () => {
  it('books an appointment and prevents double booking', async () => {
    const res = await as.reception.post('/api/appointments', {
      patient: ids.patient,
      doctor: ids.doctorProfile,
      date: today,
      startTime: '11:00',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.endTime).toBe('11:15');
    ids.appointment = res.body.data.id;

    const clash = await as.reception.post('/api/appointments', {
      patient: ids.patient2,
      doctor: ids.doctorProfile,
      date: today,
      startTime: '11:00',
    });
    expect(clash.status).toBe(409);

    const past = await as.reception.post('/api/appointments', {
      patient: ids.patient2,
      doctor: ids.doctorProfile,
      date: today,
      startTime: '08:00',
    });
    expect(past.status).toBe(400);
  });

  it('shows booked slots as unavailable', async () => {
    const res = await as.reception.get(`/api/appointments/slots?doctor=${ids.doctorProfile}&date=${today}`);
    const slot = res.body.data.slots.find((s: { time: string }) => s.time === '11:00');
    expect(slot.available).toBe(false);
  });

  it('requires a reason to cancel, and frees the slot', async () => {
    const booked = await as.reception.post('/api/appointments', {
      patient: ids.patient2,
      doctor: ids.doctorProfile,
      date: tomorrow,
      startTime: '09:00',
    });
    expect(booked.status).toBe(201);
    const noReason = await as.reception.post(`/api/appointments/${booked.body.data.id}/status`, { status: 'cancelled' });
    expect(noReason.status).toBe(400);
    const cancelled = await as.reception.post(`/api/appointments/${booked.body.data.id}/status`, {
      status: 'cancelled',
      reason: 'Patient called to cancel',
    });
    expect(cancelled.body.data.status).toBe('cancelled');
    const rebook = await as.reception.post('/api/appointments', {
      patient: ids.patient2,
      doctor: ids.doctorProfile,
      date: tomorrow,
      startTime: '09:00',
    });
    expect(rebook.status).toBe(201);
    const invalid = await as.reception.post(`/api/appointments/${booked.body.data.id}/status`, { status: 'confirmed' });
    expect(invalid.status).toBe(409);
  });
});

describe('reception queue', () => {
  it('checks in the appointment and issues token 1', async () => {
    const res = await as.reception.post('/api/queue/check-in', { appointment: ids.appointment });
    expect(res.status).toBe(201);
    expect(res.body.data.number).toBe(1);
    ids.token = res.body.data.id;
    const appt = await as.reception.get(`/api/appointments/${ids.appointment}`);
    expect(appt.body.data.status).toBe('checked_in');
    expect((await as.reception.post('/api/queue/check-in', { appointment: ids.appointment })).status).toBe(409);
  });

  it('registers a walk-in with the next token and rejects a second active token', async () => {
    const res = await as.reception.post('/api/queue/walk-in', { patient: ids.patient2, doctor: ids.doctorProfile });
    expect(res.status).toBe(201);
    expect(res.body.data.number).toBe(2);
    ids.walkInToken = res.body.data.id;
    const again = await as.reception.post('/api/queue/walk-in', { patient: ids.patient2, doctor: ids.doctorProfile });
    expect(again.status).toBe(409);
  });

  it('keeps a separate counter per doctor', async () => {
    const res = await as.reception.post('/api/queue/walk-in', { patient: ids.patient, doctor: ids.doctor2Profile });
    expect(res.body.data.number).toBe(1);
    await as.reception.post(`/api/queue/${res.body.data.id}/action`, { action: 'cancel', reason: 'Wrong doctor selected' });
  });

  it('records vitals at triage', async () => {
    const res = await as.nurse.put(`/api/queue/${ids.token}/vitals`, { systolic: 130, diastolic: 85, pulse: 78, weightKg: 60, heightCm: 160 });
    expect(res.status).toBe(200);
    expect(res.body.data.vitals.bmi).toBe(23.44);
    expect((await as.reception.put(`/api/queue/${ids.token}/vitals`, { pulse: 70 })).status).toBe(403);
  });

  it('summarises the queue', async () => {
    const res = await as.reception.get(`/api/queue?doctor=${ids.doctorProfile}`);
    expect(res.body.data.summary).toMatchObject({ waiting: 2, withDoctor: 0, completed: 0, lastIssued: 2 });
  });
});

describe('consultation and prescription', () => {
  it('lets the assigned doctor start the consultation and calls the patient in', async () => {
    const other = await as.doctor2.post('/api/consultations', { token: ids.token });
    expect(other.status).toBe(403);
    const res = await as.doctor.post('/api/consultations', { token: ids.token });
    expect(res.status).toBe(201);
    expect(res.body.data.vitals.systolic).toBe(130);
    ids.consultation = res.body.data.id;
    const queue = await as.reception.get(`/api/queue?doctor=${ids.doctorProfile}`);
    expect(queue.body.data.summary.nowServing).toEqual([1]);
    const appt = await as.reception.get(`/api/appointments/${ids.appointment}`);
    expect(appt.body.data.status).toBe('in_consultation');
  });

  it('shows the clinical summary to the treating doctor', async () => {
    await as.doctor.post(`/api/patients/${ids.patient}/history`, { type: 'allergy', title: 'Penicillin', severity: 'severe' });
    const res = await as.doctor.get(`/api/patients/${ids.patient}/clinical-summary`);
    expect(res.status).toBe(200);
    expect(res.body.data.allergies[0].title).toBe('Penicillin');
  });

  it('restricts doctors to their own patients unless emergency access is recorded', async () => {
    const denied = await as.doctor2.get(`/api/patients/${ids.patient2}/timeline`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('PATIENT_ACCESS_REQUIRED');
    const grant = await as.doctor2.post(`/api/patients/${ids.patient2}/emergency-access`, { reason: 'Covering for colleague' });
    expect(grant.status).toBe(201);
    expect((await as.doctor2.get(`/api/patients/${ids.patient2}/timeline`)).status).toBe(200);
  });

  it('saves a draft and requires a chief complaint to complete', async () => {
    const draft = await as.doctor.patch(`/api/consultations/${ids.consultation}`, {
      symptoms: ['Fever', 'Body ache'],
      diagnoses: [{ description: 'Viral fever', type: 'provisional' }],
    });
    expect(draft.status).toBe(200);
    const incomplete = await as.doctor.post(`/api/consultations/${ids.consultation}/complete`, {});
    expect(incomplete.status).toBe(400);
  });

  it('issues a prescription with a derived quantity', async () => {
    const res = await as.doctor.post('/api/prescriptions', {
      consultation: ids.consultation,
      items: [
        { medicine: ids.medicine, medicineName: 'Paracetamol', frequency: '1-0-1', durationValue: 5, durationUnit: 'days' },
        { medicineName: 'Steam inhalation', form: 'other', frequency: 'SOS', durationValue: 3 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.number).toMatch(/^RX-/);
    expect(res.body.data.items[0].quantity).toBe(10);
    expect(res.body.data.items[1].quantity).toBeUndefined();
    ids.prescription = res.body.data.id;
    ids.rxItem = res.body.data.items[0]._id;
    expect((await as.nurse.post('/api/prescriptions', {})).status).toBe(403);
  });

  it('completes and locks the consultation, closes the token and raises the fee', async () => {
    const res = await as.doctor.post(`/api/consultations/${ids.consultation}/complete`, {
      chiefComplaint: 'Fever for 3 days',
      followUpDate: addDays(today, 5),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('completed');
    const token = await as.reception.get(`/api/queue/${ids.token}`);
    expect(token.body.data.status).toBe('completed');
    const appt = await as.reception.get(`/api/appointments/${ids.appointment}`);
    expect(appt.body.data.status).toBe('completed');

    const locked = await as.doctor.patch(`/api/consultations/${ids.consultation}`, { clinicalNotes: 'changed' });
    expect(locked.status).toBe(409);
    const addendum = await as.doctor.post(`/api/consultations/${ids.consultation}/addenda`, { text: 'Advised rest' });
    expect(addendum.body.data.addenda).toHaveLength(1);
  });
});

describe('pharmacy', () => {
  it('receives stock in batches', async () => {
    const near = await as.pharmacist.post('/api/pharmacy/stock-in', {
      medicine: ids.medicine,
      batchNumber: 'b-early',
      expiryDate: addDays(today, 30),
      quantity: 6,
      purchasePrice: 1,
      sellingPrice: 2,
    });
    expect(near.status).toBe(201);
    const later = await as.pharmacist.post('/api/pharmacy/stock-in', {
      medicine: ids.medicine,
      batchNumber: 'B-LATE',
      expiryDate: addDays(today, 400),
      quantity: 20,
      purchasePrice: 1,
      sellingPrice: 2.5,
    });
    ids.lateBatch = later.body.data.id;
    const expired = await as.pharmacist.post('/api/pharmacy/stock-in', {
      medicine: ids.medicine,
      batchNumber: 'OLD',
      expiryDate: addDays(today, -1),
      quantity: 5,
      purchasePrice: 1,
      sellingPrice: 2,
    });
    expect(expired.status).toBe(400);
  });

  it('lists the prescription as pending for the pharmacist', async () => {
    const res = await as.pharmacist.get('/api/prescriptions?pending=true');
    expect(res.body.data.map((p: { id: string }) => p.id)).toContain(ids.prescription);
  });

  it('rejects dispensing more than prescribed', async () => {
    const res = await as.pharmacist.post('/api/pharmacy/dispense', {
      prescription: ids.prescription,
      items: [{ prescriptionItem: ids.rxItem, quantity: 11 }],
    });
    expect(res.status).toBe(400);
  });

  it('dispenses first-expiry-first-out and records every movement', async () => {
    const res = await as.pharmacist.post('/api/pharmacy/dispense', {
      prescription: ids.prescription,
      items: [{ prescriptionItem: ids.rxItem, quantity: 10 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.dispensed[0].batches).toEqual([
      { batchNumber: 'B-EARLY', quantity: 6, unitPrice: 2 },
      { batchNumber: 'B-LATE', quantity: 4, unitPrice: 2.5 },
    ]);
    const rx = await as.pharmacist.get(`/api/prescriptions/${ids.prescription}`);
    expect(rx.body.data.status).toBe('dispensed'); // the advice-only line needs no dispensing

    const med = await as.pharmacist.get(`/api/pharmacy/medicines/${ids.medicine}`);
    expect(med.body.data.stock).toBe(16);
    const tx = await as.pharmacist.get(`/api/pharmacy/transactions?medicine=${ids.medicine}&type=dispense`);
    expect(tx.body.data).toHaveLength(2);
    expect(tx.body.data.every((t: { quantity: number }) => t.quantity < 0)).toBe(true);
  });

  it('never lets stock go negative', async () => {
    const res = await as.pharmacist.post('/api/pharmacy/adjustments', {
      batch: ids.lateBatch,
      type: 'write_off',
      quantityChange: -100,
      reason: 'Damaged',
    });
    expect(res.status).toBe(409);
    const ok = await as.pharmacist.post('/api/pharmacy/adjustments', {
      batch: ids.lateBatch,
      type: 'write_off',
      quantityChange: -1,
      reason: 'Strip damaged',
    });
    expect(ok.body.data.quantity).toBe(15);
  });

  it('reports low stock', async () => {
    await as.pharmacist.post('/api/pharmacy/dispense', {
      patient: ids.patient2,
      items: [{ medicine: ids.medicine, quantity: 12 }],
    });
    const res = await as.pharmacist.get('/api/pharmacy/medicines?filter=low_stock');
    expect(res.body.data.map((m: { id: string }) => m.id)).toContain(ids.medicine);
  });
});

describe('billing', () => {
  it('collects pending charges from consultation and pharmacy', async () => {
    const res = await as.billing.get(`/api/billing/charges?patient=${ids.patient}`);
    expect(res.status).toBe(200);
    const categories = res.body.data.map((c: { category: string }) => c.category).sort();
    expect(categories).toEqual(['consultation', 'pharmacy', 'pharmacy']);
    ids.charges = JSON.stringify(res.body.data.map((c: { id: string }) => c.id));
  });

  it('creates an invoice with server-side totals', async () => {
    const chargeIds: string[] = JSON.parse(ids.charges);
    const res = await as.billing.post('/api/billing/invoices', {
      patient: ids.patient,
      items: [
        ...chargeIds.map((charge) => ({ charge, discount: 0 })),
        { description: 'Dressing', category: 'procedure', quantity: 1, unitPrice: 100, discount: 20, taxRate: 18 },
      ],
    });
    expect(res.status).toBe(201);
    // 300 + 6x2 + 4x2.5 + (100 - 20) * 1.18
    expect(res.body.data.total).toBe(416.4);
    expect(res.body.data.status).toBe('unpaid');
    ids.invoice = res.body.data.id;

    const again = await as.billing.post('/api/billing/invoices', {
      patient: ids.patient,
      items: [{ charge: chargeIds[0] }],
    });
    expect(again.status).toBe(409);
  });

  it('records partial and full payments, and blocks overpayment', async () => {
    const partial = await as.reception.post(`/api/billing/invoices/${ids.invoice}/payments`, { amount: 200, method: 'cash' });
    expect(partial.body.data.status).toBe('partially_paid');
    expect(partial.body.data.balance).toBe(216.4);
    const over = await as.billing.post(`/api/billing/invoices/${ids.invoice}/payments`, { amount: 500, method: 'upi' });
    expect(over.status).toBe(400);
    const rest = await as.billing.post(`/api/billing/invoices/${ids.invoice}/payments`, { amount: 216.4, method: 'upi', reference: 'UPI123' });
    expect(rest.body.data.status).toBe('paid');
    expect(rest.body.data.payments).toHaveLength(2);
  });

  it('restricts refunds and blocks cancelling a paid invoice', async () => {
    const denied = await as.reception.post(`/api/billing/invoices/${ids.invoice}/refunds`, { amount: 20, method: 'cash', note: 'x' });
    expect(denied.status).toBe(403);
    const refund = await as.billing.post(`/api/billing/invoices/${ids.invoice}/refunds`, { amount: 20, method: 'cash', note: 'Dressing not done' });
    expect(refund.body.data.amountRefunded).toBe(20);
    const cancel = await as.billing.post(`/api/billing/invoices/${ids.invoice}/cancel`, { reason: 'test' });
    expect(cancel.status).toBe(409);
  });
});

describe('laboratory', () => {
  it('orders a test and raises the lab charge', async () => {
    const res = await as.doctor.post('/api/laboratory/orders', {
      patient: ids.patient,
      consultation: ids.consultation,
      tests: [ids.labTest],
      priority: 'urgent',
    });
    expect(res.status).toBe(201);
    ids.labOrder = res.body.data.id;
    ids.labItem = res.body.data.items[0]._id;
    const charges = await as.billing.get(`/api/billing/charges?patient=${ids.patient}`);
    expect(charges.body.data.some((c: { category: string }) => c.category === 'lab')).toBe(true);
  });

  it('moves through sample, processing and results with automatic flags', async () => {
    const skip = await as.lab.post(`/api/laboratory/orders/${ids.labOrder}/verify`);
    expect(skip.status).toBe(409);
    expect((await as.nurse.post(`/api/laboratory/orders/${ids.labOrder}/collect`, {})).status).toBe(200);
    expect((await as.lab.post(`/api/laboratory/orders/${ids.labOrder}/process`)).status).toBe(200);
    const results = await as.lab.put(`/api/laboratory/orders/${ids.labOrder}/results`, {
      items: [{ item: ids.labItem, values: [{ parameter: 'Glucose', value: '142' }] }],
    });
    expect(results.status).toBe(200);
    expect(results.body.data.status).toBe('result_entered');
    expect(results.body.data.items[0].results[0]).toMatchObject({ flag: 'high', unit: 'mg/dL' });
  });

  it('hides unverified results from clinicians', async () => {
    const res = await as.doctor.get(`/api/laboratory/orders/${ids.labOrder}`);
    expect(res.body.data.resultsHidden).toBe(true);
    expect(res.body.data.items[0].results).toHaveLength(0);
  });

  it('verifies, releases and keeps revisions on amendment', async () => {
    expect((await as.nurse.post(`/api/laboratory/orders/${ids.labOrder}/verify`)).status).toBe(403);
    await as.lab.post(`/api/laboratory/orders/${ids.labOrder}/verify`);
    const released = await as.lab.post(`/api/laboratory/orders/${ids.labOrder}/release`);
    expect(released.body.data.status).toBe('released');
    const doctorView = await as.doctor.get(`/api/laboratory/orders/${ids.labOrder}`);
    expect(doctorView.body.data.items[0].results[0].value).toBe('142');

    const amended = await as.lab.post(`/api/laboratory/orders/${ids.labOrder}/amend`, {
      reason: 'Transcription error',
      items: [{ item: ids.labItem, values: [{ parameter: 'Glucose', value: '124' }] }],
    });
    expect(amended.body.data.status).toBe('result_entered');
    expect(amended.body.data.revisions).toHaveLength(1);
    expect(amended.body.data.revisions[0].items[0].results[0].value).toBe('142');

    const notifications = await as.doctor.get('/api/notifications');
    expect(notifications.body.data.items.some((n: { type: string }) => n.type === 'lab.report_released')).toBe(true);
  });

  it('shows the lab order on the patient timeline', async () => {
    const res = await as.doctor.get(`/api/patients/${ids.patient}/timeline`);
    const kinds = res.body.data.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['appointment', 'consultation', 'prescription', 'lab', 'history']));
  });
});

describe('patient documents', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const auth = () => ({ Authorization: `Bearer ${tokens.doctor}` });

  it('stores an uploaded report and serves it back', async () => {
    const res = await request(app)
      .post(`/api/patients/${ids.patient}/documents`)
      .set(auth())
      .field('title', 'Outside X-ray report')
      .field('category', 'imaging')
      .attach('file', pdf, { filename: 'xray.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    ids.document = res.body.data.id;

    const list = await as.doctor.get(`/api/patients/${ids.patient}/documents`);
    expect(list.body.data[0]).toMatchObject({ title: 'Outside X-ray report', contentType: 'application/pdf' });

    const file = await request(app).get(`/api/patients/${ids.patient}/documents/${ids.document}`).set(auth());
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
  });

  it('rejects a file that is not really a PDF or image', async () => {
    const res = await request(app)
      .post(`/api/patients/${ids.patient}/documents`)
      .set(auth())
      .field('title', 'Fake')
      .field('category', 'other')
      .attach('file', Buffer.from('not really a pdf'), { filename: 'evil.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
  });

  it('keeps voided documents on record with the reason', async () => {
    const voided = await as.doctor.post(`/api/patients/${ids.patient}/documents/${ids.document}/void`, {
      reason: 'Uploaded to the wrong patient',
    });
    expect(voided.status).toBe(200);
    const list = await as.doctor.get(`/api/patients/${ids.patient}/documents`);
    expect(list.body.data[0]).toMatchObject({ voided: true, voidReason: 'Uploaded to the wrong patient' });
  });
});

describe('rooms and beds', () => {
  it('configures a ward and beds', async () => {
    const ward = await as.admin.post('/api/wards', { name: 'Private Rooms', code: 'pvt', type: 'private' });
    expect(ward.status).toBe(201);
    const room = await as.admin.post(`/api/wards/${ward.body.data.id}/rooms`, { number: 'P1' });
    for (const code of ['p1-1', 'p1-2']) {
      const bed = await as.admin.post('/api/beds', {
        ward: ward.body.data.id,
        room: room.body.data.id,
        code,
        type: 'private',
        dailyService: ids.roomService,
      });
      expect(bed.status).toBe(201);
      ids[code] = bed.body.data.id;
    }
    expect((await as.reception.post('/api/beds', {})).status).toBe(403);
  });

  it('admits, transfers and discharges with room charges', async () => {
    const admit = await as.doctor.post('/api/admissions', {
      patient: ids.patient2,
      bed: ids['p1-1'],
      admittingDoctor: ids.doctorProfile,
      reason: 'Dehydration',
    });
    expect(admit.status).toBe(201);
    ids.admission = admit.body.data.id;

    const busy = await as.doctor.post('/api/admissions', {
      patient: ids.patient,
      bed: ids['p1-1'],
      admittingDoctor: ids.doctorProfile,
      reason: 'Observation',
    });
    expect(busy.status).toBe(409);
    const manual = await as.nurse.post(`/api/beds/${ids['p1-1']}/status`, { status: 'available' });
    expect(manual.status).toBe(409);

    const moved = await as.nurse.post(`/api/admissions/${ids.admission}/transfer`, { bed: ids['p1-2'], reason: 'AC not working' });
    expect(moved.status).toBe(200);
    let board = await as.nurse.get('/api/beds/board');
    const beds = board.body.data.wards[0].beds;
    expect(beds.find((b: { code: string }) => b.code === 'P1-1').status).toBe('cleaning');
    expect(beds.find((b: { code: string }) => b.code === 'P1-2').status).toBe('occupied');

    const discharged = await as.doctor.post(`/api/admissions/${ids.admission}/discharge`, {
      finalDiagnosis: 'Acute gastroenteritis',
      conditionAtDischarge: 'recovered',
    });
    expect(discharged.body.data.status).toBe('discharged');
    board = await as.nurse.get('/api/beds/board');
    expect(board.body.data.summary.cleaning).toBe(2);

    const charges = await as.billing.get(`/api/billing/charges?patient=${ids.patient2}`);
    const room = charges.body.data.filter((c: { category: string }) => c.category === 'room');
    expect(room).toHaveLength(1);
    expect(room[0].quantity).toBe(1);
    expect(room[0].unitPrice).toBe(2000);

    expect((await as.nurse.post(`/api/beds/${ids['p1-1']}/status`, { status: 'available' })).status).toBe(200);
  });
});

describe('operation theatre', () => {
  it('stays disabled until the administrator enables it', async () => {
    const res = await as.doctor.get('/api/ot');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MODULE_DISABLED');
    const enabled = await as.admin.patch('/api/settings', {
      modules: { pharmacy: true, laboratory: true, beds: true, ot: true },
      ot: { theatres: ['OT 1'] },
    });
    expect(enabled.body.data.modules.ot).toBe(true);
  });

  it('schedules procedures without overlaps', async () => {
    const start = new Date(`${tomorrow}T09:00:00+05:30`).toISOString();
    const booking = {
      patient: ids.patient,
      procedureName: 'Incision and drainage',
      surgeon: ids.doctorProfile,
      theatre: 'OT 1',
      scheduledStart: start,
      estimatedMinutes: 60,
    };
    const res = await as.doctor.post('/api/ot', booking);
    expect(res.status).toBe(201);
    const overlap = await as.doctor.post('/api/ot', { ...booking, surgeon: ids.doctor2Profile, scheduledStart: new Date(`${tomorrow}T09:30:00+05:30`).toISOString() });
    expect(overlap.status).toBe(409);
    const noNotes = await as.doctor.post(`/api/ot/${res.body.data.id}/status`, { status: 'pre_op' });
    expect(noNotes.status).toBe(200);
    await as.doctor.post(`/api/ot/${res.body.data.id}/status`, { status: 'in_progress' });
    const early = await as.doctor.post(`/api/ot/${res.body.data.id}/status`, { status: 'completed' });
    expect(early.status).toBe(400);
  });
});

describe('referrals', () => {
  it('tracks referral status transitions', async () => {
    const res = await as.doctor.post('/api/referrals', {
      patient: ids.patient,
      consultation: ids.consultation,
      specialty: 'Cardiology',
      hospital: 'City Heart Centre',
      reason: 'Abnormal ECG',
      referralDate: today,
      priority: 'urgent',
    });
    expect(res.status).toBe(201);
    const id = res.body.data.id;
    const skip = await as.doctor.post(`/api/referrals/${id}/status`, { status: 'completed' });
    expect(skip.status).toBe(409);
    for (const status of ['sent', 'accepted', 'completed']) {
      const step = await as.doctor.post(`/api/referrals/${id}/status`, { status });
      expect(step.body.data.status).toBe(status);
    }
    const mgmt = await as.management.get(`/api/referrals/${id}`);
    expect(mgmt.status).toBe(200);
    expect(mgmt.body.data.clinicalNotes).toBeUndefined();
  });
});

describe('reports, analytics and audit', () => {
  it('produces a revenue report and CSV export', async () => {
    const json = await as.billing.get(`/api/reports/revenue?from=${today}&to=${today}`);
    expect(json.status).toBe(200);
    expect(json.body.data.rows[0].billed).toBe(416.4);
    const csv = await as.billing.get(`/api/reports/revenue?from=${today}&to=${today}&format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Net collection');
    expect((await as.billing.get(`/api/reports/lab?from=${today}&to=${today}`)).status).toBe(403);
  });

  it('computes analytics from recorded data', async () => {
    const res = await as.management.get(`/api/analytics?from=${today}&to=${today}`);
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toMatchObject({ consultationsCompleted: 1, billed: 416.4, collected: 396.4 });
  });

  it('records the workflow in an append-only audit log', async () => {
    const res = await as.admin.get('/api/audit?limit=200');
    const actions = new Set(res.body.data.map((a: { action: string }) => a.action));
    for (const action of [
      'auth.login',
      'patient.create',
      'patient.update',
      'appointment.create',
      'token.check_in',
      'consultation.complete',
      'prescription.create',
      'pharmacy.dispense',
      'invoice.create',
      'invoice.payment',
      'lab_order.released',
      'lab_order.amended',
      'admission.discharge',
    ]) {
      expect(actions, action).toContain(action);
    }
    const failure = await as.admin.get('/api/audit?outcome=failure&action=auth.login');
    expect(failure.body.data.length).toBeGreaterThan(0);

    await expect(AuditLog.updateOne({}, { $set: { action: 'tampered' } })).rejects.toThrow(/cannot be modified/);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/cannot be modified/);
    expect(await AuditLog.countDocuments({ action: 'tampered' })).toBe(0);
  });

  it('builds a role-aware dashboard', async () => {
    const reception = await as.reception.get('/api/dashboard');
    expect(reception.body.data.billing).toBeDefined();
    expect(reception.body.data.laboratory).toBeUndefined();
    const doctor = await as.doctor.get('/api/dashboard');
    expect(doctor.body.data.opd.scope).toBe('mine');
    expect(doctor.body.data.billing).toBeUndefined();
  });

  it('applies user deactivation immediately', async () => {
    const user = await User.findOne({ email: 'management@test.local' });
    await as.admin.patch(`/api/users/${user!.id}`, { isActive: false });
    await new Promise((r) => setTimeout(r, 50));
    const res = await request(app).post('/api/auth/login').send({ email: 'management@test.local', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(await Doctor.countDocuments()).toBe(2);
  });
});
