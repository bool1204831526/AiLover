import { describe, expect, it } from 'vitest';

import { BootstrapResponseSchema, DomainEventSchema } from './index';

describe('shared contracts', () => {
  it('accepts a valid bootstrap response', () => {
    const result = BootstrapResponseSchema.parse({
      appVersion: '0.1.0',
      platform: 'win32',
      environment: 'test',
      dataPath: 'C:\\AiLoverData',
      capabilities: { character: false, chat: false, memory: false },
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
});
