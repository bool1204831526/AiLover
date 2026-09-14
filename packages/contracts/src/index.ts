import { z } from 'zod';

export const IPC_CHANNELS = {
  appBootstrap: 'app:bootstrap',
  characterCreate: 'character:create',
  characterGetCurrent: 'character:get-current',
  characterList: 'character:list',
  characterSwitch: 'character:switch',
  characterDelete: 'character:delete',
  characterCardExport: 'character-card:export',
  characterCardImport: 'character-card:import',
  characterLoreGenerate: 'character-lore:generate',
  characterLoreUpdate: 'character-lore:update',
  modelProfileGet: 'model-profile:get',
  modelProfileSave: 'model-profile:save',
  modelProfileTest: 'model-profile:test',
  conversationLoad: 'conversation:load',
  conversationSearch: 'conversation:search',
  conversationContext: 'conversation:context',
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatStream: 'chat:stream',
  relationshipGetSummary: 'relationship:get-summary',
  relationshipGetTimeline: 'relationship:get-timeline',
  personalityEvidenceGet: 'personality-evidence:get',
  memoryList: 'memory:list',
  memoryCorrect: 'memory:correct', memoryDelete: 'memory:delete', memoryRestore: 'memory:restore',
  memoryResolve: 'memory:resolve',
  characterVisualGet: 'character-visual:get',
  characterAssetImport: 'character-asset:import',
  imageCapabilitiesGet: 'image-capabilities:get',
  desktopPetPackGet: 'desktop-pet-pack:get',
  desktopPetPackImport: 'desktop-pet-pack:import',
  desktopPetStateGet: 'desktop-pet-state:get',
  desktopPetStateChanged: 'desktop-pet-state:changed',
  dataExportBackup: 'data:export-backup',
  dataRestoreBackup: 'data:restore-backup',
  dataExportDiagnostics: 'data:export-diagnostics',
  dataDeleteAll: 'data:delete-all',
  companionSettingsGet: 'companion-settings:get',
  companionSettingsSave: 'companion-settings:save',
  companionFocusMain: 'companion:focus-main',
  companionClosePet: 'companion:close-pet',
  companionInteractPet: 'companion:interact-pet',
} as const;

const TimeOfDaySchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const CompanionSettingsSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(30).max(1440),
  quietStart: TimeOfDaySchema,
  quietEnd: TimeOfDaySchema,
  desktopPetEnabled: z.boolean(),
  desktopPetRoamingEnabled: z.boolean(),
});
export type CompanionSettings = z.infer<typeof CompanionSettingsSchema>;

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

export const ConversationContextInputSchema = z.object({
  messageId: z.string().min(1).max(100),
});
export type ConversationContextInput = z.infer<typeof ConversationContextInputSchema>;

export const ChatSendInputSchema = z.object({
  text: z.string().trim().min(1).max(8000),
  clientMessageId: z.string().min(1).max(100),
  scene: z.string().trim().max(1000).optional(),
});
export type ChatSendInput = z.infer<typeof ChatSendInputSchema>;

export const ChatSendReceiptSchema = z.object({
  requestId: z.string().min(1),
  userMessage: ChatMessageSchema,
  assistantMessage: ChatMessageSchema,
});
export type ChatSendReceipt = z.infer<typeof ChatSendReceiptSchema>;

export const ChatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started'), requestId: z.string(),
    userMessage: ChatMessageSchema, assistantMessage: ChatMessageSchema }),
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
  trust: z.number().min(0).max(1),
  vigilance: z.number().min(0).max(1),
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

export const DesktopPetActionSchema = z.enum([
  'idle', 'walk-left', 'walk-right', 'greet', 'happy', 'thinking', 'sleep',
]);
export const DesktopPetPackManifestSchema = z.object({
  version: z.literal(1),
  actions: z.object({
    idle: z.string().min(1),
    'walk-left': z.string().min(1).optional(),
    'walk-right': z.string().min(1).optional(),
    greet: z.string().min(1).optional(),
    happy: z.string().min(1).optional(),
    thinking: z.string().min(1).optional(),
    sleep: z.string().min(1).optional(),
  }).strict(),
}).strict();
export type DesktopPetPackManifest = z.infer<typeof DesktopPetPackManifestSchema>;

export const CodexPetManifestSchema = z.object({
  id: z.string().min(1).max(80),
  displayName: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  spriteVersionNumber: z.preprocess((value) => {
    if (value === undefined) return 1;
    if (value === '1' || value === '2') return Number(value);
    return value;
  }, z.union([z.literal(1), z.literal(2)])),
  spritesheetPath: z.string().min(1),
}).strip();
export type CodexPetManifest = z.infer<typeof CodexPetManifestSchema>;

