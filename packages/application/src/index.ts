import type { DomainEvent } from '@ailover/contracts';

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
