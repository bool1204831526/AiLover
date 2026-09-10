import { z } from 'zod';

export const IPC_CHANNELS = {
  appBootstrap: 'app:bootstrap',
  characterCreate: 'character:create',
  characterGetCurrent: 'character:get-current',
  modelProfileGet: 'model-profile:get',
  modelProfileSave: 'model-profile:save',
  modelProfileTest: 'model-profile:test',
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
