import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'web/src/**/*.test.ts'],
    // Keeps the JSON server logs out of the test output. Tests that check logging turn it back on.
    env: { LOG_LEVEL: 'silent' },
    coverage: {
      include: ['server/**/*.ts', 'shared/**/*.ts', 'web/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'server/index.ts'],
    },
  },
});
