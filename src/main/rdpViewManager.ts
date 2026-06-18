import { BrowserWindow } from 'electron';
import path from 'path';
import { writeLog } from './logger';

interface RdpAddon {
  createSession(
    host: string, port: number,
    width: number, height: number,
    username: string, password: string,
    onBitmap: (x: number, y: number, w: number, h: number, buf: Buffer) => void,
    onEvent: (type: string, ...args: any[]) => void,
  ): number;
  destroySession(id: number): void;
  sendPointerEvent(id: number, flags: number, x: number, y: number): void;
  sendKeyboardEvent(id: number, flags: number, code: number): void;
}

type RdpEventCallback = (tunnelId: string, event: string, ...args: any[]) => void;

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

export class RdpViewManager {
  private addon: RdpAddon | null = null;
  private sessions = new Map<string, number>();
  private addonAvailable = false;
  private win: BrowserWindow | null = null;
  private onEvent: RdpEventCallback | null = null;

  constructor() {
    try {
      const addonPath = path.join(process.resourcesPath, 'native', 'rdp-addon', 'build', 'Release', 'rdp_addon.node');
      this.addon = require(addonPath) as RdpAddon;
      this.addonAvailable = true;
      writeLog('rdp', 'RDP View', 'info', `Native RDP addon loaded from ${addonPath}`);
    } catch (err: any) {
      writeLog('rdp', 'RDP View', 'warn', `Native RDP addon not available: ${err.message}`);
      this.addonAvailable = false;
    }
  }

  isAvailable(): boolean {
    return this.addonAvailable;
  }

  setWindow(win: BrowserWindow | null) {
    this.win = win;
  }

  setEventCallback(cb: RdpEventCallback) {
    this.onEvent = cb;
  }

  async connectView(
    tunnelId: string,
    port: number,
    username: string,
    password: string,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
  ): Promise<boolean> {
    if (!this.addonAvailable || !this.addon) {
      writeLog(tunnelId, 'RDP View', 'error', 'Native addon not available');
      return false;
    }

    if (this.sessions.has(tunnelId)) {
      writeLog(tunnelId, 'RDP View', 'warn', 'Session already exists, destroying first');
      this.disconnectView(tunnelId);
    }

    try {
      const sessionId = this.addon.createSession(
        '127.0.0.1', port, width, height, username, password,
        (x, y, w, h, buf) => {
          this.forwardFrame(tunnelId, x, y, w, h, buf);
        },
        (type, ...args) => {
          this.handleEvent(tunnelId, type, args);
        },
      );

      this.sessions.set(tunnelId, sessionId);
      writeLog(tunnelId, 'RDP View', 'info', `RDP session created (id=${sessionId})`);
      return true;
    } catch (err: any) {
      writeLog(tunnelId, 'RDP View', 'error', `Failed to create RDP session: ${err.message}`);
      return false;
    }
  }

  disconnectView(tunnelId: string) {
    const sessionId = this.sessions.get(tunnelId);
    if (sessionId === undefined) return;

    try {
      this.addon?.destroySession(sessionId);
    } catch (err: any) {
      writeLog(tunnelId, 'RDP View', 'error', `Error destroying session: ${err.message}`);
    }
    this.sessions.delete(tunnelId);
    writeLog(tunnelId, 'RDP View', 'info', 'RDP session destroyed');

    if (this.onEvent) {
      this.onEvent(tunnelId, 'disconnected', 'Session closed');
    }
  }

  private forwardFrame(tunnelId: string, x: number, y: number, w: number, h: number, buf: Buffer) {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      this.win.webContents.send('rdp:frame', tunnelId, { x, y, w, h }, buf);
    } catch {}
  }

  private handleEvent(tunnelId: string, type: string, args: any[]) {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      this.win.webContents.send('rdp:event', tunnelId, type, ...args);
    } catch {}
    if (this.onEvent) {
      this.onEvent(tunnelId, type, ...args);
    }
  }

  sendPointerEvent(tunnelId: string, flags: number, x: number, y: number) {
    const sessionId = this.sessions.get(tunnelId);
    if (sessionId === undefined) return;
    try {
      this.addon?.sendPointerEvent(sessionId, flags, x, y);
    } catch (err: any) {
      writeLog(tunnelId, 'RDP View', 'error', `sendPointerEvent error: ${err.message}`);
    }
  }

  sendKeyboardEvent(tunnelId: string, flags: number, code: number) {
    const sessionId = this.sessions.get(tunnelId);
    if (sessionId === undefined) return;
    try {
      this.addon?.sendKeyboardEvent(sessionId, flags, code);
    } catch (err: any) {
      writeLog(tunnelId, 'RDP View', 'error', `sendKeyboardEvent error: ${err.message}`);
    }
  }

  disconnectAll() {
    for (const tunnelId of this.sessions.keys()) {
      this.disconnectView(tunnelId);
    }
  }
}
