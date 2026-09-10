export type MemoryType = 'semantic' | 'preference' | 'plan' | 'episodic' | 'relationship';

export type MemoryCandidate = {
  type: MemoryType;
  subject: string;
  content: string;
  normalizedKey: string;
  confidence: number;
  importance: number;
  emotionalWeight: number;
  polarity: 'positive' | 'negative' | 'neutral';
  expiresAt: Date | null;
  evidence: string;
};

export type StoredMemory = MemoryCandidate & {
  id: string;
  userId: string;
  characterId: string;
  recallStrength: number;
  reinforcementCount: number;
  state: 'active' | 'superseded' | 'expired';
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastRecalledAt: Date | null;
};

export type RecalledMemory = StoredMemory & { score: number };

export interface EmbeddingStore {
  upsert(memoryId: string, vector: number[], provider: string, model: string): Promise<void>;
  search(characterId: string, vector: number[], limit: number): Promise<{ memoryId: string; score: number }[]>;
}

export interface MemoryRepository {
  findByKey(characterId: string, normalizedKey: string): Promise<StoredMemory[]>;
  save(memory: StoredMemory, sourceMessageId: string): Promise<void>;
  reinforce(id: string, sourceMessageId: string, evidence: string, at: Date): Promise<void>;
  link(fromId: string, toId: string, relation: 'contradicts' | 'supersedes'): Promise<void>;
  searchCandidates(characterId: string, query: string, types: MemoryType[], now: Date): Promise<StoredMemory[]>;
  recordRecall(memoryId: string, queryMessageId: string, score: number, at: Date): Promise<void>;
  listActive(characterId: string): Promise<StoredMemory[]>;
  updateStrength(id: string, strength: number, state: StoredMemory['state']): Promise<void>;
}

export type MemoryServiceOptions = {
  idGenerator: { next(): string };
  repository: MemoryRepository;
};

export class MemoryService {
  public constructor(private readonly options: MemoryServiceOptions) {}

  public async capture(input: {
    userId: string; characterId: string; messageId: string; text: string; now: Date;
  }): Promise<MemoryCandidate[]> {
    const candidates = extractMemoryCandidates(input.text, input.now);
    for (const candidate of candidates) {
      const related = await this.options.repository.findByKey(input.characterId, candidate.normalizedKey);
      const duplicate = related.find((memory) => memory.polarity === candidate.polarity);
      if (duplicate) {
        await this.options.repository.reinforce(duplicate.id, input.messageId, candidate.evidence, input.now);
        continue;
      }
      const memory: StoredMemory = { ...candidate, id: this.options.idGenerator.next(),
        userId: input.userId, characterId: input.characterId, recallStrength: 1,
        reinforcementCount: 1, state: 'active', firstSeenAt: input.now,
        lastSeenAt: input.now, lastRecalledAt: null };
      await this.options.repository.save(memory, input.messageId);
      for (const previous of related.filter(({ polarity }) => polarity !== candidate.polarity)) {
        await this.options.repository.link(memory.id, previous.id, 'contradicts');
        await this.options.repository.updateStrength(previous.id, previous.recallStrength, 'superseded');
      }
    }
    return candidates;
  }

  public async recall(input: {
    characterId: string; queryMessageId: string; query: string; now: Date; limit?: number;
  }): Promise<RecalledMemory[]> {
    const types = inferMemoryTypes(input.query);
    const candidates = await this.options.repository.searchCandidates(
      input.characterId, input.query, types, input.now,
    );
    const currentCandidates = candidates.filter((memory) => {
      const conflicting = candidates.filter((other) => other.normalizedKey === memory.normalizedKey &&
        other.polarity !== memory.polarity);
      return !conflicting.some((other) => other.lastSeenAt > memory.lastSeenAt);
    });
    const ranked = currentCandidates.map((memory) => ({ ...memory,
      score: scoreMemory(memory, input.query, types, input.now) }))
      .filter(({ score }) => score >= 0.22).sort((a, b) => b.score - a.score)
      .slice(0, input.limit ?? 6);
    await Promise.all(ranked.map((memory) => this.options.repository.recordRecall(
      memory.id, input.queryMessageId, memory.score, input.now,
    )));
    return ranked;
  }

  public async decay(characterId: string, now: Date): Promise<void> {
    for (const memory of await this.options.repository.listActive(characterId)) {
      const strength = decayedStrength(memory, now);
      const expired = memory.expiresAt !== null && memory.expiresAt <= now;
      await this.options.repository.updateStrength(memory.id, strength, expired ? 'expired' : 'active');
    }
  }
}

