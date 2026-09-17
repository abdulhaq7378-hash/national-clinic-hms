import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Every request input is validated with zod before it reaches a query, so user
// input can never smuggle query operators into a filter.
mongoose.set('strictQuery', true);

let supportsTransactions = false;
let memoryServer: { stop: () => Promise<unknown> } | null = null;

const STATE_NAMES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export function getDbState() {
  return STATE_NAMES[mongoose.connection.readyState] ?? 'unknown';
}

export function transactionsSupported() {
  return supportsTransactions;
}

async function resolveUri(): Promise<string> {
  if (!env.useMemoryDb) return env.MONGODB_URI;
  // Development convenience only. The package is a dev dependency and is never loaded in production.
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  memoryServer = replSet;
  logger.warn('Using an in-memory MongoDB instance. All data is lost when the server stops.');
  return replSet.getUri();
}

export async function connectDatabase(uri?: string): Promise<void> {
  const target = uri ?? (await resolveUri());

  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err: err.message }, 'MongoDB connection error'));

  await mongoose.connect(target, {
    dbName: env.MONGODB_DB_NAME || undefined,
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    autoIndex: !env.isProduction,
  });

  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  supportsTransactions = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  if (!supportsTransactions && env.isProduction) {
    // Billing, dispensing and admissions rely on multi-document transactions.
    await mongoose.disconnect();
    throw new Error(
      'Production requires MongoDB running as a replica set (a single-node replica set is enough). See README.',
    );
  }
  if (!supportsTransactions) {
    logger.warn(
      'MongoDB is running without a replica set. Multi-document transactions are disabled; ' +
        'use a replica set (for example MongoDB Atlas) in production.',
    );
  }
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

/** Creates indexes explicitly. Used in production where autoIndex is disabled. */
export async function syncIndexes(): Promise<void> {
  for (const model of Object.values(mongoose.models)) {
    await model.createIndexes();
  }
}
