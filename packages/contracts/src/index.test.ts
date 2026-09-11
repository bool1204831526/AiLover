import { describe, expect, it } from 'vitest';

import {
  BootstrapResponseSchema, ChatStreamEventSchema, DomainEventSchema, ModelProfileSnapshotSchema,
} from './index';

describe('shared contracts', () => {
  it('accepts a valid bootstrap response', () => {
    const result = BootstrapResponseSchema.parse({
      appVersion: '0.1.0',
      platform: 'win32',
      environment: 'test',
      dataPath: 'C:\\AiLoverData',
      capabilities: { character: false, chat: false, memory: false },
      setup: { modelConfigured: false },
      currentCharacter: null,
    });

    expect(result.platform).toBe('win32');
  });

  it('rejects an event without a correlation id', () => {
    expect(() =>
      DomainEventSchema.parse({
        id: 'event-1',
        type: 'character.created',
        version: 1,
        aggregateType: 'character',
        aggregateId: 'character-1',
        occurredAt: new Date().toISOString(),
        payload: {},
      }),
    ).toThrow();
  });

  it('never exposes an API key in a saved model profile', () => {
    const result = ModelProfileSnapshotSchema.parse({ provider: 'openai-compatible',
      endpoint: 'https://example.test/v1', model: 'model-a', hasApiKey: true,
      updatedAt: new Date().toISOString(), apiKey: 'must-not-survive' });
    expect(result).not.toHaveProperty('apiKey');
  });

  it('validates streaming chat events by event type', () => {
    const event = ChatStreamEventSchema.parse({ type: 'chunk', requestId: 'request-1',
      messageId: 'message-1', delta: '你好' });
    expect(event.type === 'chunk' ? event.delta : '').toBe('你好');
    expect(() => ChatStreamEventSchema.parse({ type: 'failed', requestId: 'request-1' })).toThrow();
  });
});
