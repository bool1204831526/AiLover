import { contextBridge, ipcRenderer } from 'electron';

import {
  BootstrapResponseSchema,
  CharacterDraftSchema,
  CharacterSnapshotSchema,
  IPC_CHANNELS,
  ModelConnectionResultSchema,
  ModelProfileInputSchema,
  ModelProfileSnapshotSchema,
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
  modelProfile: {
    get: async () => {
      const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.modelProfileGet);
      return result === null ? null : ModelProfileSnapshotSchema.parse(result);
    },
    save: async (profile) => {
      const input = ModelProfileInputSchema.parse(profile);
      const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.modelProfileSave, input);
      return ModelProfileSnapshotSchema.parse(result);
    },
    test: async (profile) => {
      const input = ModelProfileInputSchema.parse(profile);
      const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.modelProfileTest, input);
      return ModelConnectionResultSchema.parse(result);
    },
  },
};

contextBridge.exposeInMainWorld('ailover', api);
