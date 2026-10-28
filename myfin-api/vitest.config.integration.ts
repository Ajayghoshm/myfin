import { defineConfig } from 'vitest/config';

// Integration tests wipe the database. Refuse to run unless DATABASE_URL is set
// explicitly to a test database, so a missing export never falls back to .env.
if (!/\/myfin_tests(\?|$)/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error(
    'Integration tests need DATABASE_URL pointing at a myfin_tests database.',
  );
}

export default defineConfig({
  test: {
    globals: true,
    include: ['__tests__/integration/**/*.test.ts'],
    setupFiles: ['__tests__/integration/utils/setup.ts'],
    maxWorkers: 1,
    isolate: false,
    // Database-backed tests seed months of data; 5 s is too tight on a busy machine.
    testTimeout: 20_000,
  },
});
