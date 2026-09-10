import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCharacter } from '@ailover/domain';

import {
  openAppDatabase, SqliteCharacterRepository, SqliteConversationRepository, SqliteModelProfileRepository,
} from './index';

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) {
    for (const suffix of ['', '-shm', '-wal']) if (existsSync(path + suffix)) rmSync(path + suffix);
  }
});

describe('SqliteCharacterRepository', () => {
  it('restores the current character across database restarts', async () => {
    const path = join(tmpdir(), `ailover-${randomUUID()}.sqlite`);
    paths.push(path);
    const character = createCharacter({
      name: '艾琳', gender: '女', ageSetting: '成年', identity: 'AI 伴侣',
      background: '喜欢安静的夜晚', appearance: '银白色长发', speakingStyle: '温柔',
      personalityTemplateId: 'gentle',
    }, { idGenerator: { next: () => 'character-1' }, clock: { now: () => new Date('2026-09-11T00:00:00Z') } });
    const first = openAppDatabase(path);
    await new SqliteCharacterRepository(first).save(character);
    first.close();
    const second = openAppDatabase(path);
    const restored = await new SqliteCharacterRepository(second).findCurrent();
    expect(restored?.name).toBe('艾琳');
    expect(restored?.personalityBaseline.warmth).toBe(0.9);
    second.close();
  });
});

describe('SqliteModelProfileRepository', () => {
  it('stores only the encrypted credential representation', async () => {
    const path = join(tmpdir(), `ailover-${randomUUID()}.sqlite`);
    paths.push(path);
    const database = openAppDatabase(path);
    const repository = new SqliteModelProfileRepository(database);
    await repository.save({ provider: 'openai-compatible', endpoint: 'https://example.test/v1',
      model: 'model-a', encryptedApiKey: 'encrypted-value', updatedAt: new Date('2026-09-11T00:00:00Z') });
    const restored = await repository.get();
    expect(restored?.encryptedApiKey).toBe('encrypted-value');
    expect(database.sqlite.prepare('SELECT encrypted_api_key FROM model_profiles').get())
      .toEqual({ encrypted_api_key: 'encrypted-value' });
    database.close();
  });
});

describe('SqliteConversationRepository', () => {
  it('restores ordered messages across database restarts', async () => {
    const path = join(tmpdir(), `ailover-${randomUUID()}.sqlite`);
    paths.push(path);
    const character = createCharacter({
      name: '艾琳', gender: '女', ageSetting: '成年', identity: 'AI 伴侣', background: '',
      appearance: '银白色长发', speakingStyle: '温柔', personalityTemplateId: 'gentle',
    }, { idGenerator: { next: () => 'character-chat' }, clock: { now: () => new Date('2026-09-11T00:00:00Z') } });
    const first = openAppDatabase(path);
    await new SqliteCharacterRepository(first).save(character);
    const repository = new SqliteConversationRepository(first);
    const startedAt = new Date('2026-09-11T01:00:00Z');
    await repository.create({ id: 'conversation-1', characterId: character.id,
      title: '第一次对话', startedAt, lastMessageAt: startedAt });
    await repository.saveMessage({ id: 'message-1', conversationId: 'conversation-1', role: 'user',
      content: '你好', status: 'completed', model: null, createdAt: startedAt });
    await repository.saveMessage({ id: 'message-2', conversationId: 'conversation-1', role: 'assistant',
      content: '很高兴见到你', status: 'completed', model: 'model-a',
      createdAt: new Date('2026-09-11T01:00:01Z') });
    first.close();

    const second = openAppDatabase(path);
    const restored = new SqliteConversationRepository(second);
    expect((await restored.findCurrent(character.id))?.id).toBe('conversation-1');
    expect((await restored.listMessages('conversation-1')).map(({ content }) => content))
      .toEqual(['你好', '很高兴见到你']);
    second.close();
  });
});
