import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { arch, release } from 'node:os';
import { basename, extname, join, resolve, sep } from 'node:path';

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, screen, shell, Tray } from 'electron';

import {
  BootstrapResponseSchema, CharacterDraftSchema, CharacterSnapshotSchema, ChatMessageSchema,
  ChatSendInputSchema, ChatSendReceiptSchema, ChatStreamEventSchema, ConversationHistorySchema,
  ConversationSnapshotSchema, ConversationContextInputSchema, ConversationSearchInputSchema, IPC_CHANNELS, ModelConnectionResultSchema, ModelProfileInputSchema,
  ModelProfileSnapshotSchema, RelationshipSummarySchema, CharacterVisualProfileSchema,
  DataOperationResultSchema, DeleteAllDataInputSchema, ImageCapabilitiesSchema, CompanionSettingsSchema,
  MemoryCorrectionSchema,
  CodexPetManifestSchema, DesktopPetPackManifestSchema, DesktopPetPackSchema,
  DesktopPetRuntimeStateSchema,
  type CodexPetManifest, type DesktopPetPackManifest,
  type ChatStreamEvent, type DesktopPetRuntimeState,
} from '@ailover/contracts';
import { createBackupDocument, parseBackupDocument, readAssetEntries } from '@ailover/backup';
import { analyzeInteraction, CognitionService, createResponsePlan, createSelfModelEntries, projectCognition,
  relationshipSummary, summarizePersonalityEvidence } from '@ailover/cognition';
import { assembleChatContext, CharacterService, fitDesktopPetBounds, shouldSendCompanionPrompt,
  readPngDimensions, readWebPDimensions, type StoredChatMessage,
  type StoredConversation } from '@ailover/application';
import { createCharacter, type Character } from '@ailover/domain';
import { advanceFutureIntentions, buildMemoryCenterEntries, EpisodicMemoryService,
  buildRelationshipTimeline, consolidateEpisodes, intentionsFromMemories, MemoryService,
  type ConsolidatedMemory, type RecalledEpisode,
  type RecalledMemory } from '@ailover/memory';
import { inferImageCapabilities, ModelGatewayError, probeModelProvider,
  streamModelChat } from '@ailover/model-gateway';
import { createLogger } from '@ailover/observability';
import { createSanitizedDatabaseSnapshot, CURRENT_SCHEMA_VERSION, openAppDatabase, prepareRestoredDatabase,
  SqliteCharacterRepository, SqliteCognitionRepository, SqliteConversationRepository,
  SqliteMemoryRepository, SqliteModelProfileRepository, SqliteCompanionSettingsRepository,
  SqliteEpisodicMemoryRepository,
  SqliteConsolidatedMemoryRepository,
  SqliteFutureIntentionRepository,
  SqliteSelfModelRepository,
  SqliteDesktopPetWindowStateRepository,
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
const desktopPetWindowStateRepository = new SqliteDesktopPetWindowStateRepository(database);
const memoryRepository = new SqliteMemoryRepository(database);
const futureIntentionRepository = new SqliteFutureIntentionRepository(database);
const memoryService = new MemoryService({ repository: memoryRepository,
  idGenerator: { next: randomUUID } });
const episodicMemoryRepository = new SqliteEpisodicMemoryRepository(database);
const episodicMemoryService = new EpisodicMemoryService({
  repository: episodicMemoryRepository, idGenerator: { next: randomUUID },
});
const consolidatedMemoryRepository = new SqliteConsolidatedMemoryRepository(database);
const selfModelRepository = new SqliteSelfModelRepository(database);
const cognitionRepository = new SqliteCognitionRepository(database);
const cognitionService = new CognitionService(cognitionRepository,
  { next: randomUUID });
const visualAssetRepository = new SqliteVisualAssetRepository(database);
const assetRoot = join(userDataPath, 'assets');
const recommendedPetActions = ['idle', 'walk-left', 'walk-right', 'greet', 'happy', 'thinking', 'sleep'] as const;
const activeChats = new Map<string, AbortController>();
let mainWindow: BrowserWindow | null = null;
let desktopPetWindow: BrowserWindow | null = null;
let companionTimer: NodeJS.Timeout | null = null;
let desktopPetReactionTimer: NodeJS.Timeout | null = null;
let desktopPetMoveTimer: NodeJS.Timeout | null = null;
let desktopPetRoamTimer: NodeJS.Timeout | null = null;
let desktopPetRoamAnimation: NodeJS.Timeout | null = null;
let desktopPetBoundsSaveTimer: NodeJS.Timeout | null = null;
let desktopPetSleepTimer: NodeJS.Timeout | null = null;
let desktopPetActivityState: DesktopPetRuntimeState = 'idle';
let lastDesktopPetMoveAt = 0;
let lastDesktopPetActivityAt = Date.now();
let desktopPetInteractionCount = 0;
let desktopPetIsRoaming = false;
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
  const parsed = ChatStreamEventSchema.parse(event);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.chatStream, parsed);
  }
  if (desktopPetWindow && !desktopPetWindow.isDestroyed()) {
    desktopPetWindow.webContents.send(IPC_CHANNELS.chatStream, parsed);
  }
}

