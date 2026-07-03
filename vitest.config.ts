import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['shared/**/*.ts'],
      exclude: ['shared/**/index.ts'],
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'json'],
      thresholds: {
        lines: 80,
        statements: 80,
      },
    },
  },
});