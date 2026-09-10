import pino, { type Logger } from 'pino';

const SENSITIVE_PATHS = [
  'apiKey',
  'token',
  'authorization',
  'password',
  '*.apiKey',
  '*.token',
  '*.authorization',
  '*.password',
  'request.messages',
  'response.content',
];

export type LoggerOptions = {
  level: string;
  environment: string;
};

export function createLogger(options: LoggerOptions): Logger {
  return pino({
    level: options.level,
    base: { service: 'ailover-desktop', environment: options.environment },
    redact: { paths: SENSITIVE_PATHS, censor: '[REDACTED]' },
  });
}

export { SENSITIVE_PATHS };
