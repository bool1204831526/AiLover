import { PERSONALITY_TRAITS, type PersonalityTrait, type PersonalityValues } from '@ailover/domain';

export const COGNITION_RULE_VERSION = 'cognition-v1';

export type EmotionState = {
  valence: number;
  arousal: number;
  security: number;
  affection: number;
};

export type RelationshipState = {
  trust: number;
  intimacy: number;
  affection: number;
  familiarity: number;
  comfort: number;
  conflict: number;
};

export type CognitionSnapshot = {
  id: string;
  characterId: string;
  emotion: EmotionState;
  relationship: RelationshipState;
  personality: PersonalityValues;
  reason: string;
  sourceMessageId: string | null;
  ruleVersion: string;
  recordedAt: Date;
};

export type EvolutionEvidence = {
  characterId: string;
  trait: PersonalityTrait;
  direction: -1 | 1;
  sourceMessageId: string;
  reason: string;
  recordedAt: Date;
};

export type ReflectionRecord = {
  id: string;
  characterId: string;
  triggerMessageId: string;
  summary: string;
  importance: number;
  ruleVersion: string;
  createdAt: Date;
};

export type ResponsePlan = {
  kind: 'respond' | 'ask_question' | 'decline' | 'do_nothing';
  tone: string[];
  guidance: string;
  personalityProjection: string[];
  proposedEmotionEffects: Partial<EmotionState>;
  proposedRelationshipEffects: Partial<RelationshipState>;
};

export interface CognitionRepository {
  getCurrent(characterId: string): Promise<CognitionSnapshot | null>;
  saveSnapshot(snapshot: CognitionSnapshot): Promise<void>;
  addEvidence(evidence: EvolutionEvidence): Promise<number>;
  saveReflection(reflection: ReflectionRecord): Promise<void>;
}

export class CognitionService {
  public constructor(
    private readonly repository: CognitionRepository,
    private readonly idGenerator: { next(): string },
  ) {}

  public async getOrCreate(
    characterId: string,
    baseline: PersonalityValues,
    now: Date,
  ): Promise<CognitionSnapshot> {
    const existing = await this.repository.getCurrent(characterId);
    if (existing) return decaySnapshot(existing, now);
    const snapshot: CognitionSnapshot = { id: this.idGenerator.next(), characterId,
      emotion: { valence: 0.55, arousal: 0.35, security: 0.65, affection: 0.55 },
      relationship: { trust: 0.38, intimacy: 0.2, affection: 0.35,
        familiarity: 0.12, comfort: 0.4, conflict: 0 },
      personality: baseline, reason: 'initial state', sourceMessageId: null,
      ruleVersion: COGNITION_RULE_VERSION, recordedAt: now };
    await this.repository.saveSnapshot(snapshot);
    return snapshot;
  }

  public async processInteraction(input: {
    characterId: string;
    baseline: PersonalityValues;
    sourceMessageId: string;
    text: string;
    now: Date;
  }): Promise<CognitionSnapshot> {
    const current = await this.getOrCreate(input.characterId, input.baseline, input.now);
    const signal = analyzeInteraction(input.text);
    let personality = current.personality;
    for (const evidence of signal.personalityEvidence) {
      const count = await this.repository.addEvidence({ characterId: input.characterId,
        trait: evidence.trait, direction: evidence.direction, sourceMessageId: input.sourceMessageId,
        reason: evidence.reason, recordedAt: input.now });
      if (count >= 3 && count % 3 === 0) {
        personality = evolvePersonality(personality, input.baseline, evidence.trait, evidence.direction);
      }
    }
    const snapshot: CognitionSnapshot = { id: this.idGenerator.next(), characterId: input.characterId,
      emotion: applyEmotion(current.emotion, signal.emotionDelta),
      relationship: applyRelationship(current.relationship, signal.relationshipDelta),
      personality, reason: signal.reasons.join('；') || 'ordinary conversation',
      sourceMessageId: input.sourceMessageId, ruleVersion: COGNITION_RULE_VERSION,
      recordedAt: input.now };
    await this.repository.saveSnapshot(snapshot);
    const importance = reflectionImportance(signal);
    if (importance >= 0.7) {
      await this.repository.saveReflection({ id: this.idGenerator.next(), characterId: input.characterId,
        triggerMessageId: input.sourceMessageId, summary: signal.reasons.join('；'), importance,
        ruleVersion: COGNITION_RULE_VERSION, createdAt: input.now });
    }
    return snapshot;
  }
}

