import { z } from 'zod';

export const IPC_CHANNELS = {
  appBootstrap: 'app:bootstrap',
  characterCreate: 'character:create',
  characterGetCurrent: 'character:get-current',
  modelProfileGet: 'model-profile:get',
  modelProfileSave: 'model-profile:save',
  modelProfileTest: 'model-profile:test',
  conversationLoad: 'conversation:load',
  conversationSearch: 'conversation:search',
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatStream: 'chat:stream',
  relationshipGetSummary: 'relationship:get-summary',
  characterVisualGet: 'character-visual:get',
  characterAssetImport: 'character-asset:import',
  imageCapabilitiesGet: 'image-capabilities:get',
  dataExportBackup: 'data:export-backup',
  dataRestoreBackup: 'data:restore-backup',
  dataExportDiagnostics: 'data:export-diagnostics',
  dataDeleteAll: 'data:delete-all',
} as const;

export const ModelProviderSchema = z.enum(['openai-compatible', 'ollama']);
export const ModelProfileInputSchema = z.object({
  provider: ModelProviderSchema,
  endpoint: z.url().refine((value) => value.startsWith('http://') || value.startsWith('https://')),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().max(1000).optional(),
});
export type ModelProfileInput = z.infer<typeof ModelProfileInputSchema>;

export const ModelProfileSnapshotSchema = ModelProfileInputSchema.omit({ apiKey: true }).extend({
  hasApiKey: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type ModelProfileSnapshot = z.infer<typeof ModelProfileSnapshotSchema>;

export const ModelConnectionResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  models: z.array(z.string()),
  message: z.string(),
});
export type ModelConnectionResult = z.infer<typeof ModelConnectionResultSchema>;

export const ConversationSnapshotSchema = z.object({
  id: z.string().min(1),
  characterId: z.string().min(1),
  title: z.string().min(1),
  startedAt: z.iso.datetime(),
  lastMessageAt: z.iso.datetime(),
});
export type ConversationSnapshot = z.infer<typeof ConversationSnapshotSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  status: z.enum(['streaming', 'completed', 'failed', 'cancelled']),
  model: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ConversationHistorySchema = z.object({
  conversation: ConversationSnapshotSchema.nullable(),
  messages: z.array(ChatMessageSchema),
});
export type ConversationHistory = z.infer<typeof ConversationHistorySchema>;

export const ConversationSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ConversationSearchInput = z.infer<typeof ConversationSearchInputSchema>;

export const ChatSendInputSchema = z.object({
  text: z.string().trim().min(1).max(8000),
  clientMessageId: z.string().min(1).max(100),
});
export type ChatSendInput = z.infer<typeof ChatSendInputSchema>;

export const ChatSendReceiptSchema = z.object({
  requestId: z.string().min(1),
  userMessage: ChatMessageSchema,
  assistantMessage: ChatMessageSchema,
});
export type ChatSendReceipt = z.infer<typeof ChatSendReceiptSchema>;

