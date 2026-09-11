import { describe, expect, it } from 'vitest';

import type { PersonalityValues } from '@ailover/domain';

import {
  analyzeInteraction, COGNITION_RULE_VERSION, CognitionService, decaySnapshot,
  createResponsePlan, type CognitionRepository, type CognitionSnapshot, type EvolutionEvidence,
  type ReflectionRecord,
} from './index';

const baseline: PersonalityValues = { warmth: 0.7, energy: 0.5, reserve: 0.4,
  playfulness: 0.5, maturity: 0.6, rationality: 0.6, initiative: 0.5 };

class MemoryCognitionRepository implements CognitionRepository {
  snapshot: CognitionSnapshot | null = null;
  evidence: EvolutionEvidence[] = [];
  reflections: ReflectionRecord[] = [];
  async getCurrent() { return this.snapshot; }
  async saveSnapshot(snapshot: CognitionSnapshot) { this.snapshot = snapshot; }
  async addEvidence(evidence: EvolutionEvidence) {
    if (!this.evidence.some((item) => item.sourceMessageId === evidence.sourceMessageId &&
      item.trait === evidence.trait)) this.evidence.push(evidence);
    return this.evidence.filter((item) => item.characterId === evidence.characterId &&
      item.trait === evidence.trait && item.direction === evidence.direction).length;
  }
  async saveReflection(reflection: ReflectionRecord) { this.reflections.push(reflection); }
}

describe('cognition rules', () => {
  it('bounds strong negative interaction effects', () => {
    const signal = analyzeInteraction('滚，我讨厌你，你骗我了');
    expect(signal.emotionDelta.valence).toBeGreaterThanOrEqual(-0.15);
    expect(signal.relationshipDelta.conflict).toBeLessThanOrEqual(0.04);
  });

  it('decays emotion toward neutral without changing relationship', () => {
    const snapshot: CognitionSnapshot = { id: 'state-1', characterId: 'character-1',
      emotion: { valence: 0.9, arousal: 0.9, security: 0.4, affection: 0.8 },
      relationship: { trust: 0.5, intimacy: 0.4, affection: 0.5,
        familiarity: 0.4, comfort: 0.5, conflict: 0.1 },
      personality: baseline, reason: 'test', sourceMessageId: 'message-1',
      ruleVersion: COGNITION_RULE_VERSION, recordedAt: new Date('2026-09-01T00:00:00Z') };
    const decayed = decaySnapshot(snapshot, new Date('2026-09-04T00:00:00Z'));
    expect(decayed.emotion.valence).toBeLessThan(0.7);
    expect(decayed.relationship).toEqual(snapshot.relationship);
  });

  it('changes personality only after three independent pieces of evidence', async () => {
    const repository = new MemoryCognitionRepository();
    let id = 0;
    const service = new CognitionService(repository, { next: () => `state-${++id}` });
    for (let index = 1; index <= 2; index += 1) {
      const state = await service.processInteraction({ characterId: 'character-1', baseline,
        sourceMessageId: `message-${index}`, text: '希望你主动一点，陪我一起去', now: new Date() });
      expect(state.personality.initiative).toBe(0.5);
    }
    const evolved = await service.processInteraction({ characterId: 'character-1', baseline,
      sourceMessageId: 'message-3', text: '希望你主动一点', now: new Date() });
    expect(evolved.personality.initiative).toBe(0.51);
    expect(evolved.ruleVersion).toBe(COGNITION_RULE_VERSION);
  });

  it('does not count the same source message twice', async () => {
    const repository = new MemoryCognitionRepository();
    const service = new CognitionService(repository, { next: () => crypto.randomUUID() });
    for (let index = 0; index < 3; index += 1) await service.processInteraction({
      characterId: 'character-1', baseline, sourceMessageId: 'same-message',
      text: '请理性分析一下', now: new Date(),
    });
    expect(repository.snapshot?.personality.rationality).toBe(0.6);
  });

  it('creates a constrained response plan and reflection for meaningful disclosure', async () => {
    const repository = new MemoryCognitionRepository();
    let id = 0;
    const service = new CognitionService(repository, { next: () => `record-${++id}` });
    const snapshot = await service.processInteraction({ characterId: 'character-1', baseline,
      sourceMessageId: 'message-disclosure', text: '其实我很难过，只告诉你一个秘密', now: new Date() });
    const plan = createResponsePlan(snapshot, analyzeInteraction('其实我很难过，只告诉你一个秘密'));
    expect(plan.kind).toBe('ask_question');
    expect(plan.tone).toContain('认真倾听');
    expect(repository.reflections[0]?.triggerMessageId).toBe('message-disclosure');
    expect(repository.reflections[0]?.importance).toBeGreaterThanOrEqual(0.7);
  });
});
