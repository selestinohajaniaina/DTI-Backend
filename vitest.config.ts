import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    // Worker threads (no IPC sockets needed) and strictly sequential files:
    // every test file shares one test database, so parallel files would
    // truncate each other's fixtures.
    pool: 'threads',
    poolOptions: {
      threads: { singleThread: true },
    },
    fileParallelism: false,
    sequence: { shuffle: false },
  },
});
