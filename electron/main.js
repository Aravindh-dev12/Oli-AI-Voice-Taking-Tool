import 'dotenv/config';
import { app, BrowserWindow, Tray, Menu, screen, ipcMain, globalShortcut, nativeImage } from 'electron';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server/index.js';
import { createLogger } from '../server/logger.js';
import { createNativeCaptureManager } from './native-capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const DB_PATH = path.resolve(app.getPath('userData'), process.env.DB_PATH || 'data/oli.db');
const CONFIG_PATH = path.resolve(app.getPath('userData'), process.env.CONFIG_PATH || 'data/config.json');

let notchWin, dashboardWin, tray, serverInstance, httpServer;
let meetingActive = false;
let nativeCapture;

const logger = createLogger('desktop');
let notchGeometry = null;

const BASE_SIZE = {
  pill: { w: 236, h: 34 },
  flare: { w: 480, h: 50 },
  shelf: { w: 560, h: 320 }
};

function probeNotchGeometry() {
  if (process.platform !== 'darwin') return null;
  const candidates = [
    path.join(process.resourcesPath, 'native', 'OliNotchGeometry'),
    path.join(__dirname, '..', 'native', 'macos', '.build', 'release', 'OliNotchGeometry')
  ];
  const binary = candidates.find((p) => fs.existsSync(p));
  if (!binary) return null;
  try {
    const result = spawnSync(binary, ['--geometry'], { encoding: 'utf8', timeout: 1500 });
    if (result.status !== 0 || !result.stdout?.trim()) return null;
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function sizes() {
  const physicalNotch = notchGeometry?.notchWidth;
  const pillWidth = physicalNotch && physicalNotch >= 160 && physicalNotch <= 320
    ? Math.round(physicalNotch)
    : BASE_SIZE.pill.w;
  return { ...BASE_SIZE, pill: { ...BASE_SIZE.pill, w: pillWidth } };
}

function primaryDisplay() {
  return screen.getPrimaryDisplay();
}

function topCenterBounds(w, h) {
  const { bounds } = primaryDisplay();
  return {
    x: Math.round(bounds.x + (bounds.width - w) / 2),
    y: bounds.y,
    width: w,
    height: h
  };
}

function resizeNotch(state = 'pill') {
  if (!notchWin || notchWin.isDestroyed()) return;
  const s = sizes()[state] || sizes().pill;
  notchWin.setBounds(topCenterBounds(s.w, s.h));
}

function createNotchWindow() {
  notchGeometry = probeNotchGeometry();
  notchWin = new BrowserWindow({
    ...topCenterBounds(sizes().pill.w, sizes().pill.h),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  notchWin.setAlwaysOnTop(true, 'screen-saver');
  notchWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  notchWin.setContentProtection(true);
  notchWin.loadURL(`http://127.0.0.1:${PORT}/notch.html`);
  notchWin.on('closed', () => (notchWin = null));
}

function openDashboard() {
  if (dashboardWin) return dashboardWin.focus();
  dashboardWin = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 760,
    minHeight: 480,
    title: 'Oli — Dashboard',
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  dashboardWin.setMenuBarVisibility(false);
  dashboardWin.loadURL(`http://127.0.0.1:${PORT}/dashboard.html`);
  dashboardWin.on('closed', () => (dashboardWin = null));
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Oli — sovereign meeting copilot');
  refreshTrayMenu();
  tray.on('click', openDashboard);
}

function refreshTrayMenu() {
  const menu = Menu.buildFromTemplate([
    { label: 'Open dashboard', click: openDashboard },
    { type: 'separator' },
    {
      label: meetingActive ? 'End meeting' : 'Start meeting',
      click: () => notchWin?.webContents.send('oli:tray-toggle-meeting')
    },
    { type: 'separator' },
    { label: 'Quit Oli', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

async function boot() {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  serverInstance = createServer({ dbPath: DB_PATH, configPath: CONFIG_PATH });
  await new Promise((resolve, reject) => {
    httpServer = serverInstance.app.listen(PORT, '127.0.0.1', resolve);
    httpServer.on('error', reject);
  });
  logger.info('local server ready', { port: PORT });
  nativeCapture = createNativeCaptureManager({
    port: PORT,
    onError: (message) => notchWin?.webContents.send('oli:native-capture-error', { message })
  });
  createNotchWindow();
  buildTray();
  globalShortcut.register('Alt+Space', () => notchWin?.webContents.send('oli:toggle-pin'));
}

app.whenReady().then(boot).catch((error) => {
  console.error('Oli failed to boot:', error);
  app.quit();
});

ipcMain.on('oli:resize', (_e, state) => resizeNotch(state));
ipcMain.on('oli:open-dashboard', openDashboard);
ipcMain.on('oli:meeting-state', (_e, active) => {
  meetingActive = !!active;
  refreshTrayMenu();
});
ipcMain.handle('oli:platform', () => process.platform);
ipcMain.handle('oli:native-capture-available', () => nativeCapture?.available() ?? false);
ipcMain.handle('oli:native-capture-start', async (_event, meetingId) => {
  if (process.platform !== 'darwin') return { active: false, reason: 'unsupported-platform' };
  return nativeCapture.start(String(meetingId));
});
ipcMain.handle('oli:native-capture-stop', async () => {
  await nativeCapture?.stop();
  return { active: false };
});

const reposition = () => resizeNotch('pill');
app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', async (event) => {
  try {
    if (nativeCapture?.active()) {
      event.preventDefault();
      await nativeCapture.stop();
      app.quit();
      return;
    }
  } catch {}
  try { httpServer?.close(); } catch {}
  try { serverInstance?.close(); } catch {}
  logger.info('shutdown complete');
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
screen.on('display-added', reposition);
screen.on('display-removed', reposition);
screen.on('display-metrics-changed', reposition);