export const ChatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chunk'), requestId: z.string(), messageId: z.string(), delta: z.string() }),
  z.object({ type: z.literal('completed'), requestId: z.string(), message: ChatMessageSchema }),
  z.object({ type: z.literal('cancelled'), requestId: z.string(), message: ChatMessageSchema }),
  z.object({ type: z.literal('failed'), requestId: z.string(), message: ChatMessageSchema,
    error: z.string().min(1), retryable: z.boolean() }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

export const RelationshipSummarySchema = z.object({
  headline: z.string().min(1),
  description: z.string().min(1),
  mood: z.string().min(1),
  updatedAt: z.iso.datetime(),
});
export type RelationshipSummary = z.infer<typeof RelationshipSummarySchema>;

export const ImageCapabilitiesSchema = z.object({
  analysis: z.boolean(),
  generation: z.boolean(),
  provider: z.string().nullable(),
  reason: z.string().min(1),
});
export type ImageCapabilities = z.infer<typeof ImageCapabilitiesSchema>;

export const CharacterAssetSchema = z.object({
  id: z.string().min(1),
  characterId: z.string().min(1),
  type: z.literal('portrait'),
  source: z.enum(['imported', 'generated']),
  version: z.number().int().positive(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  fileName: z.string().min(1),
  dataUrl: z.string().startsWith('data:image/'),
  createdAt: z.iso.datetime(),
});
export type CharacterAsset = z.infer<typeof CharacterAssetSchema>;

export const CharacterVisualProfileSchema = z.object({
  characterId: z.string().min(1),
  identityDescription: z.string().min(1),
  generationPrompt: z.string().min(1),
  negativePrompt: z.string().min(1),
  currentAsset: CharacterAssetSchema.nullable(),
  updatedAt: z.iso.datetime(),
});
export type CharacterVisualProfile = z.infer<typeof CharacterVisualProfileSchema>;

export const DataOperationResultSchema = z.object({
  ok: z.literal(true),
  message: z.string().min(1),
  fileName: z.string().min(1),
  requiresRestart: z.boolean(),
});
export type DataOperationResult = z.infer<typeof DataOperationResultSchema>;

export const DeleteAllDataInputSchema = z.object({
  confirmation: z.literal('删除全部数据'),
}).strict();
export type DeleteAllDataInput = z.infer<typeof DeleteAllDataInputSchema>;

export const PersonalityTemplateIdSchema = z.enum([
  'gentle', 'energetic', 'reserved', 'tsundere', 'mature', 'rational',
]);

export const CharacterDraftSchema = z.object({
  name: z.string().trim().min(1).max(40),
  gender: z.string().trim().min(1).max(30),
  ageSetting: z.string().trim().min(1).max(40),
  identity: z.string().trim().min(1).max(500),
  background: z.string().trim().max(4000),
  appearance: z.string().trim().min(1).max(2000),
  speakingStyle: z.string().trim().min(1).max(1000),
  personalityTemplateId: PersonalityTemplateIdSchema,
});

export type CharacterDraftInput = z.infer<typeof CharacterDraftSchema>;

export const PersonalityValuesSchema = z.object({
  warmth: z.number().min(0).max(1), energy: z.number().min(0).max(1),
  reserve: z.number().min(0).max(1), playfulness: z.number().min(0).max(1),
  maturity: z.number().min(0).max(1), rationality: z.number().min(0).max(1),
  initiative: z.number().min(0).max(1),
});

export const CharacterSnapshotSchema = CharacterDraftSchema.extend({
  id: z.string().min(1),
  personalityBaseline: PersonalityValuesSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type CharacterSnapshot = z.infer<typeof CharacterSnapshotSchema>;

export const AppErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  correlationId: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type AppError = z.infer<typeof AppErrorSchema>;

export const BootstrapResponseSchema = z.object({
  appVersion: z.string().min(1),
  platform: z.enum(['win32', 'darwin', 'linux']),
  environment: z.enum(['development', 'test', 'production']),
  dataPath: z.string().min(1),
  capabilities: z.object({
    character: z.boolean(),
    chat: z.boolean(),
    memory: z.boolean(),
  }),
  setup: z.object({
    modelConfigured: z.boolean(),
  }),
  currentCharacter: CharacterSnapshotSchema.nullable(),
});

export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>;

export interface AiLoverDesktopApi {
  bootstrap(): Promise<BootstrapResponse>;
  character: {
    create(draft: CharacterDraftInput): Promise<CharacterSnapshot>;
    getCurrent(): Promise<CharacterSnapshot | null>;
  };
  modelProfile: {
    get(): Promise<ModelProfileSnapshot | null>;
    save(input: ModelProfileInput): Promise<ModelProfileSnapshot>;
    test(input: ModelProfileInput): Promise<ModelConnectionResult>;
  };
  conversation: {
    load(): Promise<ConversationHistory>;
    search(input: ConversationSearchInput): Promise<ChatMessage[]>;
  };
  chat: {
    send(input: ChatSendInput): Promise<ChatSendReceipt>;
    cancel(requestId: string): Promise<void>;
    onStream(listener: (event: ChatStreamEvent) => void): () => void;
  };
  relationship: {
    getSummary(): Promise<RelationshipSummary | null>;
  };
  visuals: {
    get(): Promise<CharacterVisualProfile | null>;
    importPortrait(): Promise<CharacterVisualProfile | null>;
    getCapabilities(): Promise<ImageCapabilities>;
  };
  data: {
    exportBackup(): Promise<DataOperationResult | null>;
    restoreBackup(): Promise<DataOperationResult | null>;
    exportDiagnostics(): Promise<DataOperationResult | null>;
    deleteAll(input: DeleteAllDataInput): Promise<DataOperationResult | null>;
  };
}

export const DomainEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  version: z.literal(1),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  correlationId: z.string().min(1),
  causationId: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()),
});

export type DomainEvent = z.infer<typeof DomainEventSchema>;
