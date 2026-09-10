import { describe, expect, it } from 'vitest';

import { createCharacter, DomainError } from './index';

describe('DomainError', () => {
  it('retains a stable code and context', () => {
    const error = new DomainError('character.invalid', 'Invalid character', { field: 'name' });

    expect(error.code).toBe('character.invalid');
    expect(error.context).toEqual({ field: 'name' });
  });
});

describe('createCharacter', () => {
  const draft = {
    name: ' 艾琳 ', gender: '女', ageSetting: '成年', identity: 'AI 伴侣', background: '',
    appearance: '银白色长发，蓝色眼睛', speakingStyle: '温柔，偶尔傲娇',
    personalityTemplateId: 'tsundere' as const,
  };

  it('creates a stable personality baseline and normalized identity', () => {
    const createdAt = new Date('2026-09-11T00:00:00.000Z');
    const character = createCharacter(draft, {
      idGenerator: { next: () => 'character-1' }, clock: { now: () => createdAt },
    });
    expect(character.name).toBe('艾琳');
    expect(character.personalityBaseline.reserve).toBeGreaterThan(0.7);
    expect(character.createdAt).toBe(createdAt);
  });

  it('rejects an empty name', () => {
    expect(() => createCharacter({ ...draft, name: '  ' }, {
      idGenerator: { next: () => 'character-1' }, clock: { now: () => new Date() },
    })).toThrowError(DomainError);
  });
});
