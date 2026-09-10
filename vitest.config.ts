import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => resolve(process.cwd(), path);

export default defineConfig({
  resolve: {
    alias: {
      '@ailover/contracts': fromRoot('./packages/contracts/src/index.ts'),
      '@ailover/domain': fromRoot('./packages/domain/src/index.ts'),
      '@ailover/application': fromRoot('./packages/application/src/index.ts'),
      '@ailover/observability': fromRoot('./packages/observability/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