export function extractMemoryCandidates(text: string, now: Date): MemoryCandidate[] {
  const sentences = text.split(/[。！？!?\n]+/).map((part) => part.trim()).filter(Boolean);
  const results: MemoryCandidate[] = [];
  for (const sentence of sentences) {
    if (/^(如果|假如|也许|可能|听说)/.test(sentence) || /吗$/.test(sentence)) continue;
    const preference = sentence.match(/^我(?:一直|真的|很|最|也)?(喜欢|爱喝|爱吃|讨厌|不喜欢)([^，,。！？!?]{1,40})/);
    if (preference) {
      const subject = preference[2]?.trim();
      if (subject) results.push(candidate('preference', subject, sentence,
        preference[1] === '讨厌' || preference[1] === '不喜欢' ? 'negative' : 'positive', now));
      continue;
    }
    if (/^我(?:打算|计划|准备|明天要|后天要|下周要|今晚要|周末要)/.test(sentence)) {
      results.push(candidate('plan', '用户近期计划', sentence, 'neutral', now));
      continue;
    }
    if (sentence.includes('我们') && /(第一次|纪念日|约定|答应|一起)/.test(sentence)) {
      results.push(candidate('relationship', '共同经历与约定', sentence, 'positive', now));
      continue;
    }
    const identity = sentence.match(/^我叫([^，,。！？!?]{1,30})/);
    if (identity?.[1]) results.push(candidate('semantic', '用户姓名', sentence, 'neutral', now));
  }
  return deduplicate(results);
}

export function inferMemoryTypes(query: string): MemoryType[] {
  const types: MemoryType[] = [];
  if (/(喜欢|讨厌|偏好|爱吃|爱喝)/.test(query)) types.push('preference');
  if (/(计划|打算|准备|明天|下周|之后要)/.test(query)) types.push('plan');
  if (/(我们|记得|一起|第一次|纪念日|约定)/.test(query)) types.push('relationship', 'episodic');
  if (/(我叫|名字|关于我|知道我)/.test(query)) types.push('semantic');
  return [...new Set(types)];
}

export function scoreMemory(
  memory: StoredMemory,
  query: string,
  hintedTypes: MemoryType[],
  now: Date,
): number {
  const lexical = lexicalSimilarity(query, `${memory.subject}${memory.content}`);
  const typeMatch = hintedTypes.includes(memory.type) ? 1 : 0;
  const ageDays = Math.max(0, (now.getTime() - memory.lastSeenAt.getTime()) / 86_400_000);
  const recency = Math.exp(-ageDays / 45);
  const frequency = Math.min(1, Math.log2(memory.reinforcementCount + 1) / 3);
  return 0.27 * lexical + 0.2 * typeMatch + 0.16 * memory.importance +
    0.12 * memory.confidence + 0.1 * recency + 0.07 * frequency +
    0.04 * memory.emotionalWeight + 0.04 * memory.recallStrength;
}

export function decayedStrength(memory: StoredMemory, now: Date): number {
  const halfLife = { preference: 180, semantic: 365, plan: 14,
    episodic: 90, relationship: 365 }[memory.type];
  const ageDays = Math.max(0, (now.getTime() - memory.lastSeenAt.getTime()) / 86_400_000);
  const floor = memory.type === 'relationship' ? 0.35 : 0.05;
  return Math.max(floor, memory.recallStrength * 2 ** (-ageDays / halfLife));
}

function candidate(
  type: MemoryType,
  subject: string,
  content: string,
  polarity: MemoryCandidate['polarity'],
  now: Date,
): MemoryCandidate {
  const importance = type === 'relationship' ? 0.9 : type === 'plan' ? 0.65 : 0.72;
  return { type, subject, content, normalizedKey: `${type}:${normalize(subject)}`,
    confidence: 0.92, importance, emotionalWeight: type === 'relationship' ? 0.75 : 0.3,
    polarity, expiresAt: type === 'plan' ? new Date(now.getTime() + 14 * 86_400_000) : null,
    evidence: content };
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[\s，,。！？!?、]/g, '');
}

function lexicalSimilarity(query: string, content: string): number {
  const queryTerms = terms(normalize(query));
  const contentTerms = new Set(terms(normalize(content)));
  if (!queryTerms.length) return 0;
  return queryTerms.filter((term) => contentTerms.has(term)).length / queryTerms.length;
}

function terms(value: string): string[] {
  if (value.length <= 2) return value ? [value] : [];
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
}

function deduplicate(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = `${item.normalizedKey}:${item.polarity}:${normalize(item.content)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
