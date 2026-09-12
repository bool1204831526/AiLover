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

export type CompanionScheduleSettings = {
  enabled: boolean;
  intervalMinutes: number;
  quietStart: string;
  quietEnd: string;
};

function minutesSinceMidnight(value: string): number {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value);
  if (!match) throw new Error(`Invalid time value: ${value}`);
  const [hours, minutes] = value.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
}

export function isCompanionQuietHours(now: Date, settings: CompanionScheduleSettings): boolean {
  const start = minutesSinceMidnight(settings.quietStart);
  const end = minutesSinceMidnight(settings.quietEnd);
  if (start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function shouldSendCompanionPrompt(input: {
  now: Date;
  lastInteractionAt: Date | null;
  lastPromptAt: Date | null;
  settings: CompanionScheduleSettings;
}): boolean {
  const { now, lastInteractionAt, lastPromptAt, settings } = input;
  if (!settings.enabled || !lastInteractionAt || isCompanionQuietHours(now, settings)) return false;
  const elapsedSinceInteraction = now.getTime() - lastInteractionAt.getTime();
  const elapsedSincePrompt = lastPromptAt ? now.getTime() - lastPromptAt.getTime() : Infinity;
  const interval = settings.intervalMinutes * 60_000;
  return elapsedSinceInteraction >= interval && elapsedSincePrompt >= interval;
}

export function retainRecentMessages<T>(messages: T[], maximum = MAX_RETAINED_CHAT_MESSAGES): T[] {
  return messages.length > maximum ? messages.slice(-maximum) : messages;
}

export const CODEX_PET_ATLAS = Object.freeze({
  columns: 8,
  rows: 11,
  cellWidth: 192,
  cellHeight: 208,
  width: 1536,
  height: 2288,
});

export const CODEX_PET_ANIMATIONS = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  'running-right': { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  'running-left': { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, durations: [140, 140, 140, 280] },
  jumping: { row: 4, durations: [140, 140, 140, 140, 280] },
  failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durations: [150, 150, 150, 150, 150, 280] },
} as const;

export type CodexPetAnimation = keyof typeof CODEX_PET_ANIMATIONS;
export type CodexPetFrame = { row: number; column: number; duration: number };

export function codexPetFrame(animation: CodexPetAnimation, frameIndex: number): CodexPetFrame {
  const spec = CODEX_PET_ANIMATIONS[animation];
  const column = ((frameIndex % spec.durations.length) + spec.durations.length) % spec.durations.length;
  return { row: spec.row, column, duration: spec.durations[column] ?? 120 };
}

export function codexPetLookFrame(dx: number, dy: number, deadzone = 18): CodexPetFrame | null {
  if (Math.hypot(dx, dy) < deadzone) return null;
  const degrees = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  const direction = Math.round(degrees / 22.5) % 16;
  return direction < 8
    ? { row: 9, column: direction, duration: 120 }
    : { row: 10, column: direction - 8, duration: 120 };
}

export type ImageDimensions = { width: number; height: number };

export type Rectangle = { x: number; y: number; width: number; height: number };

export function fitDesktopPetBounds(saved: Rectangle | null, workArea: Rectangle): Rectangle {
  const width = Math.min(Math.max(saved?.width ?? 220, 180), workArea.width);
  const height = Math.min(Math.max(saved?.height ?? 280, 220), workArea.height);
  const defaultX = workArea.x + workArea.width - width - 24;
  const defaultY = workArea.y + workArea.height - height - 24;
  const x = Math.min(Math.max(saved?.x ?? defaultX, workArea.x), workArea.x + workArea.width - width);
  const y = Math.min(Math.max(saved?.y ?? defaultY, workArea.y), workArea.y + workArea.height - height);
  return { x, y, width, height };
}

function bytesEqual(data: Uint8Array, offset: number, expected: number[]): boolean {
  return expected.every((value, index) => data[offset + index] === value);
}

export function readPngDimensions(data: Uint8Array): ImageDimensions | null {
  if (data.length < 24 || !bytesEqual(data, 0, [137, 80, 78, 71, 13, 10, 26, 10])
    || !bytesEqual(data, 12, [73, 72, 68, 82])) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function readWebPDimensions(data: Uint8Array): ImageDimensions | null {
  if (data.length < 20 || !bytesEqual(data, 0, [82, 73, 70, 70])
    || !bytesEqual(data, 8, [87, 69, 66, 80])) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 12;
  while (offset + 8 <= data.length) {
    const payload = offset + 8;
    const chunkSize = view.getUint32(offset + 4, true);
    if (payload + chunkSize > data.length) return null;
    if (bytesEqual(data, offset, [86, 80, 56, 88]) && chunkSize >= 10) {
      const width = 1 + data[payload + 4]! + (data[payload + 5]! << 8) + (data[payload + 6]! << 16);
      const height = 1 + data[payload + 7]! + (data[payload + 8]! << 8) + (data[payload + 9]! << 16);
      return { width, height };
    }
    if (bytesEqual(data, offset, [86, 80, 56, 76]) && chunkSize >= 5 && data[payload] === 47) {
      const bits = view.getUint32(payload + 1, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (bytesEqual(data, offset, [86, 80, 56, 32]) && chunkSize >= 10
      && bytesEqual(data, payload + 3, [157, 1, 42])) {
      return { width: view.getUint16(payload + 6, true) & 0x3fff,
        height: view.getUint16(payload + 8, true) & 0x3fff };
    }
    offset = payload + chunkSize + (chunkSize % 2);
  }
  return null;
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
