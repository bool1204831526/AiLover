/// <reference types="vite/client" />

import type { AiLoverDesktopApi } from '@ailover/contracts';

declare global {
  interface Window {
    ailover?: AiLoverDesktopApi;
  }
}

export {};
