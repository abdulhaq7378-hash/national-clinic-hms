import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      // Placeholder: the tests start their own in-memory replica set and connect to it explicitly.
      MONGODB_URI: 'mongodb://placeholder',
      MONGODB_DB_NAME: 'hms_test',
      LOG_LEVEL: 'silent',
    },
  },
});