export const DesktopPetPackSchema = z.object({
  version: z.number().int().positive(),
  mode: z.enum(['actions', 'codex-v1', 'codex-v2']),
  availableActions: z.array(DesktopPetActionSchema),
  missingRecommended: z.array(DesktopPetActionSchema),
  actionDataUrls: z.partialRecord(DesktopPetActionSchema, z.string().startsWith('data:image/')),
  atlas: z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().optional(),
    spriteVersionNumber: z.union([z.literal(1), z.literal(2)]),
    dataUrl: z.string().startsWith('data:image/'),
  }).optional(),
  message: z.string().min(1),
}).superRefine((pack, context) => {
  if (pack.mode !== 'actions' && !pack.atlas) {
    context.addIssue({ code: 'custom', path: ['atlas'], message: 'Codex atlas pack requires an atlas' });
  }
});
export type DesktopPetPack = z.infer<typeof DesktopPetPackSchema>;

export const DesktopPetRuntimeStateSchema = z.enum([
  'idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review',
  'sleeping',
]);
export type DesktopPetRuntimeState = z.infer<typeof DesktopPetRuntimeStateSchema>;

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

export const CharacterLoreSchema = z.object({
  originWorld: z.string().trim().min(1).max(3000),
  lifeStory: z.string().trim().min(1).max(8000),
  worldview: z.string().trim().min(1).max(4000),
  coreMotivations: z.string().trim().min(1).max(3000),
  knowledgeBoundaries: z.string().trim().min(1).max(4000),
  arrivalStory: z.string().trim().min(1).max(3000),
}).strict();
export type CharacterLoreInput = z.infer<typeof CharacterLoreSchema>;

export const CharacterDraftSchema = z.object({
  name: z.string().trim().min(1).max(40),
  gender: z.string().trim().min(1).max(30),
  ageSetting: z.string().trim().min(1).max(40),
  identity: z.string().trim().min(1).max(500),
  background: z.string().trim().max(4000),
  appearance: z.string().trim().min(1).max(2000),
  speakingStyle: z.string().trim().min(1).max(1000),
  personalityTemplateId: PersonalityTemplateIdSchema,
  lore: CharacterLoreSchema.optional(),
});

export type CharacterDraftInput = z.infer<typeof CharacterDraftSchema>;

export const PersonalityValuesSchema = z.object({
  warmth: z.number().min(0).max(1), energy: z.number().min(0).max(1),
  reserve: z.number().min(0).max(1), playfulness: z.number().min(0).max(1),
  maturity: z.number().min(0).max(1), rationality: z.number().min(0).max(1),
  initiative: z.number().min(0).max(1),
});