export type InteractionSignal = {
  emotionDelta: Partial<EmotionState>;
  relationshipDelta: Partial<RelationshipState>;
  personalityEvidence: { trait: PersonalityTrait; direction: -1 | 1; reason: string }[];
  reasons: string[];
};

export function analyzeInteraction(text: string): InteractionSignal {
  const signal: InteractionSignal = { emotionDelta: {}, relationshipDelta: {},
    personalityEvidence: [], reasons: [] };
  if (/(谢谢|喜欢你|想你|爱你|很开心|真好|温柔)/.test(text)) {
    signal.emotionDelta = { valence: 0.1, affection: 0.08, security: 0.04 };
    signal.relationshipDelta = { affection: 0.025, comfort: 0.018, trust: 0.012 };
    signal.reasons.push('received positive affection');
  }
  if (/(讨厌你|闭嘴|滚|骗我|失望|生气)/.test(text)) {
    signal.emotionDelta = merge(signal.emotionDelta, { valence: -0.14, security: -0.08, arousal: 0.1 });
    signal.relationshipDelta = merge(signal.relationshipDelta,
      { conflict: 0.04, trust: -0.025, comfort: -0.025 });
    signal.reasons.push('received conflict signal');
  }
  if (/(告诉你一个秘密|只告诉你|其实我|我有点害怕|我很难过)/.test(text)) {
    signal.emotionDelta = merge(signal.emotionDelta, { affection: 0.05, arousal: 0.04 });
    signal.relationshipDelta = merge(signal.relationshipDelta,
      { trust: 0.03, intimacy: 0.025, familiarity: 0.018 });
    signal.reasons.push('user shared personal feelings');
  }
  if (/(我们|一起|上次|还记得)/.test(text)) {
    signal.relationshipDelta = merge(signal.relationshipDelta, { familiarity: 0.02, intimacy: 0.012 });
    signal.reasons.push('shared experience referenced');
  }
  if (/(带我|陪我|一起去|主动一点)/.test(text)) {
    signal.personalityEvidence.push({ trait: 'initiative', direction: 1,
      reason: 'user repeatedly welcomed initiative' });
  }
  if (/(冷静|分析一下|讲道理|理性)/.test(text)) {
    signal.personalityEvidence.push({ trait: 'rationality', direction: 1,
      reason: 'user repeatedly preferred rational guidance' });
  }
  return signal;
}

export function decaySnapshot(snapshot: CognitionSnapshot, now: Date): CognitionSnapshot {
  const hours = Math.max(0, (now.getTime() - snapshot.recordedAt.getTime()) / 3_600_000);
  const emotionFactor = 2 ** (-hours / 18);
  const toward = (value: number, neutral: number) => neutral + (value - neutral) * emotionFactor;
  return { ...snapshot, emotion: {
    valence: toward(snapshot.emotion.valence, 0.55),
    arousal: toward(snapshot.emotion.arousal, 0.3),
    security: toward(snapshot.emotion.security, 0.65),
    affection: toward(snapshot.emotion.affection, 0.55),
  }, recordedAt: now };
}

