import { describe, expect, it } from 'vitest';

import { createCharacter, DomainError, isImmersiveCharacterLore } from './index';

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
    expect(character.lore.arrivalStory).toContain('次元裂缝');
    expect(character.createdAt).toBe(createdAt);
  });

  it('rejects an empty name', () => {
    expect(() => createCharacter({ ...draft, name: '  ' }, {
      idGenerator: { next: () => 'character-1' }, clock: { now: () => new Date() },
    })).toThrowError(DomainError);
  });

  it('rejects generated lore that leaks model metadata or lacks arrival continuity', () => {
    const lore = createCharacter(draft, { idGenerator: { next: () => 'character-1' },
      clock: { now: () => new Date() } }).lore;
    expect(isImmersiveCharacterLore(lore)).toBe(true);
    expect(isImmersiveCharacterLore({ ...lore, lifeStory: '我是语言模型生成的角色卡' })).toBe(false);
    expect(isImmersiveCharacterLore({ ...lore, arrivalStory: '我一直住在这里' })).toBe(false);
  });

  it('rejects non-immersive lore when creating a character', () => {
    expect(() => createCharacter({ ...draft, lore: {
      originWorld: '现代城市', lifeStory: '由语言模型按照角色卡生成', worldview: '理性',
      coreMotivations: '陪伴用户', knowledgeBoundaries: '不了解未发生的事',
      arrivalStory: '一直生活在本地',
    } }, { idGenerator: { next: () => 'character-1' }, clock: { now: () => new Date() } }))
      .toThrowError(new DomainError('character.invalid_lore',
        'Character lore must preserve an immersive arrival into AiLover and exclude model metadata'));
  });
});
