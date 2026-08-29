import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/setup/home-isolation.ts'],
    coverage: {
      provider: 'v8',
      include: ['shared/**/*.ts'],
      exclude: ['shared/**/index.ts'],
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'json'],
      thresholds: {
        // Observed final coverage (Step 12 run) minus a 0.5-pt regression buffer:
        // lines 99.8 → 99.3, statements 99.82 → 99.32, branches 98.13 → 97.63,
        // functions 100 → 99.5. Remaining gaps are documented unreachable
        // defensive code / v8 mapping artifacts (see plan best-test-coverage.md Step 12).
        lines: 99.3,
        statements: 99.32,
        branches: 97.63,
        functions: 99.5,
      },
    },
  },
});