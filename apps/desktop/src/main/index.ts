import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';

import {
  BootstrapResponseSchema, CharacterDraftSchema, CharacterSnapshotSchema, IPC_CHANNELS,
  ModelConnectionResultSchema, ModelProfileInputSchema, ModelProfileSnapshotSchema,
} from '@ailover/contracts';
import { CharacterService } from '@ailover/application';
import { createCharacter, type Character } from '@ailover/domain';
import { probeModelProvider } from '@ailover/model-gateway';
import { createLogger } from '@ailover/observability';
import {
  openAppDatabase, SqliteCharacterRepository, SqliteModelProfileRepository,
} from '@ailover/persistence';

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
        chat: false,
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
