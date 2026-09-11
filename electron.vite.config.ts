import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const projectRoot = process.cwd();
const fromRoot = (path: string) => resolve(projectRoot, path);

const aliases = {
  '@ailover/backup': fromRoot('./packages/backup/src/index.ts'),
  '@ailover/contracts': fromRoot('./packages/contracts/src/index.ts'),
  '@ailover/cognition': fromRoot('./packages/cognition/src/index.ts'),
  '@ailover/domain': fromRoot('./packages/domain/src/index.ts'),
  '@ailover/application': fromRoot('./packages/application/src/index.ts'),
  '@ailover/memory': fromRoot('./packages/memory/src/index.ts'),
  '@ailover/model-gateway': fromRoot('./packages/model-gateway/src/index.ts'),
  '@ailover/observability': fromRoot('./packages/observability/src/index.ts'),
  '@ailover/persistence': fromRoot('./packages/persistence/src/index.ts'),
};

const workspacePackages = Object.keys(aliases);
const preloadBundledDependencies = [...workspacePackages, 'zod'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        input: fromRoot('./apps/desktop/src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: preloadBundledDependencies })],
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        input: fromRoot('./apps/desktop/src/preload/index.ts'),
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
        },
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