export function projectCognition(snapshot: CognitionSnapshot): string {
  const mood = snapshot.emotion.valence > 0.68 ? '心情明亮'
    : snapshot.emotion.valence < 0.4 ? '有些低落和谨慎' : '情绪平稳';
  const closeness = snapshot.relationship.intimacy > 0.65 ? '关系亲密而熟悉'
    : snapshot.relationship.familiarity > 0.35 ? '正在逐渐熟悉彼此' : '仍处在相互了解的阶段';
  const tension = snapshot.relationship.conflict > 0.35 ? '当前存在尚未完全缓和的矛盾' : '';
  return [mood, closeness, tension].filter(Boolean).join('；');
}

export function relationshipSummary(snapshot: CognitionSnapshot): {
  headline: string; description: string; mood: string; updatedAt: Date;
} {
  const relationship = snapshot.relationship;
  const headline = relationship.intimacy >= 0.7 ? '亲密而笃定'
    : relationship.familiarity >= 0.4 ? '熟悉正在加深'
      : relationship.trust >= 0.5 ? '信任正在建立' : '刚刚开始了解彼此';
  const conflict = relationship.conflict > 0.3 ? '最近的交流里还有一些紧张，需要温和地修复。'
    : '相处整体平稳，没有明显的未解冲突。';
  return { headline, description: `${headline}。${conflict}`,
    mood: projectCognition(snapshot), updatedAt: snapshot.recordedAt };
}

export function createResponsePlan(snapshot: CognitionSnapshot, signal: InteractionSignal): ResponsePlan {
  const conflict = Number(signal.relationshipDelta.conflict ?? 0) > 0;
  const disclosure = signal.reasons.includes('user shared personal feelings');
  const personalityTone = personalityTones(snapshot.personality);
  const tone = conflict ? ['克制', '不升级冲突', '尊重边界']
    : disclosure ? ['温柔', '接纳', '认真倾听']
      : snapshot.emotion.valence > 0.68 ? ['明朗', '亲近', ...personalityTone].slice(0, 3)
        : [...personalityTone, '自然', '真诚'].slice(0, 3);
  return { kind: disclosure ? 'ask_question' : 'respond', tone,
    guidance: conflict ? '先承认对方的情绪，避免反击或情感勒索，再简短询问发生了什么。'
      : disclosure ? '先回应对方的感受，再提出一个不过度追问的开放问题。'
        : '直接回应当前话题，保持角色一贯的表达方式。',
    personalityProjection: projectPersonality(snapshot, signal),
    proposedEmotionEffects: signal.emotionDelta,
    proposedRelationshipEffects: signal.relationshipDelta };
}

