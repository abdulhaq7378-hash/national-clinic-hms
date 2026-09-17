import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

// One .env file at the repository root serves the whole project. A server/.env, if present, wins.
config({ path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../.env')], quiet: true });

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_ISSUER: z.string().default('national-clinic-hms'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(60).default(7),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: z.string().default('0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(1000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
  SERVE_WEB_DIST: z.string().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().optional(),
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';
const useMemoryDb = raw.MONGODB_URI === 'memory';

if (isProduction && useMemoryDb) {
  console.error('MONGODB_URI=memory is only allowed outside production.');
  process.exit(1);
}

let accessSecret = raw.JWT_ACCESS_SECRET;
if (!accessSecret || accessSecret.length < 32) {
  if (isProduction) {
    console.error('JWT_ACCESS_SECRET must be set to a random value of at least 32 characters in production.');
    process.exit(1);
  }
  // Development only: an ephemeral secret means sessions end whenever the server restarts.
  accessSecret = randomBytes(48).toString('hex');
  if (raw.NODE_ENV === 'development') {
    console.warn('JWT_ACCESS_SECRET is not set. Using a temporary secret for this development run.');
  }
}

export const env = {
  ...raw,
  isProduction,
  isTest: raw.NODE_ENV === 'test',
  useMemoryDb,
  JWT_ACCESS_SECRET: accessSecret,
  COOKIE_SECURE: raw.COOKIE_SECURE ?? isProduction,
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  trustProxy: /^\d+$/.test(raw.TRUST_PROXY) ? Number(raw.TRUST_PROXY) : raw.TRUST_PROXY,
};

export type Env = typeof env;
