import { z } from 'zod';

export const IPC_CHANNELS = {
  appBootstrap: 'app:bootstrap',
} as const;

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
});

export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>;

export interface AiLoverDesktopApi {
  bootstrap(): Promise<BootstrapResponse>;
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
