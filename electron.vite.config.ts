import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const projectRoot = process.cwd();
const fromRoot = (path: string) => resolve(projectRoot, path);

const aliases = {
  '@ailover/contracts': fromRoot('./packages/contracts/src/index.ts'),
  '@ailover/domain': fromRoot('./packages/domain/src/index.ts'),
  '@ailover/application': fromRoot('./packages/application/src/index.ts'),
  '@ailover/observability': fromRoot('./packages/observability/src/index.ts'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        input: fromRoot('./apps/desktop/src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        input: fromRoot('./apps/desktop/src/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: fromRoot('./apps/desktop/src/renderer'),
    resolve: { alias: aliases },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: fromRoot('./apps/desktop/src/renderer/index.html'),
      },
    },
  },
});
