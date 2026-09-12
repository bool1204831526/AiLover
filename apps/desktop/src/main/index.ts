import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { arch, release } from 'node:os';
import { basename, extname, join, resolve, sep } from 'node:path';

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, shell, Tray } from 'electron';

import {
  BootstrapResponseSchema, CharacterDraftSchema, CharacterSnapshotSchema, ChatMessageSchema,
  ChatSendInputSchema, ChatSendReceiptSchema, ChatStreamEventSchema, ConversationHistorySchema,
  ConversationSnapshotSchema, ConversationSearchInputSchema, IPC_CHANNELS, ModelConnectionResultSchema, ModelProfileInputSchema,
  ModelProfileSnapshotSchema, RelationshipSummarySchema, CharacterVisualProfileSchema,
  DataOperationResultSchema, DeleteAllDataInputSchema, ImageCapabilitiesSchema, CompanionSettingsSchema,
  DesktopPetPackManifestSchema, DesktopPetPackSchema, type DesktopPetPackManifest,
  type ChatStreamEvent,
} from '@ailover/contracts';
import { createBackupDocument, parseBackupDocument, readAssetEntries } from '@ailover/backup';
import { analyzeInteraction, CognitionService, createResponsePlan, projectCognition,
  relationshipSummary } from '@ailover/cognition';
import { assembleChatContext, CharacterService, shouldSendCompanionPrompt,
  type StoredChatMessage, type StoredConversation } from '@ailover/application';
import { createCharacter, type Character } from '@ailover/domain';
import { MemoryService, type RecalledMemory } from '@ailover/memory';
import { inferImageCapabilities, ModelGatewayError, probeModelProvider,
  streamModelChat } from '@ailover/model-gateway';
import { createLogger } from '@ailover/observability';
import { createSanitizedDatabaseSnapshot, CURRENT_SCHEMA_VERSION, openAppDatabase, prepareRestoredDatabase,
  SqliteCharacterRepository, SqliteCognitionRepository, SqliteConversationRepository,
  SqliteMemoryRepository, SqliteModelProfileRepository, SqliteCompanionSettingsRepository,
  validateRestoredDatabase } from '@ailover/persistence';
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
const processStartedAt = performance.now();
let startupDurationMs: number | null = null;
let smokeTestCompleted = false;
const userDataPath = app.getPath('userData');
const databasePath = join(userDataPath, 'data', 'ailover.sqlite');
const database = openAppDatabase(databasePath);
const characterService = new CharacterService(new SqliteCharacterRepository(database));
const modelProfileRepository = new SqliteModelProfileRepository(database);
const conversationRepository = new SqliteConversationRepository(database);
const companionSettingsRepository = new SqliteCompanionSettingsRepository(database);
const memoryService = new MemoryService({ repository: new SqliteMemoryRepository(database),
  idGenerator: { next: randomUUID } });
const cognitionService = new CognitionService(new SqliteCognitionRepository(database),
  { next: randomUUID });
const visualAssetRepository = new SqliteVisualAssetRepository(database);
const assetRoot = join(userDataPath, 'assets');
const recommendedPetActions = ['idle', 'walk-left', 'walk-right', 'greet', 'happy', 'thinking', 'sleep'] as const;
const activeChats = new Map<string, AbortController>();
let mainWindow: BrowserWindow | null = null;
let desktopPetWindow: BrowserWindow | null = null;
let companionTimer: NodeJS.Timeout | null = null;
let tray: Tray | null = null;
let isQuitting = false;

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

