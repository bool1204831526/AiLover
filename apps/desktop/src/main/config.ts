import { z } from 'zod';

const AppConfigSchema = z.object({
  environment: z.enum(['development', 'test', 'production']),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export function loadAppConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return AppConfigSchema.parse({
    environment: environment.NODE_ENV ?? 'development',
    logLevel: environment.AILOVER_LOG_LEVEL ?? 'info',
  });
}
