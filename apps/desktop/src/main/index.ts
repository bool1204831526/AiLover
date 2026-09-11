import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';

import { app, BrowserWindow, dialog, ipcMain, nativeImage, safeStorage, shell } from 'electron';

import {
  BootstrapResponseSchema, CharacterDraftSchema, CharacterSnapshotSchema, ChatMessageSchema,
  ChatSendInputSchema, ChatSendReceiptSchema, ChatStreamEventSchema, ConversationHistorySchema,
  ConversationSnapshotSchema, IPC_CHANNELS, ModelConnectionResultSchema, ModelProfileInputSchema,
  ModelProfileSnapshotSchema, RelationshipSummarySchema, CharacterVisualProfileSchema,
  ImageCapabilitiesSchema, type ChatStreamEvent,
} from '@ailover/contracts';
import { analyzeInteraction, CognitionService, createResponsePlan, projectCognition,
  relationshipSummary } from '@ailover/cognition';
import { assembleChatContext, CharacterService, type StoredChatMessage, type StoredConversation } from '@ailover/application';
import { createCharacter, type Character } from '@ailover/domain';
import { MemoryService, type RecalledMemory } from '@ailover/memory';
import { inferImageCapabilities, ModelGatewayError, probeModelProvider,
  streamModelChat } from '@ailover/model-gateway';
import { createLogger } from '@ailover/observability';
import { openAppDatabase, SqliteCharacterRepository, SqliteCognitionRepository,
  SqliteConversationRepository, SqliteMemoryRepository, SqliteModelProfileRepository } from '@ailover/persistence';
import { SqliteVisualAssetRepository, type StoredCharacterAsset } from '@ailover/persistence';

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
const memoryService = new MemoryService({ repository: new SqliteMemoryRepository(database),
  idGenerator: { next: randomUUID } });
const cognitionService = new CognitionService(new SqliteCognitionRepository(database),
  { next: randomUUID });
const visualAssetRepository = new SqliteVisualAssetRepository(database);
const assetRoot = join(app.getPath('userData'), 'assets');
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

function ensureVisualIdentity(character: Character) {
  const existing = visualAssetRepository.getIdentity(character.id);
  if (existing) return existing;
  const now = new Date();
  const identity = {
    characterId: character.id,
    identityDescription: `${character.name}，${character.ageSetting}${character.gender}，${character.identity}。${character.appearance}`,
    generationPrompt: `角色肖像，${character.name}，${character.ageSetting}${character.gender}，${character.appearance}，自然神态，清晰面部，统一角色设计`,
    negativePrompt: '文字，水印，标志，模糊，低清晰度，多余肢体，面部畸变',
    updatedAt: now,
  };
  visualAssetRepository.saveIdentity(identity);
  return identity;
}

