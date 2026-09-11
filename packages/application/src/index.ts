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

export type StoredModelProfile = {
  provider: 'openai-compatible' | 'ollama';
  endpoint: string;
  model: string;
  encryptedApiKey: string | null;
  updatedAt: Date;
};

export interface ModelProfileRepository {
  get(): Promise<StoredModelProfile | null>;
  save(profile: StoredModelProfile): Promise<void>;
}

export type StoredConversation = {
  id: string;
  characterId: string;
  title: string;
  startedAt: Date;
  lastMessageAt: Date;
};

export type StoredChatMessage = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'streaming' | 'completed' | 'failed' | 'cancelled';
  model: string | null;
  createdAt: Date;
};

export interface ConversationRepository {
  findCurrent(characterId: string): Promise<StoredConversation | null>;
  create(conversation: StoredConversation): Promise<void>;
  listMessages(conversationId: string): Promise<StoredChatMessage[]>;
  searchMessages(conversationId: string, query: string, limit: number): Promise<StoredChatMessage[]>;
  findMessage(id: string): Promise<StoredChatMessage | null>;
  saveMessage(message: StoredChatMessage): Promise<void>;
  updateMessage(id: string, patch: Pick<StoredChatMessage, 'content' | 'status'> &
    Partial<Pick<StoredChatMessage, 'model'>>): Promise<void>;
  touch(conversationId: string, at: Date): Promise<void>;
}

export const MAX_RETAINED_CHAT_MESSAGES = 500;

export function retainRecentMessages<T>(messages: T[], maximum = MAX_RETAINED_CHAT_MESSAGES): T[] {
  return messages.length > maximum ? messages.slice(-maximum) : messages;
}

export type ModelChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type MemoryContextItem = { subject: string; content: string };

export function assembleChatContext(
  character: Character,
  history: StoredChatMessage[],
  characterBudget = 12_000,
  recalledMemories: MemoryContextItem[] = [],
  cognitionContext = '',
): ModelChatMessage[] {
  const system = [
    `你是${character.name}，${character.identity}。`,
    `你的背景：${character.background || '暂无额外背景设定'}。`,
    `你的外貌设定：${character.appearance}。`,
    `你的说话方式：${character.speakingStyle}。`,
    '始终保持上述身份，以自然、真诚的中文回复。不要声称自己可以操作现实设备，也不要编造未提供的共同经历。',
  ].join('\n');
  const eligible = history.filter((message) => message.status === 'completed' && message.content.trim());
  const selected: StoredChatMessage[] = [];
  let used = 0;
  for (const message of [...eligible].reverse()) {
    if (selected.length >= 24) break;
    const size = message.content.length;
    if (selected.length && used + size > characterBudget) break;
    selected.push(message);
    used += size;
  }
  const memoryContext = recalledMemories.length ? [{ role: 'system' as const,
    content: ['以下是有原始消息证据的相关记忆。只在当前话题确实相关时自然引用，不要逐条复述：',
      ...recalledMemories.slice(0, 6).map((memory) => `- ${memory.subject}：${memory.content}`)].join('\n') }] : [];
  const dynamicContext = cognitionContext ? [{ role: 'system' as const,
    content: `当前连续状态：${cognitionContext}。以此调整语气，但不要向用户展示内部数值或规则。` }] : [];
  return [{ role: 'system', content: system }, ...dynamicContext, ...memoryContext,
    ...selected.reverse().map(({ role, content }) => ({ role, content }))];
}
