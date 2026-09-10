import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';

import {
  BootstrapResponseSchema, CharacterDraftSchema, CharacterSnapshotSchema, ChatMessageSchema,
  ChatSendInputSchema, ChatSendReceiptSchema, ChatStreamEventSchema, ConversationHistorySchema,
  ConversationSnapshotSchema, IPC_CHANNELS, ModelConnectionResultSchema, ModelProfileInputSchema,
  ModelProfileSnapshotSchema, type ChatStreamEvent,
} from '@ailover/contracts';
import { assembleChatContext, CharacterService, type StoredChatMessage, type StoredConversation } from '@ailover/application';
import { createCharacter, type Character } from '@ailover/domain';
import { ModelGatewayError, probeModelProvider, streamModelChat } from '@ailover/model-gateway';
import { createLogger } from '@ailover/observability';
import { openAppDatabase, SqliteCharacterRepository, SqliteConversationRepository,
  SqliteModelProfileRepository } from '@ailover/persistence';

import { loadAppConfig } from './config';

const isSmokeTest = process.argv.includes('--smoke-test');

if (isSmokeTest && process.env.AILOVER_SMOKE_USER_DATA) {
  app.setPath('userData', process.env.AILOVER_SMOKE_USER_DATA);
}

if (isSmokeTest) {
  process.on('uncaughtException', (error) => {
    process.stderr.write(`AILOVER_MAIN_ERROR\n${error.stack ?? error.message}\n`);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    const detail = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
    process.stderr.write(`AILOVER_MAIN_ERROR\n${detail}\n`);
    process.exit(1);
  });
}

const config = loadAppConfig();
const logger = createLogger({ level: config.logLevel, environment: config.environment });
let smokeTestCompleted = false;
const database = openAppDatabase(join(app.getPath('userData'), 'data', 'ailover.sqlite'));
const characterService = new CharacterService(new SqliteCharacterRepository(database));
const modelProfileRepository = new SqliteModelProfileRepository(database);
const conversationRepository = new SqliteConversationRepository(database);
const activeChats = new Map<string, AbortController>();
let mainWindow: BrowserWindow | null = null;

function toCharacterSnapshot(character: Character) {
  return CharacterSnapshotSchema.parse({
    ...character,
    createdAt: character.createdAt.toISOString(),
    updatedAt: character.updatedAt.toISOString(),
  });
}

function toModelProfileSnapshot(profile: Awaited<ReturnType<typeof modelProfileRepository.get>>) {
  if (!profile) return null;
  return ModelProfileSnapshotSchema.parse({
    provider: profile.provider, endpoint: profile.endpoint, model: profile.model,
    hasApiKey: Boolean(profile.encryptedApiKey), updatedAt: profile.updatedAt.toISOString(),
  });
}

function toConversationSnapshot(conversation: StoredConversation) {
  return ConversationSnapshotSchema.parse({ ...conversation,
    startedAt: conversation.startedAt.toISOString(), lastMessageAt: conversation.lastMessageAt.toISOString() });
}

function toChatMessage(message: StoredChatMessage) {
  return ChatMessageSchema.parse({ ...message, createdAt: message.createdAt.toISOString() });
}

function emitChatEvent(event: ChatStreamEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.chatStream, ChatStreamEventSchema.parse(event));
  }
}

function encryptApiKey(apiKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable');
  return safeStorage.encryptString(apiKey).toString('base64');
}

