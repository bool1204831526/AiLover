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

export type CharacterDraft = {
  name: string;
  gender: string;
  ageSetting: string;
  identity: string;
  background: string;
  appearance: string;
  speakingStyle: string;
  personalityTemplateId: PersonalityTemplateId;
};

export type Character = CharacterDraft & {
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
  const now = dependencies.clock.now();
  return {
    ...draft,
    name: normalizedName,
    id: dependencies.idGenerator.next() as CharacterId,
    personalityBaseline: PERSONALITY_TEMPLATES[draft.personalityTemplateId],
    createdAt: now,
    updatedAt: now,
  };
}
