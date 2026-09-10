import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { app, BrowserWindow, ipcMain, shell } from 'electron';

import {
  BootstrapResponseSchema, CharacterDraftSchema, CharacterSnapshotSchema, IPC_CHANNELS,
} from '@ailover/contracts';
import { CharacterService } from '@ailover/application';
import { createCharacter, type Character } from '@ailover/domain';
import { createLogger } from '@ailover/observability';
import { openAppDatabase, SqliteCharacterRepository } from '@ailover/persistence';

import { loadAppConfig } from './config';

const config = loadAppConfig();
const logger = createLogger({ level: config.logLevel, environment: config.environment });
const isSmokeTest = process.argv.includes('--smoke-test');
let smokeTestCompleted = false;
const database = openAppDatabase(join(app.getPath('userData'), 'data', 'ailover.sqlite'));
const characterService = new CharacterService(new SqliteCharacterRepository(database));

function toCharacterSnapshot(character: Character) {
  return CharacterSnapshotSchema.parse({
    ...character,
    createdAt: character.createdAt.toISOString(),
    updatedAt: character.updatedAt.toISOString(),
  });
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
