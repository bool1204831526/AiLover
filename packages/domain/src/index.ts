export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type CharacterId = Brand<string, 'CharacterId'>;
export type UserId = Brand<string, 'UserId'>;

export class DomainError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export const PERSONALITY_TRAITS = [
  'warmth', 'energy', 'reserve', 'playfulness', 'maturity', 'rationality', 'initiative',
] as const;

export type PersonalityTrait = (typeof PERSONALITY_TRAITS)[number];
export type PersonalityValues = Readonly<Record<PersonalityTrait, number>>;
export type PersonalityTemplateId =
  | 'gentle' | 'energetic' | 'reserved' | 'tsundere' | 'mature' | 'rational';

export type CharacterLore = {
  originWorld: string;
  lifeStory: string;
  worldview: string;
  coreMotivations: string;
  knowledgeBoundaries: string;
  arrivalStory: string;
};

export const DEFAULT_CHARACTER_LORE: CharacterLore = {
  originWorld: '一个尚未被完整描述的原世界',
  lifeStory: '来到这里以前，已经拥有属于自己的人生与经历；未写明的细节不会凭空断言。',
  worldview: '以自己原有世界的经验理解事物，同时愿意逐步认识用户所在的世界。',
  coreMotivations: '理解这次相遇的意义，并在新的生活中建立真实、连续的关系。',
  knowledgeBoundaries: '只确信设定、亲历事件和对话中得到的信息；不知道的事情会坦率承认。',
  arrivalStory: '一次意外的次元裂缝将自己带到 AiLover，并把这里视为抵达后的真实居所。',
};

export function isImmersiveCharacterLore(lore: CharacterLore): boolean {
  const combined = Object.values(lore).join('\n');
  const containsMetaNarrative = /(系统提示|提示词|语言模型|大模型|角色卡|角色扮演|生成文本|作为AI助手)/i.test(combined);
  const hasArrivalContinuity = /(召唤|裂缝|穿越|传送|跨越|通道|门扉|仪式)/.test(lore.arrivalStory)
    && /AiLover/i.test(lore.arrivalStory);
  return !containsMetaNarrative && hasArrivalContinuity;
}

export type CharacterDraft = {
  name: string;
  gender: string;
  ageSetting: string;
  identity: string;
  background: string;
  appearance: string;
  speakingStyle: string;
  personalityTemplateId: PersonalityTemplateId;
  lore?: CharacterLore | undefined;
};

export type Character = Omit<CharacterDraft, 'lore'> & {
  lore: CharacterLore;
  id: CharacterId;
  personalityBaseline: PersonalityValues;
  createdAt: Date;
  updatedAt: Date;
};

export const PERSONALITY_TEMPLATES: Readonly<Record<PersonalityTemplateId, PersonalityValues>> = {
  gentle: { warmth: 0.9, energy: 0.45, reserve: 0.35, playfulness: 0.45, maturity: 0.7, rationality: 0.6, initiative: 0.5 },
  energetic: { warmth: 0.78, energy: 0.95, reserve: 0.12, playfulness: 0.88, maturity: 0.4, rationality: 0.45, initiative: 0.82 },
  reserved: { warmth: 0.5, energy: 0.28, reserve: 0.9, playfulness: 0.25, maturity: 0.76, rationality: 0.78, initiative: 0.3 },
  tsundere: { warmth: 0.68, energy: 0.7, reserve: 0.72, playfulness: 0.62, maturity: 0.48, rationality: 0.52, initiative: 0.55 },
  mature: { warmth: 0.76, energy: 0.48, reserve: 0.42, playfulness: 0.36, maturity: 0.94, rationality: 0.76, initiative: 0.68 },
  rational: { warmth: 0.48, energy: 0.4, reserve: 0.58, playfulness: 0.25, maturity: 0.8, rationality: 0.96, initiative: 0.6 },
};

export function createCharacter(
  draft: CharacterDraft,
  dependencies: { idGenerator: IdGenerator; clock: Clock },
): Character {
  const normalizedName = draft.name.trim();
  if (normalizedName.length < 1 || normalizedName.length > 40) {
    throw new DomainError('character.invalid_name', 'Character name must contain 1 to 40 characters');
  }
  if (draft.lore && !isImmersiveCharacterLore(draft.lore)) {
    throw new DomainError('character.invalid_lore',
      'Character lore must preserve an immersive arrival into AiLover and exclude model metadata');
  }
  const now = dependencies.clock.now();
  return {
    ...draft,
    lore: draft.lore ?? DEFAULT_CHARACTER_LORE,
    name: normalizedName,
    id: dependencies.idGenerator.next() as CharacterId,
    personalityBaseline: PERSONALITY_TEMPLATES[draft.personalityTemplateId],
    createdAt: now,
    updatedAt: now,
  };
}
