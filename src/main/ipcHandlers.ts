import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { IPC_CHANNELS, TunnelConfig, TunnelFormData, AppSettings, LogEntry, RdpViewState } from '../shared/types';
import { getTunnels, setTunnels, getSettings, setSettings } from './store';
import { credentialStore } from './credentialStore';
import { TunnelManager } from './tunnelManager';
import { RdpViewManager } from './rdpViewManager';
import { getCombinedLogs, writeLog, getLogs } from './logger';

const isWin = process.platform === 'win32';

export function registerIpcHandlers(tunnelManager: TunnelManager, rdpViewManager?: RdpViewManager): void {
  ipcMain.handle(IPC_CHANNELS.TUNNELS_LIST, () => {
    return getTunnels();
  });

  ipcMain.handle('tunnels:get-logs', (_event, tunnelId?: string) => {
    return getLogs(tunnelId);
  });

  ipcMain.handle('tunnels:decrypt-password', async (_event, encryptedBase64: string) => {
    try {
      return credentialStore.decrypt(encryptedBase64);
    } catch {
      return '';
    }
  });

  ipcMain.handle(IPC_CHANNELS.TUNNELS_ADD, async (_event, data: TunnelFormData) => {
    if (!credentialStore.isEncryptionAvailable()) {
      throw new Error('Encryption is not available on this system. Cannot store credentials securely.');
    }

    const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
    if (!hostnameRegex.test(data.hostname)) {
      throw new Error('Invalid hostname format');
    }

    const encryptedPassword = credentialStore.encrypt(data.password);

    const tunnel: TunnelConfig = {
      id: uuidv4(),
      name: data.name,
      hostname: data.hostname,
      port: data.port || 3389,
      username: data.username,
      encryptedPassword,
      rememberAfterSession: data.rememberAfterSession,
      createdAt: new Date().toISOString(),
    };

    const tunnels = getTunnels();
    tunnels.push(tunnel);
    setTunnels(tunnels);

    return tunnel;
  });

  ipcMain.handle(IPC_CHANNELS.TUNNELS_UPDATE, async (_event, data: TunnelConfig & { password?: string }) => {
    const tunnels = getTunnels();
    const index = tunnels.findIndex((t) => t.id === data.id);
    if (index === -1) throw new Error('Tunnel not found');

    const existing = tunnels[index];
    const updated = { ...existing, ...data };

    if (data.password) {
      updated.encryptedPassword = credentialStore.encrypt(data.password);
    } else {
      updated.encryptedPassword = existing.encryptedPassword;
    }

    delete (updated as any).password;

    tunnels[index] = updated;
    setTunnels(tunnels);
    return updated;
  });

  ipcMain.handle(IPC_CHANNELS.TUNNELS_DELETE, async (_event, tunnelId: string) => {
    await tunnelManager.disconnect(tunnelId);
    const tunnels = getTunnels().filter((t) => t.id !== tunnelId);
    setTunnels(tunnels);
  });

  ipcMain.handle(IPC_CHANNELS.TUNNEL_CONNECT, async (_event, tunnelId: string) => {
    const tunnels = getTunnels();
    const config = tunnels.find((t) => t.id === tunnelId);
    if (!config) throw new Error('Tunnel not found');

    let password: string;
    try {
      password = credentialStore.decrypt(config.encryptedPassword);
    } catch {
      throw new Error('Failed to decrypt credentials. The stored password may be corrupted.');
    }

    await tunnelManager.connect(config, password);
  });

  ipcMain.handle(IPC_CHANNELS.TUNNEL_DISCONNECT, async (_event, tunnelId: string) => {
    await tunnelManager.disconnect(tunnelId);
  });

  ipcMain.handle(IPC_CHANNELS.TUNNELS_EXPORT_LOGS, async (_event, tunnelId?: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return;

    const result = await dialog.showSaveDialog(win, {
      title: 'Export Logs',
      defaultPath: `tunnelgate-logs-${Date.now()}.txt`,
      filters: [{ name: 'Text Files', extensions: ['txt'] }],
    });

    if (result.canceled || !result.filePath) return;

    const logs = getCombinedLogs();
    const filtered = tunnelId ? logs.filter((l) => l.tunnelId === tunnelId) : logs;

    const content = filtered
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.tunnelName}] ${l.message}`)
      .join('\n');

    const { writeFile } = await import('fs/promises');
    await writeFile(result.filePath, content, 'utf-8');

    writeLog('export', 'Log Export', 'info', `Logs exported to ${result.filePath}`);
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_event, settings: AppSettings) => {
    setSettings(settings);
    return getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => {
    return app.getVersion();
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG_SELECT_FILE, async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;

    const exts = isWin ? ['exe', 'cmd', 'bat'] : ['', 'sh'];
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Executables', extensions: exts }],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC_CHANNELS.RDP_AVAILABLE, () => {
    return rdpViewManager?.isAvailable() ?? { available: false, error: 'RDP view manager not initialized' };
  });

  ipcMain.handle(IPC_CHANNELS.RDP_VIEW_CONNECT, async (_event, tunnelId: string, width?: number, height?: number) => {
    if (!rdpViewManager) throw new Error('RDP view manager not initialized');

    const tunnels = getTunnels();
    const config = tunnels.find((t) => t.id === tunnelId);
    if (!config) throw new Error('Tunnel not found');

    const tunnelState = tunnelManager.getRuntimeState(tunnelId);
    const port = tunnelState?.localPort;
    if (!port) throw new Error('Tunnel not connected — no local port');

    if (isWin) {
      await credentialStore.clearCredential(tunnelId, config.name, port).catch(() => {});
    }

    let password: string;
    try {
      password = credentialStore.decrypt(config.encryptedPassword);
    } catch {
      throw new Error('Failed to decrypt credentials');
    }

    if (isWin) {
      await credentialStore.injectCredential(tunnelId, config.name, config.username, password, port);
    }

    await rdpViewManager.connectView(tunnelId, port, config.username, password, width, height);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.RDP_VIEW_UPDATE_PASSWORD, async (_event, tunnelId: string, newPassword: string) => {
    if (!rdpViewManager) throw new Error('RDP view manager not initialized');

    const tunnels = getTunnels();
    const config = tunnels.find((t) => t.id === tunnelId);
    if (!config) throw new Error('Tunnel not found');

    config.encryptedPassword = credentialStore.encrypt(newPassword);
    setTunnels(tunnels);

    const tunnelState = tunnelManager.getRuntimeState(tunnelId);
    const port = tunnelState?.localPort;
    if (!port) throw new Error('Tunnel not connected — no local port');

    if (isWin) {
      await credentialStore.injectCredential(tunnelId, config.name, config.username, newPassword, port);
    }

    rdpViewManager.disconnectView(tunnelId);
    await rdpViewManager.connectView(tunnelId, port, config.username, newPassword);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.LAUNCH_NATIVE_CLIENT, (_event, tunnelId: string) => {
    tunnelManager.launchNativeClient(tunnelId);
  });

  ipcMain.handle(IPC_CHANNELS.RDP_VIEW_DISCONNECT, (_event, tunnelId: string) => {
    rdpViewManager?.disconnectView(tunnelId);
  });

  ipcMain.handle(IPC_CHANNELS.RDP_VIEW_MOUSE, (_event, tunnelId: string, flags: number, x: number, y: number) => {
    rdpViewManager?.sendPointerEvent(tunnelId, flags, x, y);
  });

  ipcMain.handle(IPC_CHANNELS.RDP_VIEW_KEYBOARD, (_event, tunnelId: string, flags: number, code: number) => {
    rdpViewManager?.sendKeyboardEvent(tunnelId, flags, code);
  });

  ipcMain.handle(IPC_CHANNELS.CHECK_CLOUDFLARED, async () => {
    const { access } = await import('fs/promises');
    const settings = getSettings();
    const binName = isWin ? 'cloudflared.exe' : 'cloudflared';

    const paths: string[] = [
      settings.cloudflaredPath,
      binName,
    ].filter(Boolean) as string[];

    if (isWin) {
      paths.push(
        process.env.LOCALAPPDATA + '\\cloudflared\\' + binName,
        process.env.PROGRAMFILES + '\\cloudflared\\' + binName,
        (process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)') + '\\cloudflared\\' + binName,
      );
    } else {
      paths.push('/usr/local/bin/' + binName, '/opt/homebrew/bin/' + binName, '/usr/bin/' + binName);
    }

    paths.push(__dirname + '/../../resources/' + binName);

    for (const p of paths) {
      try {
        await access(p);
        return { found: true, path: p };
      } catch {}
    }

    try {
      const { execFileSync } = require('child_process');
      if (isWin) {
        const p = execFileSync('where', [binName], { encoding: 'utf-8', timeout: 3000 }).split('\n')[0].trim();
        if (p) return { found: true, path: p };
      } else {
        const p = execFileSync('which', [binName], { encoding: 'utf-8', timeout: 3000 }).trim();
        if (p) return { found: true, path: p };
      }
    } catch {}
    return { found: false, path: null };
  });
}

export function sendStatusToRenderer(win: BrowserWindow | null, state: any): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.TUNNEL_STATUS_CHANGE, state);
  }
}

export function sendLogToRenderer(win: BrowserWindow | null, tunnelId: string, tunnelName: string, level: string, message: string): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.TUNNEL_LOG, { tunnelId, tunnelName, level, message });
  }
}