function decryptApiKey(encrypted: string | null): string | undefined {
  if (!encrypted) return undefined;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable');
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appBootstrap, async () => {
    const current = await characterService.findCurrent();
    const response = BootstrapResponseSchema.parse({
      appVersion: app.getVersion(),
      platform: process.platform,
      environment: config.environment,
      dataPath: app.getPath('userData'),
      capabilities: {
        character: true,
        chat: true,
        memory: false,
      },
      currentCharacter: current ? toCharacterSnapshot(current) : null,
    });

    if (isSmokeTest && !smokeTestCompleted) {
      smokeTestCompleted = true;
      process.stdout.write('AILOVER_SMOKE_READY\n');
      setTimeout(() => app.quit(), 50);
    }

    return response;
  });

  ipcMain.handle(IPC_CHANNELS.characterGetCurrent, async () => {
    const current = await characterService.findCurrent();
    return current ? toCharacterSnapshot(current) : null;
  });

  ipcMain.handle(IPC_CHANNELS.characterCreate, async (_event, input: unknown) => {
    const draft = CharacterDraftSchema.parse(input);
    const character = createCharacter(draft, {
      idGenerator: { next: randomUUID },
      clock: { now: () => new Date() },
    });
    return toCharacterSnapshot(await characterService.create(character));
  });

  ipcMain.handle(IPC_CHANNELS.modelProfileGet, async () =>
    toModelProfileSnapshot(await modelProfileRepository.get()));

  ipcMain.handle(IPC_CHANNELS.modelProfileSave, async (_event, input: unknown) => {
    const profile = ModelProfileInputSchema.parse(input);
    const existing = await modelProfileRepository.get();
    const encryptedApiKey = profile.provider === 'ollama' ? null
      : profile.apiKey ? encryptApiKey(profile.apiKey) : existing?.encryptedApiKey ?? null;
    const stored = { provider: profile.provider, endpoint: profile.endpoint, model: profile.model,
      encryptedApiKey, updatedAt: new Date() };
    await modelProfileRepository.save(stored);
    return toModelProfileSnapshot(stored);
  });

  ipcMain.handle(IPC_CHANNELS.modelProfileTest, async (_event, input: unknown) => {
    const profile = ModelProfileInputSchema.parse(input);
    const saved = await modelProfileRepository.get();
    const apiKey = profile.apiKey || (saved?.provider === profile.provider
      ? decryptApiKey(saved.encryptedApiKey) : undefined);
    const result = await probeModelProvider({ provider: profile.provider, endpoint: profile.endpoint,
      ...(apiKey ? { apiKey } : {}) });
    return ModelConnectionResultSchema.parse(result);
  });

  ipcMain.handle(IPC_CHANNELS.conversationLoad, async () => {
    const character = await characterService.findCurrent();
    if (!character) return ConversationHistorySchema.parse({ conversation: null, messages: [] });
    const conversation = await conversationRepository.findCurrent(character.id);
    if (!conversation) return ConversationHistorySchema.parse({ conversation: null, messages: [] });
    const messages = await conversationRepository.listMessages(conversation.id);
    return ConversationHistorySchema.parse({ conversation: toConversationSnapshot(conversation),
      messages: messages.map(toChatMessage) });
  });

  ipcMain.handle(IPC_CHANNELS.chatSend, async (_event, input: unknown) => {
    const request = ChatSendInputSchema.parse(input);
    const character = await characterService.findCurrent();
    if (!character) throw new Error('请先创建角色。');
    let conversation = await conversationRepository.findCurrent(character.id);
    const now = new Date();
    if (!conversation) {
      conversation = { id: randomUUID(), characterId: character.id,
        title: request.text.slice(0, 32), startedAt: now, lastMessageAt: now };
      await conversationRepository.create(conversation);
    }
    const existing = await conversationRepository.findMessage(request.clientMessageId);
    if (existing) throw new Error('这条消息已经发送。');
    const userMessage: StoredChatMessage = { id: request.clientMessageId, conversationId: conversation.id,
      role: 'user', content: request.text, status: 'completed', model: null, createdAt: now };
    const assistantMessage: StoredChatMessage = { id: randomUUID(), conversationId: conversation.id,
      role: 'assistant', content: '', status: 'streaming', model: null,
      createdAt: new Date(now.getTime() + 1) };
    await conversationRepository.saveMessage(userMessage);
    await conversationRepository.saveMessage(assistantMessage);
    await conversationRepository.touch(conversation.id, assistantMessage.createdAt);
    const requestId = randomUUID();
    const controller = new AbortController();
    activeChats.set(requestId, controller);
    setImmediate(() => void completeChat(requestId, character, assistantMessage, controller.signal));
    return ChatSendReceiptSchema.parse({ requestId, userMessage: toChatMessage(userMessage),
      assistantMessage: toChatMessage(assistantMessage) });
  });

  ipcMain.handle(IPC_CHANNELS.chatCancel, async (_event, requestId: unknown) => {
    if (typeof requestId !== 'string') throw new Error('无效的请求标识。');
    activeChats.get(requestId)?.abort();
  });
}

async function completeChat(
  requestId: string,
  character: Character,
  assistantMessage: StoredChatMessage,
  signal: AbortSignal,
): Promise<void> {
  let content = '';
  try {
    const profile = await modelProfileRepository.get();
    if (!profile) throw new ModelGatewayError('请先在设置中配置聊天模型。', false);
    const history = await conversationRepository.listMessages(assistantMessage.conversationId);
    const apiKey = decryptApiKey(profile.encryptedApiKey);
    for await (const delta of streamModelChat({ provider: profile.provider, endpoint: profile.endpoint,
      model: profile.model, messages: assembleChatContext(character, history), signal,
      ...(apiKey ? { apiKey } : {}) })) {
      content += delta;
      emitChatEvent({ type: 'chunk', requestId, messageId: assistantMessage.id, delta });
    }
    if (!content.trim()) throw new ModelGatewayError('模型没有返回内容，请重试。', true);
    await conversationRepository.updateMessage(assistantMessage.id,
      { content, status: 'completed', model: profile.model });
    const completed = { ...assistantMessage, content, status: 'completed' as const, model: profile.model };
    emitChatEvent({ type: 'completed', requestId, message: toChatMessage(completed) });
  } catch (error) {
    const cancelled = signal.aborted;
    const status = cancelled ? 'cancelled' as const : 'failed' as const;
    await conversationRepository.updateMessage(assistantMessage.id, { content, status });
    const message = toChatMessage({ ...assistantMessage, content, status });
    if (cancelled) emitChatEvent({ type: 'cancelled', requestId, message });
    else emitChatEvent({ type: 'failed', requestId, message,
      error: error instanceof ModelGatewayError ? error.message : '生成回复失败，请稍后重试。',
      retryable: error instanceof ModelGatewayError ? error.retryable : true });
  } finally {
    activeChats.delete(requestId);
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: '#f4f2ee',
    title: 'AiLover',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.once('closed', () => { if (mainWindow === window) mainWindow = null; });

  window.once('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

void app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();
  logger.info({ appVersion: app.getVersion() }, 'AiLover started');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => database.close());