function emitDesktopPetState(state: DesktopPetRuntimeState): void {
  if (desktopPetWindow && !desktopPetWindow.isDestroyed()) {
    desktopPetWindow.webContents.send(
      IPC_CHANNELS.desktopPetStateChanged,
      DesktopPetRuntimeStateSchema.parse(state),
    );
  }
}

function setDesktopPetActivity(state: DesktopPetRuntimeState, resetAfterMs?: number): void {
  if (desktopPetReactionTimer) clearTimeout(desktopPetReactionTimer);
  if (state !== 'sleeping') lastDesktopPetActivityAt = Date.now();
  desktopPetActivityState = state;
  emitDesktopPetState(state);
  if (resetAfterMs) {
    desktopPetReactionTimer = setTimeout(() => {
      desktopPetReactionTimer = null;
      desktopPetActivityState = 'idle';
      emitDesktopPetState('idle');
    }, resetAfterMs);
    desktopPetReactionTimer.unref();
  }
}

function stopDesktopPetRoamAnimation(): void {
  if (desktopPetRoamAnimation) clearInterval(desktopPetRoamAnimation);
  desktopPetRoamAnimation = null;
  desktopPetIsRoaming = false;
}

function strollDesktopPet(): void {
  const window = desktopPetWindow;
  if (!window || window.isDestroyed() || desktopPetActivityState !== 'idle'
    || Date.now() - lastDesktopPetMoveAt < 1_000) return;
  const bounds = window.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const minimumX = workArea.x;
  const maximumX = workArea.x + workArea.width - bounds.width;
  if (maximumX <= minimumX) return;
  const roomLeft = bounds.x - minimumX;
  const roomRight = maximumX - bounds.x;
  const direction = roomRight < 90 ? -1 : roomLeft < 90 ? 1 : Math.random() < 0.5 ? -1 : 1;
  const distance = Math.min(80 + Math.round(Math.random() * 100), direction > 0 ? roomRight : roomLeft);
  if (distance < 24) return;
  const startX = bounds.x;
  const targetX = startX + direction * distance;
  const startedAt = Date.now();
  const duration = 1_400;
  stopDesktopPetRoamAnimation();
  desktopPetIsRoaming = true;
  desktopPetRoamAnimation = setInterval(() => {
    if (!desktopPetWindow || desktopPetWindow.isDestroyed() || desktopPetActivityState !== 'idle') {
      stopDesktopPetRoamAnimation();
      return;
    }
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = 0.5 - Math.cos(progress * Math.PI) / 2;
    desktopPetWindow.setPosition(Math.round(startX + (targetX - startX) * eased), bounds.y, false);
    if (progress >= 1) stopDesktopPetRoamAnimation();
  }, 32);
  desktopPetRoamAnimation.unref();
}

