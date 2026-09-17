import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import type { Role } from '@hms/shared';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/db/connection.js';
import { User } from '../src/models/index.js';
import { ensureBaseData } from '../src/seed/base.js';
import { hashPassword } from '../src/services/auth.service.js';

export const PASSWORD = 'Test-Password-123';

let replSet: MongoMemoryReplSet | null = null;

export async function startTestServer() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connectDatabase(replSet.getUri());
  await ensureBaseData();
  return createApp();
}

export async function stopTestServer() {
  await disconnectDatabase();
  await replSet?.stop();
}

export async function createUser(role: Role, key: string) {
  return User.create({
    name: `Test ${key}`,
    email: `${key}@test.local`,
    role,
    passwordHash: await hashPassword(PASSWORD),
  });
}

export async function login(app: Parameters<typeof request>[0], email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken as string;
}

/** Minimal authenticated client bound to one user. */
export function client(app: Parameters<typeof request>[0], token: string) {
  const auth = { Authorization: `Bearer ${token}` };
  return {
    get: (url: string) => request(app).get(url).set(auth),
    post: (url: string, body: object = {}) => request(app).post(url).set(auth).send(body),
    patch: (url: string, body: object = {}) => request(app).patch(url).set(auth).send(body),
    put: (url: string, body: object = {}) => request(app).put(url).set(auth).send(body),
  };
}