async function toVisualProfile(character: Character) {
  const identity = ensureVisualIdentity(character);
  const asset = visualAssetRepository.getCurrentAsset(character.id);
  let currentAsset = null;
  if (asset) {
    const absolutePath = resolve(asset.localPath);
    const root = resolve(assetRoot) + sep;
    if (!absolutePath.startsWith(root)) throw new Error('Asset path is outside the application data directory');
    const data = await readFile(absolutePath);
    currentAsset = { ...asset, dataUrl: `data:${asset.mimeType};base64,${data.toString('base64')}`,
      createdAt: asset.createdAt.toISOString() };
  }
  return CharacterVisualProfileSchema.parse({ ...identity, updatedAt: identity.updatedAt.toISOString(), currentAsset });
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
        memory: true,
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
    const created = await characterService.create(character);
    ensureVisualIdentity(created);
    return toCharacterSnapshot(created);
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
    setImmediate(() => void completeChat(
      requestId, character, userMessage, assistantMessage, controller.signal,
    ));
    return ChatSendReceiptSchema.parse({ requestId, userMessage: toChatMessage(userMessage),
      assistantMessage: toChatMessage(assistantMessage) });
  });

  ipcMain.handle(IPC_CHANNELS.chatCancel, async (_event, requestId: unknown) => {
    if (typeof requestId !== 'string') throw new Error('无效的请求标识。');
    activeChats.get(requestId)?.abort();
  });

  ipcMain.handle(IPC_CHANNELS.relationshipGetSummary, async () => {
    const character = await characterService.findCurrent();
    if (!character) return null;
    const state = await cognitionService.getOrCreate(
      character.id, character.personalityBaseline, new Date(),
    );
    const summary = relationshipSummary(state);
    return RelationshipSummarySchema.parse({ ...summary, updatedAt: summary.updatedAt.toISOString() });
  });

  ipcMain.handle(IPC_CHANNELS.characterVisualGet, async () => {
    const character = await characterService.findCurrent();
    return character ? toVisualProfile(character) : null;
  });

  ipcMain.handle(IPC_CHANNELS.characterAssetImport, async () => {
    const character = await characterService.findCurrent();
    if (!character || !mainWindow) return null;
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: `为${character.name}选择角色图`, properties: ['openFile'],
      filters: [{ name: '角色图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    const sourcePath = selection.filePaths[0];
    if (selection.canceled || !sourcePath) return toVisualProfile(character);
    const extension = extname(sourcePath).toLowerCase();
    const mimeTypes: Record<string, StoredCharacterAsset['mimeType']> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    };
    const mimeType = mimeTypes[extension];
    if (!mimeType || nativeImage.createFromPath(sourcePath).isEmpty()) throw new Error('请选择有效的 PNG、JPEG 或 WebP 图片。');
    if ((await stat(sourcePath)).size > 15 * 1024 * 1024) throw new Error('图片不能超过 15 MB。');
    const characterDirectory = join(assetRoot, character.id);
    await mkdir(characterDirectory, { recursive: true });
    const id = randomUUID();
    const destination = join(characterDirectory, `${id}${extension === '.jpeg' ? '.jpg' : extension}`);
    await copyFile(sourcePath, destination);
    const checksum = createHash('sha256').update(await readFile(destination)).digest('hex');
    visualAssetRepository.saveAsset({ id, characterId: character.id, type: 'portrait',
      source: 'imported', localPath: destination, mimeType, checksum,
      fileName: basename(sourcePath), metadata: {}, createdAt: new Date() });
    return toVisualProfile(character);
  });

  ipcMain.handle(IPC_CHANNELS.imageCapabilitiesGet, async () => {
    const profile = await modelProfileRepository.get();
    if (!profile) return ImageCapabilitiesSchema.parse({ analysis: false, generation: false,
      provider: null, reason: '尚未配置模型服务，可继续使用本地导入' });
    const apiKey = decryptApiKey(profile.encryptedApiKey);
    const result = await probeModelProvider({ provider: profile.provider, endpoint: profile.endpoint,
      ...(apiKey ? { apiKey } : {}) });
    return ImageCapabilitiesSchema.parse(result.ok
      ? inferImageCapabilities(profile.provider, result.models)
      : { analysis: false, generation: false, provider: profile.provider,
        reason: '图片能力探测失败，不影响聊天和本地图片导入' });
  });
}

async function completeChat(
  requestId: string,
  character: Character,
  userMessage: StoredChatMessage,
  assistantMessage: StoredChatMessage,
  signal: AbortSignal,
): Promise<void> {
  let content = '';
  try {
    const history = await conversationRepository.listMessages(assistantMessage.conversationId);
    let recalled: RecalledMemory[] = [];
    try {
      recalled = await memoryService.recall({ characterId: character.id, queryMessageId: userMessage.id,
        query: userMessage.content, now: userMessage.createdAt });
    } catch (error) {
      logger.warn({ error }, 'Memory recall failed; continuing without recalled context');
    }
    const cognition = await cognitionService.processInteraction({ characterId: character.id,
      baseline: character.personalityBaseline, sourceMessageId: userMessage.id,
      text: userMessage.content, now: userMessage.createdAt });
    const responsePlan = createResponsePlan(cognition, analyzeInteraction(userMessage.content));
    const cognitionContext = `${projectCognition(cognition)}；回复语气：${responsePlan.tone.join('、')}。${responsePlan.guidance}`;
    const profile = await modelProfileRepository.get();
    if (!profile) throw new ModelGatewayError('请先在设置中配置聊天模型。', false);
    const apiKey = decryptApiKey(profile.encryptedApiKey);
    for await (const delta of streamModelChat({ provider: profile.provider, endpoint: profile.endpoint,
      model: profile.model, messages: assembleChatContext(
        character, history, 12_000, recalled, cognitionContext,
      ), signal,
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
    try {
      await memoryService.capture({ userId: 'local-user', characterId: character.id,
        messageId: userMessage.id, text: userMessage.content, now: userMessage.createdAt });
    } catch (error) {
      logger.warn({ error }, 'Memory capture failed');
    }
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

void app.whenReady().then(async () => {
  registerIpcHandlers();
  createMainWindow();
  logger.info({ appVersion: app.getVersion() }, 'AiLover started');
  const character = await characterService.findCurrent();
  if (character) {
    void memoryService.decay(character.id, new Date())
      .catch((error: unknown) => logger.warn({ error }, 'Memory decay maintenance failed'));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => database.close());
