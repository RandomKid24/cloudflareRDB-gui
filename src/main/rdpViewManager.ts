import { BrowserWindow, app } from 'electron';
import path from 'path';
const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';
import { writeLog } from './logger';

interface RdpAddon {
  createSession(
    host: string, port: number,
    width: number, height: number,
    username: string, password: string,
    serverHostname: string,
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
  private addonLoadError = '';
  private win: BrowserWindow | null = null;
  private onEvent: RdpEventCallback | null = null;
  private lastDimensions = new Map<string, { width: number; height: number }>();

  constructor() {
    const fs = require('fs');
    let addonDir = path.join(__dirname, '..', '..', 'native', 'rdp-addon', 'build', 'Release');
    if (!fs.existsSync(path.join(addonDir, 'rdp_addon.node'))) {
      addonDir = path.join(process.resourcesPath, 'native', 'rdp-addon', 'build', 'Release');
    }
    const addonPath = path.join(addonDir, 'rdp_addon.node');

    try {
      if (!fs.existsSync(addonPath)) {
        throw new Error(`Addon file not found at ${addonPath}`);
      }

      if (isWin) {
        process.env.PATH = `${addonDir};${process.env.PATH}`;

        const requiredDlls = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];
        const missing = requiredDlls.filter(dll => {
          const p = path.join(addonDir, dll);
          if (fs.existsSync(p)) return false;
          try { require(dll); return false; } catch { return true; }
        });
        if (missing.length > 0) {
          throw new Error(
            `Missing Visual C++ runtime DLLs in ${addonDir}:\n  ${missing.join('\n  ')}\n\n` +
            `These are required by the native RDP addon. Reinstall the application or ` +
            `install the Microsoft Visual C++ 2022 Redistributable.`
          );
        }

      }

      if (isLinux) {
        process.env.LD_LIBRARY_PATH = `${addonDir}:${process.env.LD_LIBRARY_PATH || ''}`;
      }

      this.addon = require(addonPath) as RdpAddon;
      this.addonAvailable = true;
      writeLog('rdp', 'RDP View', 'info', `Native RDP addon loaded from ${addonPath}`);
    } catch (err: any) {
      this.addonLoadError = `${err.message}\n${err.stack || ''}`;
      writeLog('rdp', 'RDP View', 'error',
        `Native RDP addon failed to load from ${addonPath}:\n${this.addonLoadError}`);
      this.addonAvailable = false;
    }
  }

  isAvailable(): { available: boolean; error?: string } {
    return { available: this.addonAvailable, error: this.addonLoadError || undefined };
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
    serverHostname?: string,
    width?: number,
    height?: number,
  ): Promise<boolean> {
    if (!this.addonAvailable || !this.addon) {
      const msg = 'Native RDP addon not available: ' + (this.addonLoadError || 'unknown error');
      writeLog(tunnelId, 'RDP View', 'error', msg);
      throw new Error(msg);
    }

    if (this.sessions.has(tunnelId)) {
      writeLog(tunnelId, 'RDP View', 'warn', 'Session already exists, destroying first');
      this.disconnectView(tunnelId);
    }

    const fs = require('fs');
    const userDataPath = app.getPath('userData');
    const logFilename = `freerdp-${tunnelId}.log`;
    const logFilePath = path.join(userDataPath, logFilename);

    // Truncate/clear the session-specific log file if it exists
    try {
      if (fs.existsSync(logFilePath)) {
        fs.writeFileSync(logFilePath, '', 'utf-8');
      }
    } catch (e: any) {
      writeLog(tunnelId, 'RDP View', 'warn', `Failed to truncate existing log file: ${e.message}`);
    }

    // Set environment variables before creating session
    process.env.WLOG_APPENDER = 'file';
    process.env.WLOG_FILEAPPENDER_OUTPUT_FILE_PATH = userDataPath;
    process.env.WLOG_FILEAPPENDER_OUTPUT_FILE_NAME = logFilename;
    process.env.WLOG_LEVEL = 'DEBUG';

    try {
      // Use stored dimensions if not provided on reconnect
      if (width === undefined || height === undefined) {
        const stored = this.lastDimensions.get(tunnelId);
        width = stored?.width ?? DEFAULT_WIDTH;
        height = stored?.height ?? DEFAULT_HEIGHT;
      }

      const sessionId = this.addon.createSession(
        '127.0.0.1', port, width, height, username, password, serverHostname ?? '127.0.0.1',
        (x, y, w, h, buf) => {
          this.forwardFrame(tunnelId, x, y, w, h, buf);
        },
        (type, ...args) => {
          this.handleEvent(tunnelId, type, args);
        },
      );

      this.lastDimensions.set(tunnelId, { width, height });
      this.sessions.set(tunnelId, sessionId);
      writeLog(tunnelId, 'RDP View', 'info', `RDP session created (id=${sessionId}) at ${width}x${height}`);
      return true;
    } catch (err: any) {
      // Dump logs immediately on connection failure
      this.dumpNativeLogs(tunnelId);

      const rawMsg = err.message || '';

      if (isWin && rawMsg.includes('code=131087')) {
        writeLog(tunnelId, 'RDP View', 'warn',
          'FreeRDP on Windows reported password-expired (131087) — likely false positive due to NLA/SSPI. Treating as generic error.');
        throw new Error('Failed to create RDP session: RDP authentication failed (NLA compatibility issue). Try reconnecting or use the native client.');
      }

      const msg = `Failed to create RDP session: ${rawMsg}\n${err.stack || ''}`;
      writeLog(tunnelId, 'RDP View', 'error', msg);
      throw new Error(msg);
    }
  }

