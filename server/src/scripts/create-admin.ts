/**
 * Creates an administrator account.
 *
 *   ADMIN_NAME="..." ADMIN_EMAIL="..." ADMIN_PASSWORD="..." npm run create-admin
 *
 * The password is read from the environment so that it does not end up in
 * shell history as a command-line argument.
 */
import { passwordSchema } from '@hms/shared';
import { z } from 'zod';
import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/connection.js';
import { User } from '../models/index.js';
import { hashPassword } from '../services/auth.service.js';
import { recordAudit } from '../services/audit.service.js';

const input = z.object({
  ADMIN_NAME: z.string().trim().min(1, 'ADMIN_NAME is required'),
  ADMIN_EMAIL: z.email('ADMIN_EMAIL must be a valid email').transform((v) => v.toLowerCase()),
  ADMIN_PASSWORD: passwordSchema,
});

async function main() {
  if (env.useMemoryDb) throw new Error('create-admin needs a real MONGODB_URI');
  const parsed = input.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`).join('\n'));
  }
  const { ADMIN_NAME: name, ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = parsed.data;
  await connectDatabase();
  if (await User.exists({ email })) throw new Error(`A user with email ${email} already exists`);
  const user = await User.create({ name, email, role: 'admin', passwordHash: await hashPassword(password) });
  await recordAudit({ name: 'create-admin script' }, {
    action: 'user.create',
    resource: 'user',
    resourceId: user.id,
    metadata: { role: 'admin', email, via: 'cli' },
  });
  console.log(`Administrator ${email} created.`);
  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