function persistDesktopPetBounds(window: BrowserWindow): void {
  if (desktopPetBoundsSaveTimer) clearTimeout(desktopPetBoundsSaveTimer);
  desktopPetBoundsSaveTimer = setTimeout(() => {
    desktopPetBoundsSaveTimer = null;
    if (!window.isDestroyed()) desktopPetWindowStateRepository.save(window.getBounds());
  }, 250);
  desktopPetBoundsSaveTimer.unref();
}

function evaluateDesktopPetSleep(): void {
  if (desktopPetActivityState === 'idle' && Date.now() - lastDesktopPetActivityAt >= 10 * 60_000) {
    stopDesktopPetRoamAnimation();
    setDesktopPetActivity('sleeping');
  }
}

function syncDesktopPetRoaming(enabled: boolean): void {
  if (desktopPetRoamTimer) clearInterval(desktopPetRoamTimer);
  desktopPetRoamTimer = null;
  stopDesktopPetRoamAnimation();
  if (!enabled) return;
  desktopPetRoamTimer = setInterval(strollDesktopPet, 24_000);
  desktopPetRoamTimer.unref();
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
  try {
    const atlasManifest = CodexPetManifestSchema.parse(
      JSON.parse(await readFile(join(directory, 'pet.json'), 'utf8')),
    );
    const fileName = atlasManifest.spritesheetPath;
    if (basename(fileName) !== fileName) throw new Error('图集文件必须直接放在桌宠素材包根目录。');
    const extension = extname(fileName).toLowerCase();
    const mimeType = extension === '.webp' ? 'image/webp' : extension === '.png' ? 'image/png' : null;
    if (!mimeType) throw new Error('Codex v2 图集只支持 WebP 或 PNG。');
    const data = await readFile(join(directory, fileName));
    const mode = atlasManifest.spriteVersionNumber === 2 ? 'codex-v2' : 'codex-v1';
    return DesktopPetPackSchema.parse({ version: pointer.version, mode,
      availableActions: [], missingRecommended: [], actionDataUrls: {},
      atlas: { id: atlasManifest.id, displayName: atlasManifest.displayName,
        description: atlasManifest.description, spriteVersionNumber: atlasManifest.spriteVersionNumber,
        dataUrl: `data:${mimeType};base64,${data.toString('base64')}` },
      message: `已启用 Codex v${atlasManifest.spriteVersionNumber} 动画图集版本 ${pointer.version}` });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
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
  return DesktopPetPackSchema.parse({ version: pointer.version, mode: 'actions', availableActions,
    missingRecommended: recommendedPetActions.filter((action) => !availableActions.includes(action)),
    actionDataUrls, message: `已启用动画包版本 ${pointer.version}` });
}

function isAnimatedWebP(data: Buffer): boolean {
  if (data.length < 20 || data.subarray(0, 4).toString('ascii') !== 'RIFF'
    || data.subarray(8, 12).toString('ascii') !== 'WEBP') return false;
  let offset = 12;
  while (offset + 8 <= data.length) {
    const chunk = data.subarray(offset, offset + 4).toString('ascii');
    if (chunk === 'ANIM' || chunk === 'ANMF') return true;
    const size = data.readUInt32LE(offset + 4);
    offset += 8 + size + (size % 2);
  }
  return false;
}

async function validateCodexPetAtlas(sourceDirectory: string, manifest: CodexPetManifest): Promise<number> {
  const fileName = manifest.spritesheetPath;
  if (basename(fileName) !== fileName) throw new Error('spritesheetPath 必须是素材包根目录中的文件名。');
  const extension = extname(fileName).toLowerCase();
  if (!['.webp', '.png'].includes(extension)) throw new Error('Codex v2 图集只支持 WebP 或 PNG。');
  const source = join(sourceDirectory, fileName);
  const info = await stat(source);
  if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new Error(`${fileName} 无效或超过 100 MB。`);
  const data = await readFile(source);
  if (extension === '.webp' && isAnimatedWebP(data)) throw new Error('Codex v2 spritesheet.webp 必须是静态图集，不能是动画 WebP。');
  const size = extension === '.webp' ? readWebPDimensions(data) : readPngDimensions(data);
  if (!size) throw new Error(`${fileName} 不是有效的图片。`);
  const expectedHeight = manifest.spriteVersionNumber === 2 ? 2288 : 1872;
  if (size.width !== 1536 || size.height !== expectedHeight) {
    throw new Error(`Codex v${manifest.spriteVersionNumber} 图集尺寸必须是 1536 x ${expectedHeight}，当前为 ${size.width} x ${size.height}。`);
  }
  return info.size;
}

async function importDesktopPetPack(character: Character, sourceDirectory: string) {
  const codexManifestPath = join(sourceDirectory, 'pet.json');
  let codexManifest: CodexPetManifest | null = null;
  try {
    if ((await stat(codexManifestPath)).size > 100 * 1024) throw new Error('pet.json 不能超过 100 KB。');
    codexManifest = CodexPetManifestSchema.parse(JSON.parse(await readFile(codexManifestPath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (codexManifest) {
    await validateCodexPetAtlas(sourceDirectory, codexManifest);
    const root = petPackRoot(character.id);
    let currentVersion = 0;
    try { currentVersion = Number((JSON.parse(await readFile(join(root, 'current.json'), 'utf8')) as { version: number }).version) || 0; }
    catch { /* First imported pack. */ }
    const version = currentVersion + 1;
    const destination = join(root, String(version));
    await mkdir(destination, { recursive: true });
    try {
      await writeFile(join(destination, 'pet.json'), JSON.stringify(codexManifest, null, 2), 'utf8');
      await copyFile(join(sourceDirectory, codexManifest.spritesheetPath),
        join(destination, codexManifest.spritesheetPath));
      await writeFile(join(root, 'current.json'), JSON.stringify({ version }), 'utf8');
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
    return readDesktopPetPack(character.id);
  }

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

  ipcMain.handle(IPC_CHANNELS.memoryList, async () => {
    const current = await characterService.findCurrent();
    if (!current) return [];
    const memories = await memoryRepository.listForCenter(current.id);
    return Promise.all(buildMemoryCenterEntries(memories).map(async (memory) => {
      const source = await memoryRepository.getPrimarySource(current.id, memory.id);
      return { ...memory, firstSeenAt: memory.firstSeenAt.toISOString(),
        lastSeenAt: memory.lastSeenAt.toISOString(), expiresAt: memory.expiresAt?.toISOString() ?? null,
        source: source ? { ...source, createdAt: source.createdAt.toISOString() } : null };
    }));
  });
  ipcMain.handle(IPC_CHANNELS.memoryCorrect, async (_event, input: unknown) => {
    const value = MemoryCorrectionSchema.parse(input);
    const current = await characterService.findCurrent();
    if (!current || !(await memoryRepository.correct(current.id, value.id, value.content, value.importance, new Date()))) {
      throw new Error('记忆不存在或不属于当前角色');
    }
  });
  ipcMain.handle(IPC_CHANNELS.memoryDelete, async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('无效的记忆标识');
    const current = await characterService.findCurrent();
    if (!current || !(await memoryRepository.softDelete(current.id, id))) {
      throw new Error('记忆不存在或不属于当前角色');
    }
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

  ipcMain.handle(IPC_CHANNELS.conversationContext, async (_event, input: unknown) => {
    const request = ConversationContextInputSchema.parse(input);
    const character = await characterService.findCurrent();
    if (!character) return ConversationHistorySchema.parse({ conversation: null, messages: [] });
    const conversation = await conversationRepository.findCurrent(character.id);
    if (!conversation) return ConversationHistorySchema.parse({ conversation: null, messages: [] });
    const messages = await conversationRepository.listMessagesAround(conversation.id, request.messageId, 25);
    return ConversationHistorySchema.parse({ conversation: toConversationSnapshot(conversation),
      messages: messages.map(toChatMessage) });
  });

  ipcMain.handle(IPC_CHANNELS.companionSettingsGet, async () => {
    const stored = companionSettingsRepository.get();
    return CompanionSettingsSchema.parse({ enabled: stored.enabled,
      intervalMinutes: stored.intervalMinutes, quietStart: stored.quietStart, quietEnd: stored.quietEnd,
      desktopPetEnabled: stored.desktopPetEnabled,
      desktopPetRoamingEnabled: stored.desktopPetRoamingEnabled });
  });

  ipcMain.handle(IPC_CHANNELS.companionSettingsSave, async (_event, input: unknown) => {
    const settings = CompanionSettingsSchema.parse(input);
    companionSettingsRepository.save(settings);
    syncDesktopPet(settings.desktopPetEnabled);
    syncDesktopPetRoaming(settings.desktopPetEnabled && settings.desktopPetRoamingEnabled);
    return settings;
  });

  ipcMain.handle(IPC_CHANNELS.companionFocusMain, async () => focusMainWindow());
  ipcMain.handle(IPC_CHANNELS.desktopPetStateGet, async () => desktopPetActivityState);
  ipcMain.handle(IPC_CHANNELS.companionInteractPet, async () => {
    desktopPetInteractionCount += 1;
    setDesktopPetActivity(desktopPetInteractionCount % 2 ? 'jumping' : 'waving', 2_400);
  });
  ipcMain.handle(IPC_CHANNELS.companionClosePet, async () => {
    const stored = companionSettingsRepository.get();
    companionSettingsRepository.save({ ...stored, desktopPetEnabled: false });
    syncDesktopPetRoaming(false);
    desktopPetWindow?.close();
  });

  ipcMain.handle(IPC_CHANNELS.chatSend, async (_event, input: unknown) => {
    const request = ChatSendInputSchema.parse(input);
    if (activeChats.size > 0) throw new Error('当前回复尚未完成，请稍候。');
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
    setDesktopPetActivity('waiting');
    setImmediate(() => void completeChat(
      requestId, character, userMessage, assistantMessage, controller.signal,
    ));
    const receipt = ChatSendReceiptSchema.parse({ requestId, userMessage: toChatMessage(userMessage),
      assistantMessage: toChatMessage(assistantMessage) });
    emitChatEvent({ type: 'started', ...receipt });
    return receipt;
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
  ipcMain.handle(IPC_CHANNELS.relationshipGetTimeline, async () => {
    const current = await characterService.findCurrent();
    if (!current) return [];
    const episodes = await episodicMemoryRepository.searchCandidates(current.id, '', true, 100);
    return buildRelationshipTimeline(episodes).map((milestone) => ({ ...milestone,
      occurredAt: milestone.occurredAt.toISOString() }));
  });
  ipcMain.handle(IPC_CHANNELS.personalityEvidenceGet, async () => {
    const current = await characterService.findCurrent();
    if (!current) return [];
    const evidence = await cognitionRepository.listEvidence(current.id);
    return summarizePersonalityEvidence(evidence).map((summary) => ({ ...summary,
      latest: summary.latest.map(({ direction, sourceMessageId, reason, recordedAt }) =>
        ({ direction, sourceMessageId, reason, recordedAt: recordedAt.toISOString() })) }));
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
    const counts = Object.fromEntries(['characters', 'conversations', 'messages', 'memories', 'episodic_memories',
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
        episodeBodiesIncluded: false, credentialsIncluded: false, localPathsIncluded: false },
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
  let completedSuccessfully = false;
  let episodeEmotion = '';
  let relatedMemoryIds: string[] = [];
  let isFirstConversationTurn = false;
  let completionReaction: DesktopPetRuntimeState = 'review';
  let triggeredIntentionIds: string[] = [];
  try {
    const history = await conversationRepository.listMessages(assistantMessage.conversationId);
    isFirstConversationTurn = history.filter(({ role }) => role === 'user').length === 1;
    await futureIntentionRepository.expireBefore(character.id, userMessage.createdAt);
    const pendingIntentions = await futureIntentionRepository.listPending(character.id, userMessage.createdAt);
    const advancedIntentions = advanceFutureIntentions(pendingIntentions, userMessage.createdAt,
      { returned: !isFirstConversationTurn, text: userMessage.content });
    const triggeredIntentions = advancedIntentions.filter(({ status }) => status === 'triggered');
    triggeredIntentionIds = triggeredIntentions.map(({ id }) => id);
    let consolidatedMemories: ConsolidatedMemory[] = [];
    try {
      consolidatedMemories = await consolidatedMemoryRepository.listActive(character.id);
    } catch (error) {
      logger.warn({ error }, 'Consolidated memory recall failed; continuing without insights');
    }
    let recalled: RecalledMemory[] = [];
    try {
      recalled = await memoryService.recall({ characterId: character.id, queryMessageId: userMessage.id,
        query: userMessage.content, now: userMessage.createdAt });
    } catch (error) {
      logger.warn({ error }, 'Memory recall failed; continuing without recalled context');
    }
    relatedMemoryIds = recalled.map(({ id }) => id);
    let recalledEpisodes: RecalledEpisode[] = [];
    try {
      recalledEpisodes = await episodicMemoryService.recall({ characterId: character.id,
        queryMessageId: userMessage.id, query: userMessage.content, now: userMessage.createdAt });
    } catch (error) {
      logger.warn({ error }, 'Episode recall failed; continuing without recalled experiences');
    }
    const cognition = await cognitionService.processInteraction({ characterId: character.id,
      baseline: character.personalityBaseline, sourceMessageId: userMessage.id,
      text: userMessage.content, now: userMessage.createdAt,
      emotionalAssociations: recalledEpisodes.map((episode) => ({ relevance: episode.score,
        emotionalWeight: episode.emotionalWeight, userEmotion: episode.userEmotion,
        relationshipRelevance: episode.relationshipRelevance })) });
    const interaction = analyzeInteraction(userMessage.content);
    const responsePlan = createResponsePlan(cognition, interaction);
    try {
      const entries = createSelfModelEntries(cognition, interaction,
        { idGenerator: { next: randomUUID }, sourceMessageId: userMessage.id, now: userMessage.createdAt });
      for (const entry of entries) await selfModelRepository.saveIfNew(entry);
    } catch (error) {
      logger.warn({ error }, 'Self model persistence failed');
    }
    let persistedSelfModel = responsePlan.selfProjection;
    try {
      const entries = await selfModelRepository.listActive(character.id, 4);
      if (entries.length) persistedSelfModel = entries.map(({ statement }) => statement);
    } catch (error) {
      logger.warn({ error }, 'Self model recall failed; using current projection');
    }
    if (interaction.reasons.includes('received positive affection')) completionReaction = 'jumping';
    const personalityContext = responsePlan.personalityProjection.length
      ? `当前人格表达倾向：\n- ${responsePlan.personalityProjection.join('\n- ')}` : '';
    const selfContext = persistedSelfModel.length
      ? `当前自我认识：\n- ${persistedSelfModel.join('\n- ')}` : '';
    const intentionContext = triggeredIntentions.length
      ? `可以自然关心但不要假设结果：\n- ${triggeredIntentions.map(({ description }) => description).join('\n- ')}` : '';
    const insightContext = consolidatedMemories.length
      ? `从多次真实经历中形成的谨慎认识，仅在相关时参考：\n- ${consolidatedMemories.slice(0, 4).map(({ statement }) => statement).join('\n- ')}` : '';
    const cognitionContext = [projectCognition(cognition),
      `回复语气：${responsePlan.tone.join('、')}。${responsePlan.guidance}`,
      personalityContext, selfContext, intentionContext, insightContext].filter(Boolean).join('\n');
    episodeEmotion = projectCognition(cognition);
    const profile = await modelProfileRepository.get();
    if (!profile) throw new ModelGatewayError('请先在设置中配置聊天模型。', false);
    const apiKey = decryptApiKey(profile.encryptedApiKey);
    for await (const delta of streamModelChat({ provider: profile.provider, endpoint: profile.endpoint,
      model: profile.model, messages: assembleChatContext(
        character, history, 12_000, recalled, cognitionContext, recalledEpisodes,
      ), signal,
      ...(apiKey ? { apiKey } : {}) })) {
      if (!content) setDesktopPetActivity('running');
      content += delta;
      emitChatEvent({ type: 'chunk', requestId, messageId: assistantMessage.id, delta });
    }
    if (!content.trim()) throw new ModelGatewayError('模型没有返回内容，请重试。', true);
    await conversationRepository.updateMessage(assistantMessage.id,
      { content, status: 'completed', model: profile.model });
    completedSuccessfully = true;
    try {
      await Promise.all(triggeredIntentionIds.map((id) => futureIntentionRepository.updateStatus(id, 'completed')));
    } catch (error) {
      logger.warn({ error }, 'Future intention completion failed');
    }
    const completed = { ...assistantMessage, content, status: 'completed' as const, model: profile.model };
    emitChatEvent({ type: 'completed', requestId, message: toChatMessage(completed) });
    setDesktopPetActivity(completionReaction, 3_000);
  } catch (error) {
    const cancelled = signal.aborted;
    const status = cancelled ? 'cancelled' as const : 'failed' as const;
    await conversationRepository.updateMessage(assistantMessage.id, { content, status });
    const message = toChatMessage({ ...assistantMessage, content, status });
    if (cancelled) {
      emitChatEvent({ type: 'cancelled', requestId, message });
      setDesktopPetActivity('idle');
    } else {
      emitChatEvent({ type: 'failed', requestId, message,
        error: error instanceof ModelGatewayError ? error.message : '生成回复失败，请稍后重试。',
        retryable: error instanceof ModelGatewayError ? error.retryable : true });
      setDesktopPetActivity('failed', 4_000);
    }
  } finally {
    try {
      await memoryService.capture({ userId: 'local-user', characterId: character.id,
        messageId: userMessage.id, text: userMessage.content, now: userMessage.createdAt });
      const activeMemories = await memoryRepository.listActive(character.id);
      const generated = intentionsFromMemories(activeMemories, { next: randomUUID }, userMessage.createdAt);
      for (const intention of generated) {
        const sourceId = intention.sourceMemoryIds[0];
        if (sourceId && !(await futureIntentionRepository.hasForSourceMemory(sourceId))) {
          await futureIntentionRepository.save(character.id, intention);
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Memory capture failed');
    }
    let capturedEpisode = null;
    try {
      capturedEpisode = await episodicMemoryService.capture({ characterId: character.id, characterName: character.name,
        conversationId: assistantMessage.conversationId, userMessageId: userMessage.id,
        userText: userMessage.content, ...(completedSuccessfully
          ? { aiMessageId: assistantMessage.id, aiText: content } : {}),
        ...(episodeEmotion ? { aiEmotion: episodeEmotion } : {}),
        relatedMemoryIds, isFirstConversationTurn,
        now: userMessage.createdAt });
    } catch (error) {
      logger.warn({ error }, 'Episode capture failed');
    }
    if (capturedEpisode) {
      try {
        const episodes = await episodicMemoryRepository.searchCandidates(character.id, '', true, 100);
        const insights = consolidateEpisodes(episodes, { next: randomUUID }, userMessage.createdAt);
        for (const insight of insights) {
          await consolidatedMemoryRepository.saveOrReinforce(character.id, insight);
        }
      } catch (error) {
        logger.warn({ error }, 'Memory consolidation failed');
      }
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
  if (desktopPetActivityState === 'sleeping') setDesktopPetActivity('waving', 2_400);
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
}

function createDesktopPetWindow(): BrowserWindow {
  const savedBounds = desktopPetWindowStateRepository.get();
  const display = savedBounds ? screen.getDisplayMatching(savedBounds) : screen.getPrimaryDisplay();
  const bounds = fitDesktopPetBounds(savedBounds, display.workArea);
  const window = new BrowserWindow({
    ...bounds, minWidth: 180, minHeight: 300,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: true, show: false, hasShadow: false,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true },
  });
  desktopPetWindow = window;
  let previousX = window.getBounds().x;
  window.on('move', () => {
    const currentX = window.getBounds().x;
    const delta = currentX - previousX;
    previousX = currentX;
    lastDesktopPetMoveAt = Date.now();
    if (!desktopPetIsRoaming) {
      lastDesktopPetActivityAt = Date.now();
      if (desktopPetActivityState === 'sleeping') setDesktopPetActivity('idle');
    }
    if (Math.abs(delta) >= 1) emitDesktopPetState(delta > 0 ? 'running-right' : 'running-left');
    if (desktopPetMoveTimer) clearTimeout(desktopPetMoveTimer);
    desktopPetMoveTimer = setTimeout(() => {
      desktopPetMoveTimer = null;
      emitDesktopPetState(desktopPetActivityState);
    }, 180);
    desktopPetMoveTimer.unref();
    persistDesktopPetBounds(window);
  });
  window.on('resize', () => persistDesktopPetBounds(window));
  window.on('close', () => {
    if (!window.isDestroyed()) desktopPetWindowStateRepository.save(window.getBounds());
  });
  window.once('ready-to-show', () => window.showInactive());
  window.once('closed', () => {
    if (desktopPetMoveTimer) clearTimeout(desktopPetMoveTimer);
    if (desktopPetBoundsSaveTimer) clearTimeout(desktopPetBoundsSaveTimer);
    desktopPetBoundsSaveTimer = null;
    desktopPetMoveTimer = null;
    if (desktopPetWindow === window) desktopPetWindow = null;
  });
  window.webContents.on('context-menu', () => {
    const settings = companionSettingsRepository.get();
    Menu.buildFromTemplate([
      { label: '打开 AiLover', click: () => focusMainWindow() },
      { label: '和角色互动', click: () => {
        desktopPetInteractionCount += 1;
        setDesktopPetActivity(desktopPetInteractionCount % 2 ? 'jumping' : 'waving', 2_400);
      } },
      { type: 'separator' },
      { label: '允许自主散步', type: 'checkbox', checked: settings.desktopPetRoamingEnabled,
        click: (item) => {
          companionSettingsRepository.save({ ...settings, desktopPetRoamingEnabled: item.checked });
          syncDesktopPetRoaming(item.checked);
        } },
      { label: '隐藏桌面角色', click: () => {
        companionSettingsRepository.save({ ...settings, desktopPetEnabled: false });
        syncDesktopPetRoaming(false);
        window.close();
      } },
    ]).popup({ window });
  });
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
        syncDesktopPetRoaming(item.checked && settings.desktopPetRoamingEnabled);
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
  setDesktopPetActivity('waving', 3_000);
  companionSettingsRepository.recordPrompt(now);
}

void app.whenReady().then(async () => {
  registerIpcHandlers();
  createMainWindow();
  createTray();
  const companionSettings = companionSettingsRepository.get();
  syncDesktopPet(companionSettings.desktopPetEnabled);
  syncDesktopPetRoaming(companionSettings.desktopPetEnabled && companionSettings.desktopPetRoamingEnabled);
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
  desktopPetSleepTimer = setInterval(evaluateDesktopPetSleep, 60_000);
  desktopPetSleepTimer.unref();

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
  if (desktopPetReactionTimer) clearTimeout(desktopPetReactionTimer);
  if (desktopPetMoveTimer) clearTimeout(desktopPetMoveTimer);
  if (desktopPetRoamTimer) clearInterval(desktopPetRoamTimer);
  if (desktopPetBoundsSaveTimer) clearTimeout(desktopPetBoundsSaveTimer);
  if (desktopPetSleepTimer) clearInterval(desktopPetSleepTimer);
  stopDesktopPetRoamAnimation();
  database.close();
});