  disconnectView(tunnelId: string) {
    const sessionId = this.sessions.get(tunnelId);
    if (sessionId === undefined) return;

    try {
      this.addon?.destroySession(sessionId);
    } catch (err: any) {
      writeLog(tunnelId, 'RDP View', 'error', `Error destroying session: ${err.message}\n${err.stack || ''}`);
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
    // Log the event to our main logger
    const firstArg = args[0] !== undefined ? String(args[0]) : '';
    if (type === 'error') {
      writeLog(tunnelId, 'RDP View', 'error', `RDP connection error: ${firstArg}`);
      this.dumpNativeLogs(tunnelId); // Dump logs on error event
    } else if (type === 'disconnected') {
      writeLog(tunnelId, 'RDP View', 'info', `RDP session disconnected: ${firstArg || 'Session closed'}`);
      this.dumpNativeLogs(tunnelId); // Dump logs on disconnect event
    } else if (type === 'resize') {
      const w = args[0];
      const h = args[1];
      this.lastDimensions.set(tunnelId, { width: w, height: h });
      writeLog(tunnelId, 'RDP View', 'info', `RDP session resized to ${w}x${h}`);
    } else {
      writeLog(tunnelId, 'RDP View', 'debug', `RDP session event [${type}]: ${firstArg}`);
    }

    if (!this.win || this.win.isDestroyed()) return;
    try {
      this.win.webContents.send('rdp:event', tunnelId, type, ...args);
    } catch {}
    if (this.onEvent) {
      this.onEvent(tunnelId, type, ...args);
    }
  }

  private dumpNativeLogs(tunnelId: string) {
    const fs = require('fs');
    const userDataPath = app.getPath('userData');
    const logFilePath = path.join(userDataPath, `freerdp-${tunnelId}.log`);

    try {
      if (fs.existsSync(logFilePath)) {
        const content = fs.readFileSync(logFilePath, 'utf-8');
        const lines = content.split('\n').filter((l: string) => l.trim().length > 0);
        // Take the last 40 lines
        const lastLines = lines.slice(-40);
        
        writeLog(tunnelId, 'FreeRDP Engine', 'info', `--- Native FreeRDP Logs (Last ${lastLines.length} lines) ---`);
        for (const line of lastLines) {
          let level: 'info' | 'warn' | 'error' | 'debug' = 'debug';
          const lowerLine = line.toLowerCase();
          if (lowerLine.includes('error') || lowerLine.includes('fail') || lowerLine.includes('reject')) {
            level = 'error';
          } else if (lowerLine.includes('warn')) {
            level = 'warn';
          } else if (lowerLine.includes('info')) {
            level = 'info';
          }
          
          writeLog(tunnelId, 'FreeRDP Engine', level, line.trim());
        }
        writeLog(tunnelId, 'FreeRDP Engine', 'info', `------------------------------------------------------`);
      }
    } catch (err: any) {
      writeLog(tunnelId, 'RDP Log Reader', 'error', `Failed to read native log file: ${err.message}`);
    }
  }

  sendPointerEvent(tunnelId: string, flags: number, x: number, y: number) {
    const sessionId = this.sessions.get(tunnelId);
    if (sessionId === undefined) return;
    try {
      this.addon?.sendPointerEvent(sessionId, flags, x, y);
    } catch (err: any) {
      writeLog(tunnelId, 'RDP View', 'error', `sendPointerEvent error: ${err.message}\n${err.stack || ''}`);
    }
  }

  sendKeyboardEvent(tunnelId: string, flags: number, code: number) {
    const sessionId = this.sessions.get(tunnelId);
    if (sessionId === undefined) return;
    try {
      this.addon?.sendKeyboardEvent(sessionId, flags, code);
    } catch (err: any) {
      writeLog(tunnelId, 'RDP View', 'error', `sendKeyboardEvent error: ${err.message}\n${err.stack || ''}`);
    }
  }

  disconnectAll() {
    for (const tunnelId of this.sessions.keys()) {
      this.disconnectView(tunnelId);
    }
  }
}
