import { contextBridge, ipcRenderer } from 'electron';

import {
  BootstrapResponseSchema,
  IPC_CHANNELS,
  type AiLoverDesktopApi,
} from '@ailover/contracts';

const api: AiLoverDesktopApi = {
  bootstrap: async () => {
    const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.appBootstrap);
    return BootstrapResponseSchema.parse(result);
  },
};

contextBridge.exposeInMainWorld('ailover', api);
