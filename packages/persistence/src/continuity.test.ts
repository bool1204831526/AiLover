import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CognitionService } from '@ailover/cognition';
import { createCharacter } from '@ailover/domain';
import { MemoryService } from '@ailover/memory';

import { openAppDatabase, SqliteCharacterRepository, SqliteCognitionRepository,
  SqliteConversationRepository, SqliteMemoryRepository } from './index';

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) {
    for (const suffix of ['', '-shm', '-wal']) if (existsSync(path + suffix)) rmSync(path + suffix);
  }
});

describe('long-term continuity', () => {
  it('bounds a ten-thousand-message session and loads its recent window promptly', async () => {
    const path = join(tmpdir(), `ailover-long-session-${randomUUID()}.sqlite`);
    paths.push(path);
    const database = openAppDatabase(path);
    const character = createCharacter({ name: '艾琳', gender: '女', ageSetting: '成年',
      identity: 'AI 伴侣', background: '', appearance: '银白色长发', speakingStyle: '温柔',
      personalityTemplateId: 'gentle' }, { idGenerator: { next: () => 'long-character' },
      clock: { now: () => new Date('2026-09-01T00:00:00Z') } });
    await new SqliteCharacterRepository(database).save(character);
    const repository = new SqliteConversationRepository(database);
    await repository.create({ id: 'long-conversation', characterId: character.id, title: '长期对话',
      startedAt: new Date('2026-09-01T00:00:00Z'), lastMessageAt: new Date('2026-09-01T00:00:00Z') });
    const insert = database.sqlite.prepare(`INSERT INTO messages(id, conversation_id, role, content,
      status, model, created_at) VALUES (?, 'long-conversation', 'user', ?, 'completed', NULL, ?)`);
    database.sqlite.transaction(() => {
      for (let index = 0; index < 10_000; index += 1) {
        insert.run(`message-${index.toString().padStart(5, '0')}`, `消息 ${index}`,
          new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString());
      }
    })();
    const startedAt = performance.now();
    const restored = await repository.listMessages('long-conversation');
    const durationMs = performance.now() - startedAt;
    expect(restored).toHaveLength(500);
    expect(restored[0]?.content).toBe('消息 9500');
    expect(restored.at(-1)?.content).toBe('消息 9999');
    expect(durationMs).toBeLessThan(1_000);
    database.close();
  });

  it('restores conversation, evidence-backed memory and cognition after a cross-day restart', async () => {
    const path = join(tmpdir(), `ailover-continuity-${randomUUID()}.sqlite`);
    paths.push(path);
    const character = createCharacter({ name: '艾琳', gender: '女', ageSetting: '成年',
      identity: 'AI 伴侣', background: '喜欢读书', appearance: '银白色长发',
      speakingStyle: '温柔', personalityTemplateId: 'gentle' },
    { idGenerator: { next: () => 'continuity-character' },
      clock: { now: () => new Date('2026-09-10T08:00:00Z') } });
    const first = openAppDatabase(path);
    await new SqliteCharacterRepository(first).save(character);
    const conversations = new SqliteConversationRepository(first);
    const sourceAt = new Date('2026-09-10T08:00:00Z');
    await conversations.create({ id: 'continuity-conversation', characterId: character.id,
      title: '长期连续性', startedAt: sourceAt, lastMessageAt: sourceAt });
    await conversations.saveMessage({ id: 'continuity-source', conversationId: 'continuity-conversation',
      role: 'user', content: '我喜欢手冲咖啡，也很喜欢你', status: 'completed', model: null,
      createdAt: sourceAt });
    await conversations.saveMessage({ id: 'continuity-query', conversationId: 'continuity-conversation',
      role: 'user', content: '还记得手冲咖啡吗', status: 'completed', model: null,
      createdAt: new Date('2026-09-11T08:00:00Z') });
    await conversations.saveMessage({ id: 'interrupted-response', conversationId: 'continuity-conversation',
      role: 'assistant', content: '未完成', status: 'streaming', model: 'model-a',
      createdAt: new Date('2026-09-11T08:00:01Z') });
    await new MemoryService({ repository: new SqliteMemoryRepository(first),
      idGenerator: { next: () => 'continuity-memory' } }).capture({ userId: 'local-user',
      characterId: character.id, messageId: 'continuity-source', text: '我喜欢手冲咖啡，也很喜欢你',
      now: sourceAt });
    let cognitionId = 0;
    await new CognitionService(new SqliteCognitionRepository(first),
      { next: () => `continuity-state-${++cognitionId}` }).processInteraction({ characterId: character.id,
      baseline: character.personalityBaseline, sourceMessageId: 'continuity-source',
      text: '我喜欢手冲咖啡，也很喜欢你', now: sourceAt });
    first.close();

    const second = openAppDatabase(path);
    const restoredMessages = await new SqliteConversationRepository(second)
      .listMessages('continuity-conversation');
    expect(restoredMessages.find(({ id }) => id === 'interrupted-response')?.status).toBe('failed');
    const recalled = await new MemoryService({ repository: new SqliteMemoryRepository(second),
      idGenerator: { next: randomUUID } }).recall({ characterId: character.id,
      queryMessageId: 'continuity-query', query: '手冲咖啡', now: new Date('2026-09-11T08:00:00Z') });
    expect(recalled[0]?.id).toBe('continuity-memory');
    const cognition = await new SqliteCognitionRepository(second).getCurrent(character.id);
    expect(cognition?.relationship.affection).toBeGreaterThan(0.3);
    second.close();
  });

  it('uses indexes for message ordering and active memory ranking', () => {
    const path = join(tmpdir(), `ailover-query-plan-${randomUUID()}.sqlite`);
    paths.push(path);
    const database = openAppDatabase(path);
    const messagePlan = database.sqlite.prepare(`EXPLAIN QUERY PLAN SELECT * FROM (
      SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 500
    ) ORDER BY created_at, id`).all('conversation') as { detail: string }[];
    const memoryPlan = database.sqlite.prepare(`EXPLAIN QUERY PLAN SELECT * FROM memories
      WHERE character_id = ? AND state = 'active' ORDER BY type, importance DESC, last_seen_at DESC`)
      .all('character') as { detail: string }[];
    expect(messagePlan.some(({ detail }) => detail.includes('messages_conversation_order'))).toBe(true);
    expect(memoryPlan.some(({ detail }) => detail.includes('memories_rank'))).toBe(true);
    database.close();
  });
});
