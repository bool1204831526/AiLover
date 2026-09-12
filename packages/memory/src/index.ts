import { z } from 'zod';

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

export type MemoryCenterEntry = Pick<StoredMemory, 'id' | 'type' | 'subject' | 'content' |
  'confidence' | 'importance' | 'state' | 'firstSeenAt' | 'lastSeenAt' | 'expiresAt' | 'evidence'> & {
    source?: { messageId: string; conversationId: string; excerpt: string; createdAt: Date } | null;
  };

export function buildMemoryCenterEntries(memories: StoredMemory[], limit = 100): MemoryCenterEntry[] {
  return memories.filter((memory) => memory.state !== 'superseded')
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    .slice(0, Math.max(0, limit))
    .map(({ id, type, subject, content, confidence, importance, state, firstSeenAt,
      lastSeenAt, expiresAt, evidence }) => ({ id, type, subject, content, confidence,
      importance, state, firstSeenAt, lastSeenAt, expiresAt, evidence }));
}

export function correctMemory(
  memory: StoredMemory,
  patch: { content?: string; subject?: string; type?: MemoryType; importance?: number; evidence?: string },
  at: Date,
): StoredMemory {
  const content = patch.content?.trim() || memory.content;
  return { ...memory, content, subject: patch.subject?.trim() || memory.subject,
    type: patch.type ?? memory.type,
    importance: Math.max(0, Math.min(1, patch.importance ?? memory.importance)),
    evidence: patch.evidence?.trim() || memory.evidence, lastSeenAt: at };
}

export function markMemoryDeleted(memory: StoredMemory): StoredMemory {
  return { ...memory, state: 'expired', recallStrength: 0 };
}

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
    const implicitPreference = sentence.match(/^(?:最近|现在|这段时间)(?:越来越|总是|经常)?(?:离不开|会喝|会吃|想喝|想吃)([^，,。！？!?]{1,30})/);
    if (implicitPreference?.[1]) {
      const subject = implicitPreference[1].trim().replace(/了$/, '');
      results.push({ ...candidate('preference', subject, sentence, 'positive', now),
        confidence: 0.72, importance: 0.58, evidence: `隐含表达：${sentence}` });
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

const StructuredMemoryProposalSchema = z.object({
  type: z.enum(['semantic', 'preference', 'plan', 'relationship']),
  subject: z.string().trim().min(1).max(80),
  polarity: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1), importance: z.number().min(0).max(1),
  emotionalWeight: z.number().min(0).max(1), evidenceQuote: z.string().trim().min(1).max(500),
  expiresAt: z.iso.datetime().nullable().optional(),
});
const StructuredMemoryProposalsSchema = z.array(StructuredMemoryProposalSchema).max(6);

