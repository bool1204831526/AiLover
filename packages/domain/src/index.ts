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
