import { join } from 'node:path';

import { app, BrowserWindow, ipcMain, shell } from 'electron';

import { BootstrapResponseSchema, IPC_CHANNELS } from '@ailover/contracts';
import { createLogger } from '@ailover/observability';

import { loadAppConfig } from './config';

const config = loadAppConfig();
const logger = createLogger({ level: config.logLevel, environment: config.environment });

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appBootstrap, () =>
    BootstrapResponseSchema.parse({
      appVersion: app.getVersion(),
      platform: process.platform,
      environment: config.environment,
      dataPath: app.getPath('userData'),
      capabilities: {
        character: false,
        chat: false,
        memory: false,
      },
    }),
  );
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
      preload: join(__dirname, '../preload/index.mjs'),
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