export function validateStructuredMemoryProposals(
  proposals: unknown,
  sourceText: string,
  now: Date,
): MemoryCandidate[] {
  const parsed = StructuredMemoryProposalsSchema.safeParse(proposals);
  if (!parsed.success) return [];
  return deduplicate(parsed.data.flatMap((proposal) => {
    const evidence = proposal.evidenceQuote.trim();
    if (!sourceText.includes(evidence) || proposal.confidence < 0.7) return [];
    if (/(如果|假如|也许|可能|大概|或许|说不定|听说)/.test(evidence) || /[吗？?]$/.test(evidence)) return [];
    let expiresAt: Date | null = null;
    if (proposal.type === 'plan') {
      const proposedExpiry = proposal.expiresAt ? new Date(proposal.expiresAt) : null;
      const maximum = new Date(now.getTime() + 366 * 86_400_000);
      expiresAt = proposedExpiry && proposedExpiry > now && proposedExpiry <= maximum
        ? proposedExpiry : new Date(now.getTime() + 14 * 86_400_000);
    }
    return [{ type: proposal.type, subject: proposal.subject, content: evidence,
      normalizedKey: `${proposal.type}:${normalize(proposal.subject)}`,
      confidence: Math.min(0.9, proposal.confidence), importance: proposal.importance,
      emotionalWeight: proposal.emotionalWeight, polarity: proposal.polarity,
      expiresAt, evidence: `结构化提取：${evidence}` }];
  }));
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

export const EPISODE_IMPORTANCE_THRESHOLD = 0.65;

export type EpisodeKind =
  | 'first' | 'shared-achievement' | 'strong-emotion' | 'conflict'
  | 'repair' | 'disclosure' | 'relationship';

export type EpisodeSource = { messageId: string; role: 'user' | 'assistant' };

export type EpisodeCandidate = {
  kind: EpisodeKind;
  fingerprint: string;
  title: string;
  summary: string;
  context: string | null;
  participants: string[];
  userAction: string;
  aiAction: string | null;
  userEmotion: string | null;
  aiEmotion: string | null;
  relationshipRelevance: number;
  emotionalWeight: number;
  importance: number;
  confidence: number;
  tags: string[];
};

export type StoredEpisode = EpisodeCandidate & {
  id: string;
  characterId: string;
  conversationId: string;
  eventTime: Date;
  createdAt: Date;
  reinforcementCount: number;
  status: 'active' | 'faded' | 'superseded' | 'archived';
  sourceMessageIds: string[];
  relatedMemoryIds: string[];
  lastRecalledAt: Date | null;
};

export type RecalledEpisode = StoredEpisode & { score: number };

export interface EpisodicMemoryRepository {
  findByFingerprint(characterId: string, fingerprint: string): Promise<StoredEpisode | null>;
  save(episode: StoredEpisode, sources: EpisodeSource[]): Promise<void>;
  reinforce(id: string, sources: EpisodeSource[], relatedMemoryIds: string[]): Promise<void>;
  searchCandidates(
    characterId: string,
    query: string,
    includeRecent: boolean,
    limit: number,
  ): Promise<StoredEpisode[]>;
  recordRecall(episodeId: string, queryMessageId: string, score: number, at: Date): Promise<void>;
}

export class EpisodicMemoryService {
  public constructor(private readonly options: {
    repository: EpisodicMemoryRepository;
    idGenerator: { next(): string };
  }) {}

  public async capture(input: {
    characterId: string;
    characterName: string;
    conversationId: string;
    userMessageId: string;
    userText: string;
    aiMessageId?: string;
    aiText?: string;
    aiEmotion?: string;
    relatedMemoryIds?: string[];
    isFirstConversationTurn?: boolean;
    now: Date;
  }): Promise<StoredEpisode | null> {
    const candidate = extractEpisodeCandidate(input);
    if (!candidate || candidate.importance < EPISODE_IMPORTANCE_THRESHOLD) return null;
    const sources: EpisodeSource[] = [{ messageId: input.userMessageId, role: 'user' }];
    if (input.aiMessageId && input.aiText?.trim()) {
      sources.push({ messageId: input.aiMessageId, role: 'assistant' });
    }
    const existing = await this.options.repository.findByFingerprint(input.characterId, candidate.fingerprint);
    if (existing) {
      await this.options.repository.reinforce(existing.id, sources, input.relatedMemoryIds ?? []);
      return existing;
    }
    const episode: StoredEpisode = { ...candidate, id: this.options.idGenerator.next(),
      characterId: input.characterId, conversationId: input.conversationId,
      eventTime: input.now, createdAt: input.now, reinforcementCount: 1,
      status: 'active', sourceMessageIds: sources.map(({ messageId }) => messageId),
      relatedMemoryIds: [...new Set(input.relatedMemoryIds ?? [])], lastRecalledAt: null };
    await this.options.repository.save(episode, sources);
    return episode;
  }

  public async recall(input: {
    characterId: string;
    queryMessageId: string;
    query: string;
    now: Date;
    limit?: number;
  }): Promise<RecalledEpisode[]> {
    const memoryCue = /(记得|以前|之前|那次|第一次|一起|经历|发生过)/.test(input.query);
    const candidates = await this.options.repository.searchCandidates(
      input.characterId, input.query, memoryCue, 40,
    );
    const ranked = candidates.map((episode) => ({ ...episode,
      score: scoreEpisode(episode, input.query, input.now, memoryCue) }))
      .filter(({ score }) => score >= 0.25)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.min(input.limit ?? 3, 3));
    await Promise.all(ranked.map((episode) => this.options.repository.recordRecall(
      episode.id, input.queryMessageId, episode.score, input.now,
    )));
    return ranked;
  }
}