function restartApplication(): void {
  setTimeout(() => { app.relaunch(); app.exit(0); }, 250);
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

function petPackRoot(characterId: string): string {
  return join(assetRoot, characterId, 'desktop-pet');
}

async function readDesktopPetPack(characterId: string) {
  const root = petPackRoot(characterId);
  let pointer: { version: number };
  try { pointer = JSON.parse(await readFile(join(root, 'current.json'), 'utf8')) as { version: number }; }
  catch { return null; }
  if (!Number.isInteger(pointer.version) || pointer.version < 1) return null;
  const directory = join(root, String(pointer.version));
  const manifest = DesktopPetPackManifestSchema.parse(
    JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')),
  );
  const actionDataUrls: Record<string, string> = {};
  for (const [action, fileName] of Object.entries(manifest.actions)) {
    if (!fileName) continue;
    if (basename(fileName) !== fileName) throw new Error('动画清单包含不安全的文件路径。');
    const extension = extname(fileName).toLowerCase();
    const mimeType = extension === '.webp' ? 'image/webp' : extension === '.png' ? 'image/png' : null;
    if (!mimeType) throw new Error('桌宠动作只支持 WebP 或 PNG。');
    actionDataUrls[action] = `data:${mimeType};base64,${(await readFile(join(directory, fileName))).toString('base64')}`;
  }
  const availableActions = Object.keys(manifest.actions);
  return DesktopPetPackSchema.parse({ version: pointer.version, availableActions,
    missingRecommended: recommendedPetActions.filter((action) => !availableActions.includes(action)),
    actionDataUrls, message: `已启用动画包版本 ${pointer.version}` });
}

async function importDesktopPetPack(character: Character, sourceDirectory: string) {
  const manifestPath = join(sourceDirectory, 'manifest.json');
  let manifest: DesktopPetPackManifest;
  try {
    if ((await stat(manifestPath)).size > 100 * 1024) throw new Error('manifest.json 不能超过 100 KB。');
    manifest = DesktopPetPackManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const actions: Record<string, string> = {};
    for (const action of recommendedPetActions) {
      for (const extension of ['.webp', '.png']) {
        const fileName = `${action}${extension}`;
        try { if ((await stat(join(sourceDirectory, fileName))).isFile()) { actions[action] = fileName; break; } }
        catch { /* This optional action file is not present. */ }
      }
    }
    manifest = DesktopPetPackManifestSchema.parse({ version: 1, actions });
  }
  const files = Object.values(manifest.actions).filter((fileName): fileName is string => Boolean(fileName));
  let totalBytes = 0;
  for (const fileName of files) {
    if (basename(fileName) !== fileName) throw new Error('动作文件必须直接放在动画包根目录。');
    if (!['.webp', '.png'].includes(extname(fileName).toLowerCase())) throw new Error('动作文件只支持 WebP 或 PNG。');
    const source = join(sourceDirectory, fileName);
    const info = await stat(source);
    if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error(`${fileName} 无效或超过 20 MB。`);
    const data = await readFile(source);
    const extension = extname(fileName).toLowerCase();
    const valid = extension === '.webp'
      ? data.length >= 16 && data.subarray(0, 4).toString('ascii') === 'RIFF'
        && data.subarray(8, 12).toString('ascii') === 'WEBP'
        && ['VP8 ', 'VP8L', 'VP8X'].includes(data.subarray(12, 16).toString('ascii'))
      : !nativeImage.createFromBuffer(data).isEmpty();
    if (!valid) throw new Error(`${fileName} 不是有效的 ${extension === '.webp' ? 'WebP' : 'PNG'} 图片。`);
    totalBytes += info.size;
  }
  if (totalBytes > 100 * 1024 * 1024) throw new Error('动画包总大小不能超过 100 MB。');
  const root = petPackRoot(character.id);
  let currentVersion = 0;
  try { currentVersion = Number((JSON.parse(await readFile(join(root, 'current.json'), 'utf8')) as { version: number }).version) || 0; }
  catch { /* First imported pack. */ }
  const version = currentVersion + 1;
  const destination = join(root, String(version));
  await mkdir(destination, { recursive: true });
  try {
    await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    for (const fileName of files) await copyFile(join(sourceDirectory, fileName), join(destination, fileName));
    await writeFile(join(root, 'current.json'), JSON.stringify({ version }), 'utf8');
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
  return readDesktopPetPack(character.id);
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
      setup: { modelConfigured: Boolean(await modelProfileRepository.get()) },
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

  ipcMain.handle(IPC_CHANNELS.conversationSearch, async (_event, input: unknown) => {
    const request = ConversationSearchInputSchema.parse(input);
    const character = await characterService.findCurrent();
    if (!character) return [];
    const conversation = await conversationRepository.findCurrent(character.id);
    if (!conversation) return [];
    return (await conversationRepository.searchMessages(conversation.id, request.query, request.limit)).map(toChatMessage);
  });

  ipcMain.handle(IPC_CHANNELS.companionSettingsGet, async () => {
    const stored = companionSettingsRepository.get();
    return CompanionSettingsSchema.parse({ enabled: stored.enabled,
      intervalMinutes: stored.intervalMinutes, quietStart: stored.quietStart, quietEnd: stored.quietEnd,
      desktopPetEnabled: stored.desktopPetEnabled });
  });

  ipcMain.handle(IPC_CHANNELS.companionSettingsSave, async (_event, input: unknown) => {
    const settings = CompanionSettingsSchema.parse(input);
    companionSettingsRepository.save(settings);
    syncDesktopPet(settings.desktopPetEnabled);
    return settings;
  });

  ipcMain.handle(IPC_CHANNELS.companionFocusMain, async () => focusMainWindow());
  ipcMain.handle(IPC_CHANNELS.companionClosePet, async () => {
    const stored = companionSettingsRepository.get();
    companionSettingsRepository.save({ ...stored, desktopPetEnabled: false });
    desktopPetWindow?.close();
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

  ipcMain.handle(IPC_CHANNELS.desktopPetPackGet, async () => {
    const character = await characterService.findCurrent();
    return character ? readDesktopPetPack(character.id) : null;
  });

  ipcMain.handle(IPC_CHANNELS.desktopPetPackImport, async () => {
    const character = await characterService.findCurrent();
    if (!character || !mainWindow) return null;
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: `为${character.name}选择桌宠动画包`, properties: ['openDirectory'],
    });
    const sourceDirectory = selection.filePaths[0];
    if (selection.canceled || !sourceDirectory) return readDesktopPetPack(character.id);
    const pack = await importDesktopPetPack(character, sourceDirectory);
    desktopPetWindow?.webContents.reload();
    return pack;
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

  ipcMain.handle(IPC_CHANNELS.dataExportBackup, async () => {
    if (!mainWindow) return null;
    const date = new Date().toISOString().slice(0, 10);
    const destination = await dialog.showSaveDialog(mainWindow, { title: '导出 AiLover 备份',
      defaultPath: join(app.getPath('documents'), `AiLover-backup-${date}.ailover-backup`),
      filters: [{ name: 'AiLover 备份', extensions: ['ailover-backup'] }] });
    if (destination.canceled || !destination.filePath) return null;
    const temporary = await mkdtemp(join(app.getPath('temp'), 'ailover-backup-'));
    try {
      const snapshotPath = join(temporary, 'ailover.sqlite');
      await createSanitizedDatabaseSnapshot(database, snapshotPath);
      const document = createBackupDocument({ appVersion: app.getVersion(), createdAt: new Date(),
        database: await readFile(snapshotPath), assets: await readAssetEntries(assetRoot) });
      await writeFile(destination.filePath, document, { encoding: 'utf8' });
      return DataOperationResultSchema.parse({ ok: true, message: '完整备份已导出，模型密钥未包含在内。',
        fileName: basename(destination.filePath), requiresRestart: false });
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });

  ipcMain.handle(IPC_CHANNELS.dataRestoreBackup, async () => {
    if (!mainWindow) return null;
    const selection = await dialog.showOpenDialog(mainWindow, { title: '选择 AiLover 备份',
      properties: ['openFile'], filters: [{ name: 'AiLover 备份', extensions: ['ailover-backup'] }] });
    const sourcePath = selection.filePaths[0];
    if (selection.canceled || !sourcePath) return null;
    if ((await stat(sourcePath)).size > 700 * 1024 * 1024) throw new Error('备份文件过大。');
    const parsed = parseBackupDocument(await readFile(sourcePath, 'utf8'));
    const temporary = await mkdtemp(join(app.getPath('temp'), 'ailover-restore-'));
    const stagedDatabase = join(temporary, 'ailover.sqlite');
    const stagedAssets = join(temporary, 'assets');
    try {
      await writeFile(stagedDatabase, parsed.database);
      await mkdir(stagedAssets, { recursive: true });
      for (const asset of parsed.assets) {
        const parts = asset.path.split('/').slice(1);
        const destination = join(stagedAssets, ...parts);
        await mkdir(resolve(destination, '..'), { recursive: true });
        await writeFile(destination, asset.data);
      }
      validateRestoredDatabase(stagedDatabase);
      prepareRestoredDatabase(stagedDatabase, assetRoot,
        new Set(parsed.assets.map(({ path }) => path)));
      validateRestoredDatabase(stagedDatabase);
      const confirmation = await dialog.showMessageBox(mainWindow, { type: 'warning',
        title: '恢复备份', message: '恢复将替换当前角色、聊天记录和本地资产。',
        detail: '模型密钥不会从备份恢复。完成后 AiLover 将重新启动。',
        buttons: ['取消', '恢复并重启'], defaultId: 0, cancelId: 0, noLink: true });
      if (confirmation.response !== 1) return null;
      for (const controller of activeChats.values()) controller.abort();
      const rollback = join(userDataPath, `restore-rollback-${randomUUID()}`);
      const rollbackDatabase = join(rollback, 'ailover.sqlite');
      const rollbackAssets = join(rollback, 'assets');
      await mkdir(rollback, { recursive: true });
      database.close();
      let assetsMoved = false;
      try {
        await copyFile(databasePath, rollbackDatabase);
        try { await rename(assetRoot, rollbackAssets); assetsMoved = true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await copyFile(stagedDatabase, databasePath);
        await rename(stagedAssets, assetRoot);
      } catch (error) {
        await copyFile(rollbackDatabase, databasePath).catch(() => undefined);
        if (assetsMoved) {
          await rm(assetRoot, { recursive: true, force: true }).catch(() => undefined);
          await rename(rollbackAssets, assetRoot).catch(() => undefined);
        }
        restartApplication();
        throw error;
      }
      await rm(rollback, { recursive: true, force: true })
        .catch((error: unknown) => logger.warn({ error }, 'Restore rollback cleanup failed'));
      const result = DataOperationResultSchema.parse({ ok: true,
        message: '备份验证并恢复完成，AiLover 正在重新启动。', fileName: basename(sourcePath),
        requiresRestart: true });
      restartApplication();
      return result;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });

  ipcMain.handle(IPC_CHANNELS.dataExportDiagnostics, async () => {
    if (!mainWindow) return null;
    const destination = await dialog.showSaveDialog(mainWindow, { title: '导出诊断信息',
      defaultPath: join(app.getPath('documents'), `AiLover-diagnostics-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'JSON 诊断文件', extensions: ['json'] }] });
    if (destination.canceled || !destination.filePath) return null;
    const counts = Object.fromEntries(['characters', 'conversations', 'messages', 'memories',
      'emotion_states', 'relationship_states', 'assets'].map((table) => {
      const row = database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      return [table, row.count];
    }));
    const modelProfile = await modelProfileRepository.get();
    const databaseSize = (await stat(databasePath)).size;
    const document = {
      format: 'ailover-diagnostics', version: 1, createdAt: new Date().toISOString(),
      application: { version: app.getVersion(), environment: config.environment,
        platform: process.platform, architecture: arch(), osRelease: release(),
        electronVersion: process.versions.electron, nodeVersion: process.versions.node,
        startupDurationMs },
      database: { schemaVersion: CURRENT_SCHEMA_VERSION, sizeBytes: databaseSize,
        integrity: (database.sqlite.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
        recordCounts: counts },
      configuration: { modelConfigured: Boolean(modelProfile), provider: modelProfile?.provider ?? null },
      privacy: { conversationBodiesIncluded: false, memoryBodiesIncluded: false,
        credentialsIncluded: false, localPathsIncluded: false },
    };
    await writeFile(destination.filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    return DataOperationResultSchema.parse({ ok: true,
      message: '诊断信息已导出，不包含对话正文、记忆正文、密钥或本地路径。',
      fileName: basename(destination.filePath), requiresRestart: false });
  });

  ipcMain.handle(IPC_CHANNELS.dataDeleteAll, async (_event, input: unknown) => {
    DeleteAllDataInputSchema.parse(input);
    if (!mainWindow) throw new Error('主窗口不可用。');
    const confirmation = await dialog.showMessageBox(mainWindow, { type: 'warning',
      title: '永久删除本地数据', message: '此操作无法撤销。',
      detail: '角色、聊天记录、记忆、关系状态、模型配置和本地角色图都会被删除。外部备份文件不会删除。',
      buttons: ['取消', '永久删除'], defaultId: 0, cancelId: 0, noLink: true });
    if (confirmation.response !== 1) return null;
    for (const controller of activeChats.values()) controller.abort();
    database.close();
    try {
      await rm(databasePath, { force: true });
      await rm(`${databasePath}-wal`, { force: true });
      await rm(`${databasePath}-shm`, { force: true });
      await rm(assetRoot, { recursive: true, force: true });
      await rm(join(userDataPath, 'logs'), { recursive: true, force: true });
    } finally { restartApplication(); }
    return DataOperationResultSchema.parse({ ok: true, message: '全部本地数据已删除，AiLover 正在重新启动。',
      fileName: '本地数据', requiresRestart: true });
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
  window.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window.hide();
  });
  window.once('closed', () => { if (mainWindow === window) mainWindow = null; });

  window.once('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  loadRendererWindow(window);

  return window;
}

function loadRendererWindow(window: BrowserWindow, pet = false): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    if (pet) url.searchParams.set('desktopPet', '1');
    void window.loadURL(url.toString());
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), pet ? { query: { desktopPet: '1' } } : undefined);
  }
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
}

function createDesktopPetWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 220, height: 280, minWidth: 180, minHeight: 220,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: true, show: false, hasShadow: false,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true },
  });
  desktopPetWindow = window;
  window.once('ready-to-show', () => window.showInactive());
  window.once('closed', () => { if (desktopPetWindow === window) desktopPetWindow = null; });
  loadRendererWindow(window, true);
  return window;
}

function syncDesktopPet(enabled: boolean): void {
  if (enabled && (!desktopPetWindow || desktopPetWindow.isDestroyed())) createDesktopPetWindow();
  if (!enabled && desktopPetWindow && !desktopPetWindow.isDestroyed()) desktopPetWindow.close();
}

function createTray(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'branding', 'app-icon.png')
    : join(app.getAppPath(), 'assets', 'branding', 'app-icon.png');
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 }));
  tray.setToolTip('AiLover');
  const rebuildMenu = () => {
    const settings = companionSettingsRepository.get();
    tray?.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 AiLover', click: () => focusMainWindow() },
      { label: '显示桌面角色', type: 'checkbox', checked: settings.desktopPetEnabled, click: (item) => {
        companionSettingsRepository.save({ ...settings, desktopPetEnabled: item.checked });
        syncDesktopPet(item.checked);
        rebuildMenu();
      } },
      { type: 'separator' },
      { label: '退出 AiLover', click: () => { isQuitting = true; app.quit(); } },
    ]));
  };
  rebuildMenu();
  tray.on('double-click', () => focusMainWindow());
}

async function evaluateCompanionPrompt(): Promise<void> {
  if (!Notification.isSupported()) return;
  const character = await characterService.findCurrent();
  if (!character) return;
  const conversation = await conversationRepository.findCurrent(character.id);
  const { lastPromptAt, ...settings } = companionSettingsRepository.get();
  const now = new Date();
  if (!shouldSendCompanionPrompt({ now, lastInteractionAt: conversation?.lastMessageAt ?? null,
    lastPromptAt, settings })) return;
  const notification = new Notification({ title: character.name, body: `${character.name}想和你聊聊天。` });
  notification.on('click', () => {
    focusMainWindow();
  });
  notification.show();
  companionSettingsRepository.recordPrompt(now);
}

void app.whenReady().then(async () => {
  registerIpcHandlers();
  createMainWindow();
  createTray();
  syncDesktopPet(companionSettingsRepository.get().desktopPetEnabled);
  startupDurationMs = Math.round(performance.now() - processStartedAt);
  logger.info({ appVersion: app.getVersion() }, 'AiLover started');
  const character = await characterService.findCurrent();
  if (character) {
    void memoryService.decay(character.id, new Date())
      .catch((error: unknown) => logger.warn({ error }, 'Memory decay maintenance failed'));
  }
  companionTimer = setInterval(() => {
    void evaluateCompanionPrompt().catch((error: unknown) => logger.warn({ error }, 'Companion prompt evaluation failed'));
  }, 60_000);
  companionTimer.unref();

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  // The tray owns the application lifetime. Users exit explicitly from its menu.
});

app.on('before-quit', () => {
  isQuitting = true;
  if (companionTimer) clearInterval(companionTimer);
  database.close();
});