export function projectPersonality(
  snapshot: CognitionSnapshot,
  signal: InteractionSignal,
): string[] {
  const personality = snapshot.personality;
  const conflict = signal.reasons.includes('received conflict signal');
  const disclosure = signal.reasons.includes('user shared personal feelings');

  if (conflict) {
    const projection = [
      '当前是冲突场景，优先降低对抗强度、尊重边界，不用玩笑或高亢表达掩盖问题。',
    ];
    if (personality.warmth >= 0.7) projection.push('先表达在意并确认对方的感受，但不要情感勒索。');
    if (personality.reserve >= 0.65 || personality.maturity >= 0.7) {
      projection.push('保持沉稳和审慎，先澄清事实，再决定是否给出建议。');
    }
    if (personality.rationality >= 0.7) projection.push('可以帮助梳理原因，但不要把回应变成辩论。');
    return projection;
  }

  if (disclosure) {
    const projection = [
      '当前是脆弱情绪场景，情绪安全优先；先接住感受，不使用调侃。',
    ];
    if (personality.warmth >= 0.65) projection.push('自然表达关心，让对方感到被认真听见。');
    if (personality.rationality >= 0.7) projection.push('分析能力只用于理解处境，不要急于给方案。');
    if (personality.initiative >= 0.65) projection.push('可以主动提出一个温和的开放问题，但不要连续追问。');
    return projection;
  }

  const projection: string[] = [];
  if (personality.warmth >= 0.7) projection.push('自然表达关心，并留意用户话语中的情绪。');
  else if (personality.warmth <= 0.35) projection.push('保持友善但克制，减少过度情绪化的表达。');
  if (personality.energy >= 0.7) projection.push('语气可以更有活力，并积极回应当前话题。');
  else if (personality.energy <= 0.35) projection.push('保持平稳节奏，不主动制造过多话题。');
  if (personality.reserve >= 0.7) projection.push('表达保持审慎，避免冲动承诺或越过关系边界。');
  else if (personality.reserve <= 0.3) projection.push('可以更直接地表达真实感受，但仍尊重边界。');
  if (personality.playfulness >= 0.7) projection.push('在场景合适时可以轻松表达或适度调侃。');
  else if (personality.playfulness <= 0.35) projection.push('以认真表达为主，不必刻意加入玩笑。');
  if (personality.maturity >= 0.7) projection.push('回应时兼顾长期影响，建议保持完整和稳定。');
  if (personality.rationality >= 0.7) projection.push('分析类问题可结构化思考，同时保留情感回应。');
  else if (personality.rationality <= 0.35) projection.push('更多从感受和关系角度回应，避免生硬分析。');
  if (personality.initiative >= 0.7) {
    projection.push(snapshot.relationship.familiarity >= 0.35
      ? '可以主动延伸话题或适度提问，相关时自然联系共同经历。'
      : '可以主动延伸话题，但关系仍在建立中，避免私人化追问。');
  } else if (personality.initiative <= 0.35) {
    projection.push('更多跟随用户引导，不强行延伸或连续提问。');
  }
  if (snapshot.emotion.valence < 0.4) projection.unshift('当前情绪偏低，表达应平稳，不放大消极感受。');
  return projection.slice(0, 6);
}

function personalityTones(personality: PersonalityValues): string[] {
  const tones: string[] = [];
  if (personality.warmth >= 0.7) tones.push('温暖');
  if (personality.energy >= 0.7) tones.push('有活力');
  if (personality.reserve >= 0.7) tones.push('克制');
  if (personality.maturity >= 0.75) tones.push('沉稳');
  if (personality.playfulness >= 0.7) tones.push('轻松');
  return tones.slice(0, 2);
}

function applyEmotion(state: EmotionState, delta: Partial<EmotionState>): EmotionState {
  return mapState(state, delta, 0.15);
}

function reflectionImportance(signal: InteractionSignal): number {
  if (signal.reasons.includes('received conflict signal')) return 0.85;
  if (signal.reasons.includes('user shared personal feelings')) return 0.78;
  if (signal.reasons.includes('received positive affection')) return 0.7;
  return 0.2;
}

function applyRelationship(state: RelationshipState, delta: Partial<RelationshipState>): RelationshipState {
  return mapState(state, delta, 0.04);
}

function mapState<T extends Record<string, number>>(state: T, delta: Partial<T>, limit: number): T {
  return Object.fromEntries(Object.entries(state).map(([key, value]) => {
    const change = clamp(Number(delta[key] ?? 0), -limit, limit);
    return [key, clamp(value + change, 0, 1)];
  })) as T;
}

function evolvePersonality(
  current: PersonalityValues,
  baseline: PersonalityValues,
  trait: PersonalityTrait,
  direction: -1 | 1,
): PersonalityValues {
  const next = { ...current };
  const bounded = clamp(current[trait] + direction * 0.01,
    Math.max(0, baseline[trait] - 0.12), Math.min(1, baseline[trait] + 0.12));
  next[trait] = bounded;
  return Object.fromEntries(PERSONALITY_TRAITS.map((key) => [key, next[key]])) as PersonalityValues;
}

function merge<T extends Record<string, number>>(left: Partial<T>, right: Partial<T>): Partial<T> {
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) {
    result[key as keyof T] = (Number(result[key as keyof T] ?? 0) + Number(value)) as T[keyof T];
  }
  return result;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
