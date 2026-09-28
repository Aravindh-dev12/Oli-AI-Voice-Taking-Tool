import 'dotenv/config';
import { app, BrowserWindow, Tray, Menu, screen, ipcMain, globalShortcut, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from '../server/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const DB_PATH = path.join(__dirname, '..', process.env.DB_PATH || './data/oli.db');
const CONFIG_PATH = path.join(__dirname, '..', process.env.CONFIG_PATH || './data/config.json');

let notchWin, dashboardWin, tray;
let meetingActive = false;

// Sizes must match the CSS states in renderer/notch.css
const SIZE = {
  pill: { w: 236, h: 34 },
  flare: { w: 480, h: 50 },
  shelf: { w: 560, h: 320 }
};

function topCenterBounds(w, h) {
  const { bounds } = screen.getPrimaryDisplay();
  return { x: Math.round(bounds.x + (bounds.width - w) / 2), y: bounds.y, width: w, height: h };
}

function createNotchWindow() {
  notchWin = new BrowserWindow({
    ...topCenterBounds(SIZE.pill.w, SIZE.pill.h),
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
    focusable: false, // never steals focus from your meeting app
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  notchWin.setAlwaysOnTop(true, 'screen-saver');
  notchWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // The core "ghost window" trick: invisible to screen shares & recordings on both macOS and Windows.
  notchWin.setContentProtection(true);
  notchWin.loadURL(`http://localhost:${PORT}/notch.html`);
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
      nodeIntegration: false
    }
  });
  dashboardWin.setMenuBarVisibility(false);
  dashboardWin.loadURL(`http://localhost:${PORT}/dashboard.html`);
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

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  const { app: expressApp } = createServer({ dbPath: DB_PATH, configPath: CONFIG_PATH });
  expressApp.listen(PORT, () => {
    createNotchWindow();
    buildTray();
    globalShortcut.register('Alt+Space', () => notchWin?.webContents.send('oli:toggle-pin'));
  });
});

// Renderer asks to resize+recenter itself when it switches visual state
ipcMain.on('oli:resize', (_e, state) => {
  const s = SIZE[state] || SIZE.pill;
  notchWin?.setBounds(topCenterBounds(s.w, s.h));
});
ipcMain.on('oli:open-dashboard', openDashboard);
ipcMain.on('oli:meeting-state', (_e, active) => {
  meetingActive = !!active;
  refreshTrayMenu();
});
ipcMain.handle('oli:platform', () => process.platform);

app.on('window-all-closed', (e) => e.preventDefault()); // tray-resident app
app.on('will-quit', () => globalShortcut.unregisterAll());