export function extractEpisodeCandidate(input: {
  characterId: string;
  characterName: string;
  userText: string;
  aiText?: string;
  aiEmotion?: string;
  isFirstConversationTurn?: boolean;
}): EpisodeCandidate | null {
  const text = input.userText.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  let kind: EpisodeKind | null = null;
  let title = '';
  let importance = 0;
  let emotionalWeight = 0;
  let relationshipRelevance = 0;

  if (input.isFirstConversationTurn) {
    kind = 'first'; title = '第一次对话'; importance = 0.82;
    emotionalWeight = 0.65; relationshipRelevance = 0.9;
  } else if (/(第一次|初次)/.test(text)) {
    kind = 'first'; title = '一件第一次发生的事'; importance = 0.88;
    emotionalWeight = 0.72; relationshipRelevance = 0.82;
  } else if (/(对不起|原谅|和好|不生气了|没关系)/.test(text)) {
    kind = 'repair'; title = '一次关系修复'; importance = 0.8;
    emotionalWeight = 0.82; relationshipRelevance = 0.92;
  } else if (/(讨厌你|闭嘴|滚|骗我|很失望|生气)/.test(text)) {
    kind = 'conflict'; title = '一次明显的分歧'; importance = 0.82;
    emotionalWeight = 0.88; relationshipRelevance = 0.9;
  } else if (/(我们|一起|之前).{0,24}(完成|解决|做完|成功|准备|决定)|(?:完成|解决|做完|成功).{0,16}(我们|一起)/.test(text)) {
    kind = 'shared-achievement'; title = '共同完成的一件事'; importance = 0.84;
    emotionalWeight = 0.68; relationshipRelevance = 0.88;
  } else if (/(告诉你一个秘密|只告诉你|我有点害怕|我很难过|我压力很大)/.test(text)) {
    kind = 'disclosure'; title = '一次重要的倾诉'; importance = 0.76;
    emotionalWeight = 0.8; relationshipRelevance = 0.78;
  } else if (/(非常开心|太开心|特别开心|崩溃|非常难过|特别难过|受到挫折|压力特别大)/.test(text)) {
    kind = 'strong-emotion'; title = '一次强烈的情绪经历'; importance = 0.72;
    emotionalWeight = 0.9; relationshipRelevance = 0.55;
  } else if (/(爱你|很喜欢你|依赖你|需要你|谢谢你陪我)/.test(text)) {
    kind = 'relationship'; title = '一次重要的情感表达'; importance = 0.7;
    emotionalWeight = 0.78; relationshipRelevance = 0.9;
  }
  if (!kind) return null;

  const aiAction = input.aiText?.trim().replace(/\s+/g, ' ').slice(0, 240) || null;
  const userAction = text.slice(0, 240);
  const userEmotion = episodeEmotion(text);
  const summary = aiAction
    ? `用户表达了“${userAction}”；${input.characterName}回应了“${aiAction}”。`
    : `用户表达了“${userAction}”。`;
  const fingerprint = kind === 'first' && input.isFirstConversationTurn
    ? 'first:first-conversation'
    : `${kind}:${normalize(userAction).slice(0, 96)}`;
  return { kind, fingerprint, title, summary, context: null,
    participants: ['local-user', input.characterId], userAction, aiAction,
    userEmotion, aiEmotion: input.aiEmotion ?? null, relationshipRelevance,
    emotionalWeight, importance, confidence: 0.9, tags: [kind] };
}

export function scoreEpisode(
  episode: StoredEpisode,
  query: string,
  now: Date,
  memoryCue = false,
): number {
  const lexical = lexicalSimilarity(query, `${episode.title}${episode.summary}${episode.tags.join('')}`);
  const ageDays = Math.max(0, (now.getTime() - episode.eventTime.getTime()) / 86_400_000);
  const recency = Math.exp(-ageDays / 120);
  const reinforcement = Math.min(1, Math.log2(episode.reinforcementCount + 1) / 3);
  return 0.34 * lexical + 0.18 * episode.importance + 0.14 * episode.emotionalWeight +
    0.13 * episode.relationshipRelevance + 0.08 * episode.confidence + 0.07 * recency +
    0.04 * reinforcement + (memoryCue ? 0.02 : 0);
}

export type ConsolidatedMemoryType =
  | 'semantic_insight' | 'relationship_insight' | 'self_insight' | 'behavior_pattern';

export type ConsolidatedMemory = {
  id: string;
  type: ConsolidatedMemoryType;
  statement: string;
  confidence: number;
  importance: number;
  sourceEpisodeIds: string[];
  createdAt: Date;
  reinforcementCount: number;
  status: 'active' | 'faded' | 'superseded';
};

export type FutureIntention = {
  id: string;
  description: string;
  triggerType: 'time' | 'topic' | 'return' | 'event';
  triggerData: { dueAt?: Date; keywords?: string[] };
  priority: number;
  sourceMemoryIds: string[];
  status: 'pending' | 'triggered' | 'completed' | 'expired';
  createdAt: Date;
  expiresAt: Date | null;
};

