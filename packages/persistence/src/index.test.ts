import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCharacter } from '@ailover/domain';
import { CognitionService, type SelfModelEntry } from '@ailover/cognition';
import { EpisodicMemoryService, MemoryService, type ConsolidatedMemory, type FutureIntention } from '@ailover/memory';

import {
  openAppDatabase, SqliteCharacterRepository, SqliteConversationRepository, SqliteModelProfileRepository,
  SqliteCognitionRepository, SqliteMemoryRepository, SqliteVisualAssetRepository,
  SqliteEpisodicMemoryRepository,
  SqliteFutureIntentionRepository,
  SqliteConsolidatedMemoryRepository,
  SqliteSelfModelRepository,
  SqliteCompanionSettingsRepository,
  SqliteDesktopPetWindowStateRepository,
  createSanitizedDatabaseSnapshot, prepareRestoredDatabase, validateRestoredDatabase,
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

describe('database backup safety', () => {
  it('removes credentials and rejects databases from future schema versions', async () => {
    const sourcePath = join(tmpdir(), `ailover-source-${randomUUID()}.sqlite`);
    const snapshotPath = join(tmpdir(), `ailover-snapshot-${randomUUID()}.sqlite`);
    paths.push(sourcePath, snapshotPath);
    const source = openAppDatabase(sourcePath);
    await new SqliteModelProfileRepository(source).save({ provider: 'openai-compatible',
      endpoint: 'https://example.test/v1', model: 'model-a', encryptedApiKey: 'encrypted-secret',
      updatedAt: new Date() });
    await createSanitizedDatabaseSnapshot(source, snapshotPath);
    source.close();
    expect(validateRestoredDatabase(snapshotPath).schemaVersion).toBe(14);
    const snapshot = openAppDatabase(snapshotPath);
    expect(snapshot.sqlite.prepare('SELECT encrypted_api_key FROM model_profiles').get())
      .toEqual({ encrypted_api_key: null });
    snapshot.sqlite.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
      .run(999, new Date().toISOString());
    snapshot.close();
    expect(() => validateRestoredDatabase(snapshotPath)).toThrow('更高版本');
  });
});

describe('SqliteDesktopPetWindowStateRepository', () => {
  it('restores the last desktop pet bounds', () => {
    const path = join(tmpdir(), `ailover-${randomUUID()}.sqlite`);
    paths.push(path);
    const first = openAppDatabase(path);
    const bounds = new SqliteDesktopPetWindowStateRepository(first);
    expect(bounds.get()).toBeNull();
    bounds.save({ x: 120, y: 80, width: 240, height: 300 });
    first.close();
    const second = openAppDatabase(path);
    expect(new SqliteDesktopPetWindowStateRepository(second).get())
      .toEqual({ x: 120, y: 80, width: 240, height: 300 });
    second.close();
  });
});

describe('SqliteCompanionSettingsRepository', () => {
  it('defaults to disabled and persists consent and quiet hours', () => {
    const path = join(tmpdir(), `ailover-${randomUUID()}.sqlite`);
    paths.push(path);
    const first = openAppDatabase(path);
    const settings = new SqliteCompanionSettingsRepository(first);
    expect(settings.get().enabled).toBe(false);
    settings.save({ enabled: true, intervalMinutes: 180, quietStart: '22:30', quietEnd: '08:00',
      desktopPetEnabled: true, desktopPetRoamingEnabled: false });
    first.close();
    const second = openAppDatabase(path);
    expect(new SqliteCompanionSettingsRepository(second).get()).toMatchObject({
      enabled: true, intervalMinutes: 180, quietStart: '22:30', quietEnd: '08:00', desktopPetEnabled: true,
      desktopPetRoamingEnabled: false,
    });
    second.close();
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
    const assetPaths = new Set(['assets/character-visual/asset-1.png',
      'assets/character-visual/asset-2.png']);
    prepareRestoredDatabase(path, 'C:\\restored-assets', assetPaths);
    const third = openAppDatabase(path);
    expect(new SqliteVisualAssetRepository(third).getCurrentAsset(character.id)?.localPath)
      .toBe(join('C:\\restored-assets', 'character-visual', 'asset-2.png'));
    third.close();
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
    expect((await restored.searchMessages('conversation-1', '高兴', 10)).map(({ id }) => id))
      .toEqual(['message-2']);
    for (let index = 3; index <= 5; index += 1) {
      await restored.saveMessage({ id: `message-${index}`, conversationId: 'conversation-1',
        role: index % 2 ? 'user' : 'assistant', content: `消息 ${index}`, status: 'completed',
        model: index % 2 ? null : 'model-a', createdAt: new Date(`2026-09-11T01:00:0${index}Z`) });
    }
    expect((await restored.listMessagesAround('conversation-1', 'message-3', 1)).map(({ id }) => id))
      .toEqual(['message-2', 'message-3', 'message-4']);
    expect(await restored.listMessagesAround('conversation-1', 'missing-message', 2)).toEqual([]);
    second.close();
  });
});

describe('SqliteEpisodicMemoryRepository', () => {
  it('restores and recalls evidence-backed episodes across restarts', async () => {
    const path = join(tmpdir(), `ailover-episode-${randomUUID()}.sqlite`);
    paths.push(path);
    const character = createCharacter({ name: '艾琳', gender: '女', ageSetting: '成年',
      identity: 'AI 伴侣', background: '', appearance: '银白色长发', speakingStyle: '温柔',
      personalityTemplateId: 'gentle' }, { idGenerator: { next: () => 'episode-character' },
      clock: { now: () => new Date('2026-09-11T00:00:00Z') } });
    const first = openAppDatabase(path);
    await new SqliteCharacterRepository(first).save(character);
    const conversations = new SqliteConversationRepository(first);
    const at = new Date('2026-09-11T01:00:00Z');
    await conversations.create({ id: 'episode-conversation', characterId: character.id,
      title: '共同经历', startedAt: at, lastMessageAt: at });
    await conversations.saveMessage({ id: 'episode-user', conversationId: 'episode-conversation',
      role: 'user', content: '我们一起完成面试准备了', status: 'completed', model: null, createdAt: at });
    await conversations.saveMessage({ id: 'episode-ai', conversationId: 'episode-conversation',
      role: 'assistant', content: '你坚持下来了。', status: 'completed', model: 'model-a',
      createdAt: new Date('2026-09-11T01:00:01Z') });
    await conversations.saveMessage({ id: 'episode-query', conversationId: 'episode-conversation',
      role: 'user', content: '还记得我们完成面试准备吗', status: 'completed', model: null,
      createdAt: new Date('2026-09-12T01:00:00Z') });
    const captured = await new EpisodicMemoryService({
      repository: new SqliteEpisodicMemoryRepository(first), idGenerator: { next: () => 'episode-1' },
    }).capture({ characterId: character.id, characterName: character.name,
      conversationId: 'episode-conversation', userMessageId: 'episode-user',
      userText: '我们一起完成面试准备了', aiMessageId: 'episode-ai', aiText: '你坚持下来了。',
      relatedMemoryIds: ['memory-1'], now: at });
    expect(captured?.kind).toBe('shared-achievement');
    first.close();

    const second = openAppDatabase(path);
    const repository = new SqliteEpisodicMemoryRepository(second);
    const restored = await repository.findByFingerprint(character.id, captured!.fingerprint);
    expect(restored?.sourceMessageIds).toEqual(['episode-user', 'episode-ai']);
    expect(restored?.relatedMemoryIds).toEqual(['memory-1']);
    const recalled = await new EpisodicMemoryService({ repository,
      idGenerator: { next: randomUUID } }).recall({ characterId: character.id,
      queryMessageId: 'episode-query', query: '还记得我们完成面试准备吗',
      now: new Date('2026-09-12T01:00:00Z') });
    expect(recalled[0]?.id).toBe('episode-1');
    expect((second.sqlite.prepare('SELECT COUNT(*) AS count FROM episode_recalls').get() as
      { count: number }).count).toBe(1);
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
    const memoryRepository = new SqliteMemoryRepository(database);
    const service = new MemoryService({ repository: memoryRepository,
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
    expect(await memoryRepository.getPrimarySource(character.id, 'memory-fts')).toMatchObject({
      messageId: 'source-message', conversationId: 'conversation-memory', excerpt: '我喜欢手冲咖啡',
    });
    expect(await memoryRepository.getPrimarySource('another-character', 'memory-fts')).toBeNull();
    expect(await memoryRepository.correct('another-character', 'memory-fts', '错误修改', 1, new Date())).toBe(false);
    expect(await memoryRepository.correct(character.id, 'memory-fts', '我更喜欢拿铁', 0.7, new Date())).toBe(true);
    expect(database.sqlite.prepare('SELECT content FROM memories WHERE id = ?').get('memory-fts'))
      .toEqual({ content: '我更喜欢拿铁' });
    expect(await memoryRepository.softDelete('another-character', 'memory-fts')).toBe(false);
    expect(await memoryRepository.softDelete(character.id, 'memory-fts')).toBe(true);
    expect((await memoryRepository.listForCenter(character.id))[0]?.state).toBe('expired');
    expect(await memoryRepository.listActive(character.id)).toHaveLength(0);
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
    expect((await cognitionRepository.listEvidence(character.id))[0]).toMatchObject({
      trait: 'initiative', sourceMessageId: 'cognition-message', reason: 'test evidence',
    });
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

  it('persists pending future intentions and updates their status', async () => {
    const path = join(tmpdir(), `ailover-intentions-${randomUUID()}.sqlite`);
    const database = openAppDatabase(path);
    database.sqlite.prepare(`INSERT INTO characters(id, user_id, name, gender, age_setting, identity, background, appearance,
      speaking_style, personality_template_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('character-1', 'local-user', '艾琳', '女', '成年', 'AI', '', '', '温柔', 'gentle', 'active', new Date().toISOString(), new Date().toISOString());
    const repository = new SqliteFutureIntentionRepository(database);
    const intention: FutureIntention = { id: 'intention-1', description: '下次关心面试结果',
      triggerType: 'return', triggerData: { keywords: ['面试'] }, priority: 0.8,
      sourceMemoryIds: ['memory-1'], status: 'pending', createdAt: new Date('2026-09-12'), expiresAt: new Date('2026-09-20') };
    await repository.save('character-1', intention);
    expect(await repository.hasForSourceMemory('memory-1')).toBe(true);
    expect((await repository.listPending('character-1', new Date('2026-09-13')))[0]?.description)
      .toBe('下次关心面试结果');
    await repository.updateStatus('intention-1', 'triggered');
    expect(await repository.listPending('character-1', new Date('2026-09-13'))).toHaveLength(0);
    const expired = { ...intention, id: 'intention-expired', sourceMemoryIds: ['memory-2'],
      expiresAt: new Date('2026-09-13'), status: 'pending' as const };
    await repository.save('character-1', expired);
    await repository.expireBefore('character-1', new Date('2026-09-14'));
    expect(database.sqlite.prepare('SELECT status FROM future_intentions WHERE id = ?').get('intention-expired'))
      .toEqual({ status: 'expired' });
    database.close();
  });

  it('persists and restores consolidated memories', async () => {
    const path = join(tmpdir(), `ailover-consolidated-${randomUUID()}.sqlite`);
    paths.push(path);
    const database = openAppDatabase(path);
    database.sqlite.prepare(`INSERT INTO characters(id, user_id, name, gender, age_setting, identity, background, appearance,
      speaking_style, personality_template_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('character-consolidated', 'local-user', '艾琳', '女', '成年', 'AI', '', '', '温柔', 'gentle', 'active', new Date().toISOString(), new Date().toISOString());
    const repository = new SqliteConsolidatedMemoryRepository(database);
    const insight: ConsolidatedMemory = { id: 'insight-1', type: 'behavior_pattern',
      statement: '用户倾向于一起准备重要事项。', confidence: 0.8, importance: 0.75,
      sourceEpisodeIds: [], createdAt: new Date('2026-09-12'), reinforcementCount: 2, status: 'active' };
    await repository.saveOrReinforce('character-consolidated', insight);
    expect((await repository.listActive('character-consolidated'))[0]).toMatchObject({
      id: 'insight-1', statement: insight.statement, reinforcementCount: 2,
    });
    database.close();
  });

  it('versions new self model entries and ignores exact duplicates', async () => {
    const path = join(tmpdir(), `ailover-self-model-${randomUUID()}.sqlite`);
    paths.push(path);
    const database = openAppDatabase(path);
    database.sqlite.prepare(`INSERT INTO characters(id, user_id, name, gender, age_setting, identity, background, appearance,
      speaking_style, personality_template_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('character-self', 'local-user', '艾琳', '女', '成年', 'AI', '', '', '温柔', 'gentle', 'active', new Date().toISOString(), new Date().toISOString());
    const repository = new SqliteSelfModelRepository(database);
    const entry: Omit<SelfModelEntry, 'version'> = { id: 'self-1', characterId: 'character-self',
      category: 'value', statement: '陪伴和情绪安全对我很重要。', confidence: 0.85,
      sourceMessageId: null, reason: 'personality projection', status: 'active', createdAt: new Date('2026-09-12') };
    expect((await repository.saveIfNew(entry))?.version).toBe(1);
    expect(await repository.saveIfNew({ ...entry, id: 'self-duplicate' })).toBeNull();
    expect((await repository.saveIfNew({ ...entry, id: 'self-2', category: 'belief', statement: '发生冲突时先修复信任。' }))?.version).toBe(2);
    expect((await repository.listActive('character-self')).map(({ version }) => version)).toEqual([2, 1]);
    database.close();
  });
});
