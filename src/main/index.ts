import { app, BrowserWindow, Tray, Menu, nativeImage, screen } from 'electron';
import path from 'path';
import { TunnelManager } from './tunnelManager';
import { RdpViewManager } from './rdpViewManager';
import { registerIpcHandlers, sendStatusToRenderer, sendLogToRenderer } from './ipcHandlers';
import { writeLog } from './logger';
import { getSettings, getTunnels, store } from './store';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let tunnelManager: TunnelManager | null = null;
let rdpViewManager: RdpViewManager | null = null;
let isQuitting = false;

const PREVENT_WINDOW_CLOSE = true;

function createTrayIcons(): { idle: Electron.NativeImage; connecting: Electron.NativeImage; connected: Electron.NativeImage; error: Electron.NativeImage } {
  const size = 16;
  function makeIcon(color: [number, number, number, number]): Electron.NativeImage {
    const buf = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cx = x - size / 2;
        const cy = y - size / 2;
        const dist = Math.sqrt(cx * cx + cy * cy);
        const alpha = dist < size / 2 - 1 ? 255 : dist < size / 2 ? 128 : 0;
        const offset = (y * size + x) * 4;
        buf[offset] = color[0];
        buf[offset + 1] = color[1];
        buf[offset + 2] = color[2];
        buf[offset + 3] = alpha;
      }
    }
    return nativeImage.createFromBuffer(buf, { width: size, height: size });
  }

  return {
    idle: makeIcon([100, 100, 100, 255]),
    connecting: makeIcon([255, 191, 0, 255]),
    connected: makeIcon([0, 200, 83, 255]),
    error: makeIcon([244, 67, 54, 255]),
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
  rdpViewManager.setWindow(mainWindow);

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