export function intentionsFromMemories(
  memories: StoredMemory[],
  idGenerator: { next(): string },
  now: Date,
): FutureIntention[] {
  return memories.filter((memory) => memory.type === 'plan' && memory.state === 'active' &&
    (!memory.expiresAt || memory.expiresAt > now)).slice(0, 3).map((memory) => ({
      id: idGenerator.next(), description: `下次合适时可以关心：${memory.content}`,
      triggerType: 'return' as const,
      triggerData: { ...(memory.expiresAt ? { dueAt: memory.expiresAt } : {}),
        keywords: terms(normalize(memory.content)).slice(0, 8) },
      priority: Math.min(0.9, 0.55 + memory.importance * 0.35 + memory.emotionalWeight * 0.1),
      sourceMemoryIds: [memory.id], status: 'pending' as const,
      createdAt: now, expiresAt: memory.expiresAt,
    }));
}

export function advanceFutureIntentions(
  intentions: FutureIntention[],
  now: Date,
  context?: { returned: boolean; text?: string },
): FutureIntention[] {
  const query = normalize(context?.text ?? '');
  return intentions.map((intention) => {
    if (intention.status !== 'pending') return intention;
    if (intention.expiresAt && intention.expiresAt <= now) return { ...intention, status: 'expired' };
    const keywordHit = intention.triggerData.keywords?.some((keyword) => query.includes(normalize(keyword)));
    if (context?.returned && (intention.triggerType === 'return' || keywordHit)) {
      return { ...intention, status: 'triggered' };
    }
    return intention;
  });
}

export type RelationshipMilestone = {
  episodeId: string;
  occurredAt: Date;
  title: string;
  kind: EpisodeKind;
  importance: number;
};

export function buildRelationshipTimeline(
  episodes: StoredEpisode[],
  limit = 12,
): RelationshipMilestone[] {
  return episodes.filter((episode) => episode.status === 'active' && episode.relationshipRelevance >= 0.7)
    .sort((left, right) => right.eventTime.getTime() - left.eventTime.getTime())
    .filter((episode, index, all) => all.findIndex((item) => item.kind === episode.kind &&
      item.title === episode.title) === index)
    .slice(0, limit)
    .map((episode) => ({ episodeId: episode.id, occurredAt: episode.eventTime,
      title: episode.title, kind: episode.kind, importance: episode.importance }))
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
}

export function consolidateEpisodes(
  episodes: StoredEpisode[],
  idGenerator: { next(): string },
  now: Date,
): ConsolidatedMemory[] {
  const active = episodes.filter((episode) => episode.status === 'active' && episode.importance >= 0.65);
  const groups = new Map<string, StoredEpisode[]>();
  for (const episode of active) {
    const key = episode.kind === 'conflict' || episode.kind === 'repair' ? 'relationship' :
      episode.kind === 'shared-achievement' ? 'achievement' : episode.kind;
    groups.set(key, [...(groups.get(key) ?? []), episode]);
  }
  const results: ConsolidatedMemory[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    if (key === 'relationship' && new Set(group.map(({ kind }) => kind)).size > 1) continue;
    const sourceEpisodeIds = group.map(({ id }) => id);
    const type: ConsolidatedMemoryType = key === 'relationship' ? 'relationship_insight'
      : key === 'achievement' ? 'behavior_pattern' : 'semantic_insight';
    const statement = key === 'relationship'
      ? '我们经历过重要的关系变化，彼此的互动会影响信任和相处方式。'
      : key === 'achievement'
        ? '用户倾向于在重要事项上与 AiLover 一起准备、推进并完成。'
        : '用户曾多次表达或经历相近的事情，这可能构成稳定的长期模式。';
    results.push({ id: idGenerator.next(), type, statement,
      confidence: Math.min(0.92, 0.62 + group.length * 0.08),
      importance: Math.min(0.9, 0.62 + Math.max(...group.map(({ importance }) => importance)) * 0.25),
      sourceEpisodeIds, createdAt: now, reinforcementCount: group.length, status: 'active' });
  }
  return results;
}

function episodeEmotion(text: string): string | null {
  if (/(开心|高兴|成功|完成)/.test(text)) return '积极';
  if (/(难过|失望|崩溃|挫折)/.test(text)) return '低落';
  if (/(生气|讨厌|滚|闭嘴)/.test(text)) return '愤怒';
  if (/(害怕|压力|焦虑)/.test(text)) return '不安';
  return null;
}
