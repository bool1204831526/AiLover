import { contextBridge, ipcRenderer } from 'electron';

import {
  BootstrapResponseSchema,
  CharacterDraftSchema,
  CharacterSnapshotSchema,
  IPC_CHANNELS,
  type AiLoverDesktopApi,
} from '@ailover/contracts';

const api: AiLoverDesktopApi = {
  bootstrap: async () => {
    const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.appBootstrap);
    return BootstrapResponseSchema.parse(result);
  },
  character: {
    create: async (draft) => {
      const input = CharacterDraftSchema.parse(draft);
      const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.characterCreate, input);
      return CharacterSnapshotSchema.parse(result);
    },
    getCurrent: async () => {
      const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.characterGetCurrent);
      return result === null ? null : CharacterSnapshotSchema.parse(result);
    },
  },
};

contextBridge.exposeInMainWorld('ailover', api);
