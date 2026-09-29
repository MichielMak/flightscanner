import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'web/src/**/*.test.ts'],
    coverage: {
      include: ['server/**/*.ts', 'shared/**/*.ts', 'web/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'server/index.ts'],
    },
  },
});
