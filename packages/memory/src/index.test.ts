import { describe, expect, it } from 'vitest';

import {
  decayedStrength, EpisodicMemoryService, extractEpisodeCandidate, extractMemoryCandidates,
  MemoryService, type EpisodeSource, type EpisodicMemoryRepository, type MemoryRepository,
  type MemoryType, type StoredEpisode, type StoredMemory,
} from './index';

class InMemoryRepository implements MemoryRepository {
  public memories: StoredMemory[] = [];
  public links: { from: string; to: string; relation: string }[] = [];
  public recalls: { id: string; queryMessageId: string; score: number }[] = [];

  async findByKey(characterId: string, normalizedKey: string) {
    return this.memories.filter((item) => item.characterId === characterId &&
      item.normalizedKey === normalizedKey && item.state === 'active');
  }
  async save(memory: StoredMemory) { this.memories.push(memory); }
  async reinforce(id: string, _source: string, _evidence: string, at: Date) {
    const memory = this.memories.find((item) => item.id === id);
    if (memory) { memory.reinforcementCount += 1; memory.lastSeenAt = at; }
  }
  async link(from: string, to: string, relation: 'contradicts' | 'supersedes') {
    this.links.push({ from, to, relation });
  }
  async searchCandidates(_characterId: string, _query: string, _types: MemoryType[], now: Date) {
    return this.memories.filter((item) => item.state === 'active' &&
      (item.expiresAt === null || item.expiresAt > now));
  }
  async recordRecall(id: string, queryMessageId: string, score: number) {
    this.recalls.push({ id, queryMessageId, score });
  }
  async listActive(characterId: string) {
    return this.memories.filter((item) => item.characterId === characterId && item.state === 'active');
  }
  async updateStrength(id: string, strength: number, state: StoredMemory['state']) {
    const memory = this.memories.find((item) => item.id === id);
    if (memory) { memory.recallStrength = strength; memory.state = state; }
  }
}

class InMemoryEpisodeRepository implements EpisodicMemoryRepository {
  public episodes: StoredEpisode[] = [];
  public recalls: string[] = [];
  async findByFingerprint(characterId: string, fingerprint: string) {
    return this.episodes.find((item) => item.characterId === characterId &&
      item.fingerprint === fingerprint) ?? null;
  }
  async save(episode: StoredEpisode) { this.episodes.push(episode); }
  async reinforce(id: string, sources: EpisodeSource[], relatedMemoryIds: string[]) {
    const episode = this.episodes.find((item) => item.id === id);
    if (!episode) return;
    episode.reinforcementCount += 1;
    episode.sourceMessageIds = [...new Set([...episode.sourceMessageIds,
      ...sources.map(({ messageId }) => messageId)])];
    episode.relatedMemoryIds = [...new Set([...episode.relatedMemoryIds, ...relatedMemoryIds])];
  }
  async searchCandidates(_characterId: string, _query: string, _includeRecent: boolean, limit: number) {
    return this.episodes.slice(0, limit);
  }
  async recordRecall(id: string) { this.recalls.push(id); }
}

describe('memory candidate extraction', () => {
  const now = new Date('2026-09-11T00:00:00Z');

  it('extracts preference, plan and shared-event evidence without inventing details', () => {
    const result = extractMemoryCandidates(
      '我喜欢咖啡。明天不确定。\n我明天要去看牙。今天是我们第一次见面的纪念日！', now,
    );
    expect(result.map(({ type }) => type)).toEqual(['preference', 'plan', 'relationship']);
    expect(result[0]?.evidence).toBe('我喜欢咖啡');
    expect(result[1]?.expiresAt?.toISOString()).toBe('2026-09-25T00:00:00.000Z');
  });

  it('rejects hypothetical and question-shaped claims', () => {
    expect(extractMemoryCandidates('如果我喜欢咖啡会怎样？我喜欢咖啡吗？也许我明天要出门。', now))
      .toEqual([]);
  });
});

