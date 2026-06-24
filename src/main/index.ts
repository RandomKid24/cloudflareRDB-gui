import { app, BrowserWindow, Tray, Menu, nativeImage, screen } from 'electron';
import path from 'path';
import { TunnelManager } from './tunnelManager';
import { RdpViewManager } from './rdpViewManager';
import { registerIpcHandlers, sendStatusToRenderer, sendLogToRenderer } from './ipcHandlers';
import { writeLog } from './logger';
import { getSettings, getTunnels, store } from './store';

process.on('uncaughtException', (error) => {
  writeLog('system', 'System', 'error', `Uncaught Exception: ${error.message}\n${error.stack || ''}`);
});

process.on('unhandledRejection', (reason: any) => {
  writeLog('system', 'System', 'error', `Unhandled Rejection: ${reason?.message || reason}\n${reason?.stack || ''}`);
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let tunnelManager: TunnelManager | null = null;
let rdpViewManager: RdpViewManager | null = null;
let isQuitting = false;

const PREVENT_WINDOW_CLOSE = true;

function createTrayIcons(): { idle: Electron.NativeImage; connecting: Electron.NativeImage; connected: Electron.NativeImage; error: Electron.NativeImage } {
  const logo = nativeImage.createFromPath(
    path.join(__dirname, '../../resources/icons/16x16.png')
  ).resize({ width: 16, height: 16 });
  const size = logo.getSize();

  function tinted(tint: [number, number, number]): Electron.NativeImage {
    const raw = logo.toBitmap();
    const pixels = Buffer.alloc(raw.length);
    for (let i = 0; i < raw.length; i += 4) {
      pixels[i]     = Math.round(raw[i]     * tint[2] / 255);  // B
      pixels[i + 1] = Math.round(raw[i + 1] * tint[1] / 255);  // G
      pixels[i + 2] = Math.round(raw[i + 2] * tint[0] / 255);  // R
      pixels[i + 3] = raw[i + 3];                                // A
    }
    return nativeImage.createFromBuffer(pixels, size);
  }

  return {
    idle: tinted([200, 200, 200]),
    connecting: tinted([255, 191, 0]),
    connected: tinted([0, 200, 83]),
    error: tinted([244, 67, 54]),
  };
}

function createTray(): void {
  const icons = createTrayIcons();
  tray = new Tray(icons.idle);
  tray.setToolTip('TunnelGate - Disconnected');

  const updateTrayMenu = () => {
    if (!tray || !tunnelManager) return;

    const tunnels = getTunnels();
    const states = tunnelManager.getAllRuntimeStates();
    const activeCount = tunnelManager.getActiveTunnelCount();

    const iconKey = activeCount > 0 ? 'connected' : states.some((s) => s.status === 'error') ? 'error' : states.some((s) => s.status === 'connecting' || s.status === 'reconnecting') ? 'connecting' : 'idle';
    const icons = createTrayIcons();
    tray.setImage(icons[iconKey]);
    tray.setToolTip(activeCount > 0 ? `TunnelGate - ${activeCount} tunnel${activeCount > 1 ? 's' : ''} active` : 'TunnelGate - Disconnected');

    const menuItems: Electron.MenuItemConstructorOptions[] = [];

    if (tunnels.length === 0) {
      menuItems.push({ label: 'No tunnels configured', enabled: false });
    } else {
      for (const t of tunnels) {
        const state = states.find((s) => s.tunnelId === t.id);
        const isActive = state && (state.status === 'connected' || state.status === 'connecting' || state.status === 'reconnecting');
        menuItems.push({
          label: `${isActive ? '●' : '○'} ${t.name} (${state?.status ?? 'disconnected'})`,
          submenu: [
            {
              label: isActive ? 'Disconnect' : 'Connect',
              click: () => {
                if (isActive) {
                  tunnelManager?.disconnect(t.id);
                } else {
                  mainWindow?.webContents.send('tray-connect', t.id);
                }
              },
            },
          ],
        });
      }
    }

    menuItems.push(
      { type: 'separator' },
      {
        label: 'Open Dashboard',
        click: showMainWindow,
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      }
    );

    tray.setContextMenu(Menu.buildFromTemplate(menuItems));
  };

  tunnelManager = new TunnelManager(
    (state) => {
      sendStatusToRenderer(mainWindow, state);
      updateTrayMenu();
    },
    (tunnelId, tunnelName, level, message) => {
      sendLogToRenderer(mainWindow, tunnelId, tunnelName, level, message);
    }
  );

  rdpViewManager = new RdpViewManager();

  tray.on('click', showMainWindow);

  registerIpcHandlers(tunnelManager, rdpViewManager);
  updateTrayMenu();

  setInterval(updateTrayMenu, 2000);
}

function createMainWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1000, width),
    height: Math.min(700, height),
    minWidth: 900,
    minHeight: 600,
    title: 'TunnelGate',
    icon: path.join(__dirname, '../../resources/icons/icon.ico'),
    show: !getSettings().startMinimizedToTray,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  rdpViewManager?.setWindow(mainWindow);

  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('close', (event) => {
    if (PREVENT_WINDOW_CLOSE && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    rdpViewManager?.setWindow(null);
  });
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

app.whenReady().then(() => {
  createTray();
  createMainWindow();

  writeLog('system', 'System', 'info', 'TunnelGate started');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  tunnelManager?.disconnectAll();
  rdpViewManager?.disconnectAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!isQuitting) return;
    app.quit();
  }
});

app.on('will-quit', () => {
  tunnelManager?.disconnectAll();
  rdpViewManager?.disconnectAll();
});