export const CharacterSnapshotSchema = CharacterDraftSchema.extend({
  lore: CharacterLoreSchema,
  id: z.string().min(1),
  personalityBaseline: PersonalityValuesSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type CharacterSnapshot = z.infer<typeof CharacterSnapshotSchema>;
export const CharacterCardImportResultSchema = z.object({ character: CharacterSnapshotSchema,
  environment: z.string().max(3000).nullable() });
export type CharacterCardImportResult = z.infer<typeof CharacterCardImportResultSchema>;

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

export const RelationshipMilestoneSchema = z.object({
  episodeId: z.string().min(1), occurredAt: z.iso.datetime(), title: z.string().min(1),
  kind: z.enum(['first', 'shared-achievement', 'strong-emotion', 'conflict', 'repair', 'disclosure', 'relationship']),
  importance: z.number().min(0).max(1),
});
export const RelationshipTimelineSchema = z.array(RelationshipMilestoneSchema);
export type RelationshipMilestone = z.infer<typeof RelationshipMilestoneSchema>;
const PersonalityTraitSchema = z.enum(['warmth', 'energy', 'reserve', 'playfulness', 'maturity', 'rationality', 'initiative']);
export const PersonalityEvidenceSummarySchema = z.object({
  trait: PersonalityTraitSchema, positive: z.number().int().nonnegative(), negative: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(), latest: z.array(z.object({ direction: z.union([z.literal(-1), z.literal(1)]),
    sourceMessageId: z.string().min(1), reason: z.string().min(1), recordedAt: z.iso.datetime() })),
});
export const PersonalityEvidenceSummariesSchema = z.array(PersonalityEvidenceSummarySchema);
export type PersonalityEvidenceSummary = z.infer<typeof PersonalityEvidenceSummarySchema>;

export const MemoryCenterEntrySchema = z.object({
  id: z.string().min(1), type: z.enum(['semantic', 'preference', 'plan', 'episodic', 'relationship']),
  subject: z.string(), content: z.string(), confidence: z.number().min(0).max(1),
  importance: z.number().min(0).max(1), reinforcementCount: z.number().int().positive(),
  state: z.enum(['active', 'superseded', 'expired']),
  lifecycle: z.enum(['active', 'naturally-expired', 'user-deleted', 'superseded']),
  firstSeenAt: z.iso.datetime(), lastSeenAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(), evidence: z.string(),
  source: z.object({ messageId: z.string().min(1), conversationId: z.string().min(1),
    excerpt: z.string(), evidence: z.string(), createdAt: z.iso.datetime() }).nullable(),
  sources: z.array(z.object({ messageId: z.string().min(1), conversationId: z.string().min(1),
    excerpt: z.string(), evidence: z.string(), createdAt: z.iso.datetime() })).max(20),
  relations: z.array(z.object({ memoryId: z.string().min(1), subject: z.string(), content: z.string(),
    state: z.enum(['active', 'superseded', 'expired']), relation: z.enum(['contradicts', 'supersedes']),
    direction: z.enum(['outgoing', 'incoming']),
    resolution: z.enum(['choose-current', 'choose-related', 'keep-both', 'merge']).nullable() })).max(20),
  canRestore: z.boolean(),
});
export const MemoryCenterEntriesSchema = z.array(MemoryCenterEntrySchema);
export type MemoryCenterEntry = z.infer<typeof MemoryCenterEntrySchema>;
export const MemoryCorrectionSchema = z.object({ id: z.string().min(1), content: z.string().trim().min(1).max(2000), importance: z.number().min(0).max(1) });
export type MemoryCorrection = z.infer<typeof MemoryCorrectionSchema>;
export const MemoryResolutionSchema = z.object({
  memoryId: z.string().min(1), relatedMemoryId: z.string().min(1),
  action: z.enum(['choose-current', 'choose-related', 'keep-both', 'merge']),
  mergedContent: z.string().trim().min(1).max(2000).optional(),
}).superRefine((value, context) => {
  if (value.memoryId === value.relatedMemoryId) context.addIssue({ code: 'custom', message: '不能处理同一条记忆' });
  if (value.action === 'merge' && !value.mergedContent) context.addIssue({ code: 'custom', message: '合并内容不能为空' });
});
export type MemoryResolution = z.infer<typeof MemoryResolutionSchema>;

export interface AiLoverDesktopApi {
  bootstrap(): Promise<BootstrapResponse>;
  character: {
    create(draft: CharacterDraftInput): Promise<CharacterSnapshot>;
    getCurrent(): Promise<CharacterSnapshot | null>;
    list(): Promise<CharacterSnapshot[]>;
    switch(id: string): Promise<CharacterSnapshot>;
    delete(id: string): Promise<void>;
    exportCard(environment?: string): Promise<DataOperationResult | null>;
    importCard(): Promise<CharacterCardImportResult | null>;
    generateLore(draft: CharacterDraftInput): Promise<CharacterLoreInput>;
    updateLore(lore: CharacterLoreInput): Promise<CharacterSnapshot>;
  };
  modelProfile: {
    get(): Promise<ModelProfileSnapshot | null>;
    save(input: ModelProfileInput): Promise<ModelProfileSnapshot>;
    test(input: ModelProfileInput): Promise<ModelConnectionResult>;
  };
  conversation: {
    load(): Promise<ConversationHistory>;
    search(input: ConversationSearchInput): Promise<ChatMessage[]>;
    loadContext(input: ConversationContextInput): Promise<ConversationHistory>;
  };
  chat: {
    send(input: ChatSendInput): Promise<ChatSendReceipt>;
    cancel(requestId: string): Promise<void>;
    onStream(listener: (event: ChatStreamEvent) => void): () => void;
  };
  relationship: {
    getSummary(): Promise<RelationshipSummary | null>;
    getTimeline(): Promise<RelationshipMilestone[]>;
  };
  personality: { getEvidence(): Promise<PersonalityEvidenceSummary[]> };
  memory: { list(): Promise<MemoryCenterEntry[]>; correct(input: MemoryCorrection): Promise<void>;
    delete(id: string): Promise<void>; restore(id: string): Promise<void>;
    resolve(input: MemoryResolution): Promise<void> };
  visuals: {
    get(): Promise<CharacterVisualProfile | null>;
    importPortrait(): Promise<CharacterVisualProfile | null>;
    getCapabilities(): Promise<ImageCapabilities>;
    getDesktopPetPack(): Promise<DesktopPetPack | null>;
    importDesktopPetPack(): Promise<DesktopPetPack | null>;
  };
  data: {
    exportBackup(): Promise<DataOperationResult | null>;
    restoreBackup(): Promise<DataOperationResult | null>;
    exportDiagnostics(): Promise<DataOperationResult | null>;
    deleteAll(input: DeleteAllDataInput): Promise<DataOperationResult | null>;
  };
  companion: {
    getSettings(): Promise<CompanionSettings>;
    saveSettings(input: CompanionSettings): Promise<CompanionSettings>;
    getPetState(): Promise<DesktopPetRuntimeState>;
    onPetState(listener: (state: DesktopPetRuntimeState) => void): () => void;
    interactPet(): Promise<void>;
    focusMain(): Promise<void>;
    closeDesktopPet(): Promise<void>;
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
