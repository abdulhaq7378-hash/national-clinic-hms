import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connection.js';
import { ensureBaseData } from './seed/base.js';
import { logger } from './utils/logger.js';

async function main() {
  await connectDatabase();
  await ensureBaseData();

  if (env.useMemoryDb) {
    // Development convenience: the in-memory database starts empty on every run.
    const { seedDemoData } = await import('./seed/demo/index.js');
    await seedDemoData();
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`HMS API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close();
    server.closeAllConnections();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
