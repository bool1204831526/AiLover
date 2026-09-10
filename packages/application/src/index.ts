import type { DomainEvent } from '@ailover/contracts';
import type { Character, CharacterId } from '@ailover/domain';

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(eventType: string, handler: EventHandler): () => void;
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

export interface Transaction {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export interface HealthCheck {
  readonly name: string;
  check(): Promise<{ healthy: boolean; detail?: string }>;
}

export interface CharacterRepository {
  save(character: Character): Promise<void>;
  findById(id: CharacterId): Promise<Character | null>;
  findCurrent(): Promise<Character | null>;
}

export class CharacterService {
  public constructor(private readonly repository: CharacterRepository) {}

  public async create(character: Character): Promise<Character> {
    if (await this.repository.findCurrent()) throw new Error('A character already exists');
    await this.repository.save(character);
    return character;
  }

  public findCurrent(): Promise<Character | null> {
    return this.repository.findCurrent();
  }
}
