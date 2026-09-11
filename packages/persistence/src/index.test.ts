import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCharacter } from '@ailover/domain';
import { CognitionService } from '@ailover/cognition';
import { MemoryService } from '@ailover/memory';

import {
  openAppDatabase, SqliteCharacterRepository, SqliteConversationRepository, SqliteModelProfileRepository,
  SqliteCognitionRepository, SqliteMemoryRepository, SqliteVisualAssetRepository,
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

describe('SqliteVisualAssetRepository', () => {
  it('versions imported portraits and restores the visual identity', async () => {
    const path = join(tmpdir(), `ailover-${randomUUID()}.sqlite`);
    paths.push(path);
    const character = createCharacter({
      name: '艾琳', gender: '女', ageSetting: '成年', identity: 'AI 伴侣', background: '',
      appearance: '银白色长发', speakingStyle: '温柔', personalityTemplateId: 'gentle',
    }, { idGenerator: { next: () => 'character-visual' }, clock: { now: () => new Date() } });
    const first = openAppDatabase(path);
    await new SqliteCharacterRepository(first).save(character);
    const repository = new SqliteVisualAssetRepository(first);
    repository.saveIdentity({ characterId: character.id, identityDescription: '银白色长发',
      generationPrompt: '清晰角色肖像', negativePrompt: '模糊', updatedAt: new Date('2026-09-11T00:00:00Z') });
    const base = { characterId: character.id, type: 'portrait' as const, source: 'imported' as const,
      localPath: 'portrait.png', mimeType: 'image/png' as const, checksum: 'a'.repeat(64),
      fileName: 'portrait.png', metadata: {}, createdAt: new Date('2026-09-11T00:00:00Z') };
    expect(repository.saveAsset({ ...base, id: 'asset-1' }).version).toBe(1);
    expect(repository.saveAsset({ ...base, id: 'asset-2' }).version).toBe(2);
    first.close();
    const second = openAppDatabase(path);
    const restored = new SqliteVisualAssetRepository(second);
    expect(restored.getIdentity(character.id)?.generationPrompt).toBe('清晰角色肖像');
    expect(restored.getCurrentAsset(character.id)?.id).toBe('asset-2');
    second.close();
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

describe('SqliteMemoryRepository', () => {
  it('persists evidence, searches FTS and audits cross-day recall', async () => {
    const path = join(tmpdir(), `ailover-${randomUUID()}.sqlite`);
    paths.push(path);
    const database = openAppDatabase(path);
    const character = createCharacter({
      name: '艾琳', gender: '女', ageSetting: '成年', identity: 'AI 伴侣', background: '',
      appearance: '银白色长发', speakingStyle: '温柔', personalityTemplateId: 'gentle',
    }, { idGenerator: { next: () => 'character-memory' }, clock: { now: () => new Date() } });
    await new SqliteCharacterRepository(database).save(character);
    const conversations = new SqliteConversationRepository(database);
    const firstSeen = new Date('2026-09-01T00:00:00Z');
    await conversations.create({ id: 'conversation-memory', characterId: character.id,
      title: '记忆测试', startedAt: firstSeen, lastMessageAt: firstSeen });
    await conversations.saveMessage({ id: 'source-message', conversationId: 'conversation-memory',
      role: 'user', content: '我喜欢手冲咖啡', status: 'completed', model: null, createdAt: firstSeen });
    await conversations.saveMessage({ id: 'query-message', conversationId: 'conversation-memory',
      role: 'user', content: '手冲咖啡', status: 'completed', model: null,
      createdAt: new Date('2026-09-11T00:00:00Z') });
    const service = new MemoryService({ repository: new SqliteMemoryRepository(database),
      idGenerator: { next: () => 'memory-fts' } });
    await service.capture({ userId: 'local-user', characterId: character.id,
      messageId: 'source-message', text: '我喜欢手冲咖啡', now: firstSeen });
    await service.capture({ userId: 'local-user', characterId: character.id,
      messageId: 'source-message', text: '我喜欢手冲咖啡', now: firstSeen });
    const recalled = await service.recall({ characterId: character.id, queryMessageId: 'query-message',
      query: '手冲咖啡', now: new Date('2026-09-11T00:00:00Z') });
    expect(recalled[0]?.id).toBe('memory-fts');
    expect(database.sqlite.prepare('SELECT evidence FROM memory_sources').get())
      .toEqual({ evidence: '我喜欢手冲咖啡' });
    expect(database.sqlite.prepare('SELECT reinforcement_count FROM memories').get())
      .toEqual({ reinforcement_count: 1 });
    expect(database.sqlite.prepare('SELECT query_message_id FROM memory_recalls').get())
      .toEqual({ query_message_id: 'query-message' });
    database.close();
  });
});

describe('SqliteCognitionRepository', () => {
  it('restores bounded state and retains its source evidence across restarts', async () => {
    const path = join(tmpdir(), `ailover-${randomUUID()}.sqlite`);
    paths.push(path);
    const first = openAppDatabase(path);
    const character = createCharacter({
      name: '艾琳', gender: '女', ageSetting: '成年', identity: 'AI 伴侣', background: '',
      appearance: '银白色长发', speakingStyle: '温柔', personalityTemplateId: 'gentle',
    }, { idGenerator: { next: () => 'character-cognition' }, clock: { now: () => new Date() } });
    await new SqliteCharacterRepository(first).save(character);
    const conversations = new SqliteConversationRepository(first);
    const at = new Date('2026-09-11T02:00:00Z');
    await conversations.create({ id: 'conversation-cognition', characterId: character.id,
      title: '状态测试', startedAt: at, lastMessageAt: at });
    await conversations.saveMessage({ id: 'cognition-message', conversationId: 'conversation-cognition',
      role: 'user', content: '告诉你一个秘密，我很喜欢你', status: 'completed', model: null, createdAt: at });
    let snapshotId = 0;
    const cognitionRepository = new SqliteCognitionRepository(first);
    const service = new CognitionService(cognitionRepository,
      { next: () => `snapshot-${++snapshotId}` });
    const changed = await service.processInteraction({ characterId: character.id,
      baseline: character.personalityBaseline, sourceMessageId: 'cognition-message',
      text: '告诉你一个秘密，我很喜欢你', now: at });
    expect(changed.relationship.trust).toBeLessThanOrEqual(0.42);
    expect(await cognitionRepository.addEvidence({ characterId: character.id, trait: 'initiative',
      direction: 1, sourceMessageId: 'cognition-message', reason: 'test evidence', recordedAt: at })).toBe(1);
    expect(await cognitionRepository.addEvidence({ characterId: character.id, trait: 'initiative',
      direction: 1, sourceMessageId: 'cognition-message', reason: 'duplicate', recordedAt: at })).toBe(1);
    first.close();

    const second = openAppDatabase(path);
    const restored = await new SqliteCognitionRepository(second).getCurrent(character.id);
    expect(restored?.sourceMessageId).toBe('cognition-message');
    expect(restored?.relationship.intimacy).toBeGreaterThan(0.2);
    expect(second.sqlite.prepare('SELECT rule_version FROM relationship_states').get())
      .toEqual({ rule_version: 'cognition-v1' });
    expect(second.sqlite.prepare('SELECT trigger_message_id FROM reflections').get())
      .toEqual({ trigger_message_id: 'cognition-message' });
    second.close();
  });
});
