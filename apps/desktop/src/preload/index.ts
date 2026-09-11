import { contextBridge, ipcRenderer } from 'electron';

import {
  BootstrapResponseSchema,
  CharacterDraftSchema,
  CharacterSnapshotSchema,
  ChatSendInputSchema,
  ChatSendReceiptSchema,
  ChatStreamEventSchema,
  ConversationHistorySchema,
  IPC_CHANNELS,
  ModelConnectionResultSchema,
  ModelProfileInputSchema,
  ModelProfileSnapshotSchema,
  RelationshipSummarySchema,
  CharacterVisualProfileSchema,
  ImageCapabilitiesSchema,
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
  conversation: {
    load: async () => {
      const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.conversationLoad);
      return ConversationHistorySchema.parse(result);
    },
  },
  chat: {
    send: async (request) => {
      const input = ChatSendInputSchema.parse(request);
      const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.chatSend, input);
      return ChatSendReceiptSchema.parse(result);
    },
    cancel: async (requestId) => {
      await ipcRenderer.invoke(IPC_CHANNELS.chatCancel, requestId);
    },
    onStream: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        listener(ChatStreamEventSchema.parse(value));
      };
      ipcRenderer.on(IPC_CHANNELS.chatStream, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.chatStream, handler);
    },
  },
  relationship: {
    getSummary: async () => {
      const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.relationshipGetSummary);
      return result === null ? null : RelationshipSummarySchema.parse(result);
    },
  },
  visuals: {
    get: async () => {
      const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.characterVisualGet);
      return result === null ? null : CharacterVisualProfileSchema.parse(result);
    },
    importPortrait: async () => {
      const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.characterAssetImport);
      return result === null ? null : CharacterVisualProfileSchema.parse(result);
    },
    getCapabilities: async () => {
      const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.imageCapabilitiesGet);
      return ImageCapabilitiesSchema.parse(result);
    },
  },
};

contextBridge.exposeInMainWorld('ailover', api);