describe('MemoryService', () => {
  it('reinforces duplicates and links contradictory preference evidence', async () => {
    const repository = new InMemoryRepository();
    let nextId = 0;
    const service = new MemoryService({ repository, idGenerator: { next: () => `memory-${++nextId}` } });
    const base = { userId: 'local-user', characterId: 'character-1', now: new Date('2026-09-11T00:00:00Z') };
    await service.capture({ ...base, messageId: 'message-1', text: '我喜欢咖啡' });
    await service.capture({ ...base, messageId: 'message-2', text: '我喜欢咖啡' });
    await service.capture({ ...base, messageId: 'message-3', text: '我不喜欢咖啡' });
    expect(repository.memories).toHaveLength(2);
    expect(repository.memories[0]?.reinforcementCount).toBe(2);
    expect(repository.links).toEqual([{ from: 'memory-2', to: 'memory-1', relation: 'contradicts' }]);
    const recalled = await service.recall({ characterId: 'character-1', queryMessageId: 'message-4',
      query: '我喜欢咖啡吗', now: new Date('2026-09-12T00:00:00Z') });
    expect(recalled.map(({ polarity }) => polarity)).toEqual(['negative']);
  });

  it('recalls a preference across days and audits the evidence use', async () => {
    const repository = new InMemoryRepository();
    const service = new MemoryService({ repository, idGenerator: { next: () => 'memory-1' } });
    await service.capture({ userId: 'local-user', characterId: 'character-1', messageId: 'message-1',
      text: '我喜欢咖啡', now: new Date('2026-09-01T00:00:00Z') });
    const recalled = await service.recall({ characterId: 'character-1', queryMessageId: 'message-2',
      query: '你还记得我喜欢什么吗', now: new Date('2026-09-11T00:00:00Z') });
    expect(recalled[0]?.content).toBe('我喜欢咖啡');
    expect(repository.recalls[0]?.queryMessageId).toBe('message-2');
  });

  it('recalls preference, recent plan and shared event after simulated days', async () => {
    const repository = new InMemoryRepository();
    let id = 0;
    const service = new MemoryService({ repository, idGenerator: { next: () => `memory-${++id}` } });
    const firstSeen = new Date('2026-09-01T00:00:00Z');
    const common = { userId: 'local-user', characterId: 'character-1', now: firstSeen };
    await service.capture({ ...common, messageId: 'source-1', text: '我喜欢咖啡' });
    await service.capture({ ...common, messageId: 'source-2', text: '我下周要去杭州旅行' });
    await service.capture({ ...common, messageId: 'source-3', text: '今天是我们第一次见面的纪念日' });
    const later = new Date('2026-09-04T00:00:00Z');
    const cases = [
      ['我喜欢什么', '我喜欢咖啡'],
      ['我下周有什么计划', '我下周要去杭州旅行'],
      ['还记得我们的第一次见面吗', '今天是我们第一次见面的纪念日'],
    ] as const;
    for (const [query, expected] of cases) {
      const recalled = await service.recall({ characterId: 'character-1', queryMessageId: `query-${query}`,
        query, now: later });
      expect(recalled.some(({ content }) => content === expected)).toBe(true);
    }
  });

  it('expires short-term plans but preserves relationship memory strength', async () => {
    const now = new Date('2026-10-11T00:00:00Z');
    const repository = new InMemoryRepository();
    let id = 0;
    const service = new MemoryService({ repository, idGenerator: { next: () => `memory-${++id}` } });
    await service.capture({ userId: 'local-user', characterId: 'character-1', messageId: 'message-1',
      text: '我明天要去看牙。今天是我们第一次见面的纪念日', now: new Date('2026-09-11T00:00:00Z') });
    const relationship = repository.memories.find(({ type }) => type === 'relationship');
    expect(relationship && decayedStrength(relationship, now)).toBeGreaterThan(0.35);
    await service.decay('character-1', now);
    expect(repository.memories.find(({ type }) => type === 'plan')?.state).toBe('expired');
    expect(repository.memories.find(({ type }) => type === 'relationship')?.state).toBe('active');
  });
});

describe('EpisodicMemoryService', () => {
  const base = { characterId: 'character-1', characterName: '艾琳',
    conversationId: 'conversation-1', userMessageId: 'message-1', now: new Date('2026-09-11T00:00:00Z') };

  it('rejects ordinary chat and recognizes high-value shared experiences', () => {
    expect(extractEpisodeCandidate({ ...base, userText: '今天天气不错' })).toBeNull();
    const episode = extractEpisodeCandidate({ ...base,
      userText: '我们之前一起准备了很久，今天终于完成面试了', aiText: '你真的做到了。' });
    expect(episode?.kind).toBe('shared-achievement');
    expect(episode?.importance).toBeGreaterThanOrEqual(0.65);
    expect(episode?.summary).toContain('你真的做到了');
  });

  it('captures the first conversation and reinforces duplicate evidence', async () => {
    const repository = new InMemoryEpisodeRepository();
    let id = 0;
    const service = new EpisodicMemoryService({ repository,
      idGenerator: { next: () => `episode-${++id}` } });
    await service.capture({ ...base, userText: '你好', isFirstConversationTurn: true });
    await service.capture({ ...base, userMessageId: 'message-2', userText: '你好',
      isFirstConversationTurn: true });
    expect(repository.episodes).toHaveLength(1);
    expect(repository.episodes[0]?.reinforcementCount).toBe(2);
    expect(repository.episodes[0]?.sourceMessageIds).toContain('message-2');
  });

  it('recalls at most three episodes and audits their use', async () => {
    const repository = new InMemoryEpisodeRepository();
    const service = new EpisodicMemoryService({ repository,
      idGenerator: { next: () => crypto.randomUUID() } });
    for (let index = 0; index < 5; index += 1) {
      await service.capture({ ...base, userMessageId: `message-${index}`,
        userText: `这是我们第一次一起完成项目 ${index}` });
    }
    const recalled = await service.recall({ characterId: 'character-1', queryMessageId: 'query-1',
      query: '还记得我们第一次一起完成项目吗', now: new Date('2026-09-12T00:00:00Z') });
    expect(recalled).toHaveLength(3);
    expect(repository.recalls).toHaveLength(3);
  });
});
