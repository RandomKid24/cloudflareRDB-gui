import { ChildProcess, spawn } from 'child_process';
import { createServer } from 'net';
import treeKill from 'tree-kill';
import { TunnelConfig, TunnelRuntimeState, TunnelStatus } from '../shared/types';
import { writeLog } from './logger';
import { credentialStore } from './credentialStore';
import { getSettings } from './store';

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(preferred, '127.0.0.1', () => {
      const port = (server.address() as any).port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      resolve(findFreePort(preferred + 1));
    });
  });
}

function getCloudflaredName(): string {
  return isWin ? 'cloudflared.exe' : 'cloudflared';
}

interface ManagedTunnel {
  config: TunnelConfig;
  state: TunnelRuntimeState;
  proc?: ChildProcess;
  reconnectAttempts: number;
  disconnectRequested: boolean;
  password?: string;
}

type StatusCallback = (state: TunnelRuntimeState) => void;
type LogCallback = (tunnelId: string, tunnelName: string, level: 'info' | 'warn' | 'error' | 'debug', message: string) => void;

export class TunnelManager {
  private registry = new Map<string, ManagedTunnel>();
  private onStatusChange: StatusCallback;
  private onLog: LogCallback;

  constructor(onStatusChange: StatusCallback, onLog: LogCallback) {
    this.onStatusChange = onStatusChange;
    this.onLog = onLog;
  }

  private emitStatus(tunnel: ManagedTunnel): void {
    this.onStatusChange({ ...tunnel.state });
  }

  private setStatus(tunnel: ManagedTunnel, status: TunnelStatus, error?: string): void {
    tunnel.state.status = status;
    tunnel.state.lastError = error;
    this.emitStatus(tunnel);
  }

  private async findCloudflared(): Promise<string> {
    const settings = getSettings();
    if (settings.cloudflaredPath) {
      return settings.cloudflaredPath;
    }

    const binName = getCloudflaredName();
    const commonPaths = [binName];

    if (isWin) {
      commonPaths.push(
        process.env.LOCALAPPDATA + '\\cloudflared\\' + binName,
        process.env.PROGRAMFILES + '\\cloudflared\\' + binName,
      );
    } else if (isMac) {
      commonPaths.push('/usr/local/bin/' + binName, '/opt/homebrew/bin/' + binName);
    } else {
      commonPaths.push('/usr/local/bin/' + binName, '/usr/bin/' + binName);
    }

    const { access } = await import('fs/promises');
    for (const p of commonPaths) {
      try {
        await access(p);
        return p;
      } catch {}
    }

    const bundled = __dirname + '/../../resources/' + binName;
    try {
      await require('fs/promises').access(bundled);
      return bundled;
    } catch {}

    return binName;
  }

  async connect(config: TunnelConfig, password: string): Promise<void> {
    if (this.registry.has(config.id)) {
      const existing = this.registry.get(config.id)!;
      if (existing.state.status === 'connected' || existing.state.status === 'connecting') {
        writeLog(config.id, config.name, 'warn', 'Tunnel already active');
        return;
      }
      this.registry.delete(config.id);
    }

    const tunnel: ManagedTunnel = {
      config,
      state: {
        tunnelId: config.id,
        status: 'connecting',
      },
      reconnectAttempts: 0,
      disconnectRequested: false,
      password,
    };

    this.registry.set(config.id, tunnel);
    this.setStatus(tunnel, 'connecting');
    writeLog(config.id, config.name, 'info', 'Starting tunnel connection...');

    try {
      await this.startProcess(tunnel);
    } catch (err: any) {
      this.setStatus(tunnel, 'error', err.message);
      writeLog(config.id, config.name, 'error', `Failed to start: ${err.message}`);
    }
  }

  private async startProcess(tunnel: ManagedTunnel): Promise<void> {
    const config = tunnel.config;
    const port = await findFreePort(3389);
    tunnel.state.localPort = port;
    writeLog(config.id, config.name, 'info', `Selected local port: ${port}`);

    const cloudflaredPath = await this.findCloudflared();
    writeLog(config.id, config.name, 'debug', `Using cloudflared: ${cloudflaredPath}`);

    const args = [
      'access', 'tcp',
      '--hostname', config.hostname,
      '--url', `localhost:${port}`,
    ];

    writeLog(config.id, config.name, 'debug', `Executing: ${cloudflaredPath} ${args.join(' ')}`);

    const proc = spawn(cloudflaredPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    tunnel.proc = proc;
    tunnel.state.pid = proc.pid;

    let outputBuffer = '';

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      outputBuffer += text;
      this.parseOutput(tunnel, text);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      outputBuffer += text;
      this.parseOutput(tunnel, text);
    });

    proc.on('close', (code) => {
      writeLog(config.id, config.name, 'info', `Process exited with code ${code}`);
      if (!tunnel.disconnectRequested) {
        this.handleUnexpectedDisconnect(tunnel);
      } else {
        this.setStatus(tunnel, 'disconnected');
        this.registry.delete(config.id);
      }
    });

    proc.on('error', (err) => {
      writeLog(config.id, config.name, 'error', `Process error: ${err.message}`);
      this.setStatus(tunnel, 'error', err.message);
    });

    const ready = await this.waitForReady(tunnel, outputBuffer);
    if (ready) {
      await this.handleReady(tunnel);
    }
  }

  private parseOutput(tunnel: ManagedTunnel, text: string): void {
    const lines = text.split('\n').filter((l) => l.trim());

    for (const line of lines) {
      const trimmed = line.trim();

      let level: 'info' | 'warn' | 'error' | 'debug' = 'info';

      if (/error|fail|refused|denied|timeout/i.test(trimmed)) {
        level = 'error';
      } else if (/warn|caution/i.test(trimmed)) {
        level = 'warn';
      } else if (/debug|trace/i.test(trimmed)) {
        level = 'debug';
      }

      this.onLog(tunnel.config.id, tunnel.config.name, level, trimmed);
    }
  }

  private async waitForReady(tunnel: ManagedTunnel, initialBuffer: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.isReadyMessage(initialBuffer)) {
        resolve(true);
        return;
      }

      const timeout = setTimeout(() => {
        writeLog(tunnel.config.id, tunnel.config.name, 'error', 'Tunnel connection timed out after 30s');
        this.setStatus(tunnel, 'error', 'Connection timed out');
        resolve(false);
      }, 30000);

      const onData = (data: Buffer) => {
        const text = data.toString();
        if (this.isReadyMessage(text)) {
          cleanup();
          resolve(true);
        }
        if (this.isErrorMessage(text)) {
          cleanup();
          writeLog(tunnel.config.id, tunnel.config.name, 'error', `Tunnel error: ${text.trim()}`);
          this.setStatus(tunnel, 'error', this.humanReadableError(text));
          resolve(false);
        }
      };

      const onClose = (code: number | null) => {
        cleanup();
        if (code !== 0) {
          writeLog(tunnel.config.id, tunnel.config.name, 'error', `Process exited prematurely with code ${code}`);
          this.setStatus(tunnel, 'error', `Process exited with code ${code}`);
        }
        resolve(false);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        tunnel.proc?.stdout?.removeListener('data', onData);
        tunnel.proc?.stderr?.removeListener('data', onData);
        tunnel.proc?.removeListener('close', onClose);
      };

      tunnel.proc?.stdout?.on('data', onData);
      tunnel.proc?.stderr?.on('data', onData);
      tunnel.proc?.on('close', onClose);
    });
  }

  private isReadyMessage(text: string): boolean {
    return /ready|listening|connection registered|Started serving/i.test(text);
  }

  private isErrorMessage(text: string): boolean {
    return /error|failed|refused|denied|not found|timed out/i.test(text);
  }

  private humanReadableError(text: string): string {
    const t = text.toLowerCase();
    if (t.includes('hostname not found') || t.includes('dns')) return 'Hostname not found - check your tunnel address';
    if (t.includes('certificate') || t.includes('cert')) return 'Certificate error - tunnel security issue';
    if (t.includes('connection refused')) return 'Connection refused - tunnel endpoint may be down';
    if (t.includes('timeout') || t.includes('timed out')) return 'Connection timed out - check network and tunnel status';
    if (t.includes('access denied') || t.includes('unauthorized')) return 'Access denied - check Cloudflare authentication';
    return text.trim();
  }

  private async handleReady(tunnel: ManagedTunnel): Promise<void> {
    this.setStatus(tunnel, 'connected');
    writeLog(tunnel.config.id, tunnel.config.name, 'info', `Tunnel ready on localhost:${tunnel.state.localPort}`);

    try {
      const password = tunnel.password!;
      await credentialStore.injectCredential(
        tunnel.config.id,
        tunnel.config.name,
        tunnel.config.username,
        password,
        tunnel.state.localPort!
      );

      this.launchRdpClient(tunnel);
    } catch (err: any) {
      writeLog(tunnel.config.id, tunnel.config.name, 'error', `Credential injection failed: ${err.message}`);
    }
  }

  private launchRdpClient(tunnel: ManagedTunnel): void {
    const port = tunnel.state.localPort!;

    if (isWin) {
      this.launchMstsc(tunnel, port);
    } else if (isMac) {
      this.launchMacRdp(tunnel, port);
    } else {
      this.launchLinuxRdp(tunnel, port);
    }
  }

  private launchMstsc(tunnel: ManagedTunnel, port: number): void {
    const proc = spawn('mstsc.exe', [`/v:localhost:${port}`], {
      stdio: 'ignore',
      windowsHide: false,
    });

    writeLog(tunnel.config.id, tunnel.config.name, 'info', `Launched mstsc.exe /v:localhost:${port}`);

    proc.on('error', (err) => {
      writeLog(tunnel.config.id, tunnel.config.name, 'error', `Failed to launch mstsc: ${err.message}`);
      writeLog(tunnel.config.id, tunnel.config.name, 'info', `Manual connection: localhost:${port}`);
    });

    proc.on('close', () => {
      writeLog(tunnel.config.id, tunnel.config.name, 'info', 'RDP session closed');
      if (getSettings().forgetPasswordAfterSession) {
        credentialStore.clearCredential(tunnel.config.id, tunnel.config.name, port);
      }
    });
  }

  private launchMacRdp(tunnel: ManagedTunnel, port: number): void {
    writeLog(tunnel.config.id, tunnel.config.name, 'info', `Tunnel ready. Connect via: localhost:${port}`);

    const proc = spawn('open', [
      '-b', 'com.microsoft.rdc.macos',
      '--args',
      `full address:s:localhost:${port}`,
      `username:s:${tunnel.config.username}`,
    ], { stdio: 'ignore' });

    proc.on('error', () => {
      writeLog(tunnel.config.id, tunnel.config.name, 'info',
        `Open Microsoft Remote Desktop and connect to localhost:${port} as ${tunnel.config.username}`
      );
    });
  }

  private launchLinuxRdp(tunnel: ManagedTunnel, port: number): void {
    const clients = ['xfreerdp', 'remmina', 'krdc', 'gnome-connections'];
    let attempted = false;

    for (const client of clients) {
      try {
        const args: string[] = [];

        if (client === 'xfreerdp') {
          args.push('/v:localhost:' + port, '/u:' + tunnel.config.username, '/dynamic-resolution', '+fonts');
        } else if (client === 'remmina') {
          args.push('--connect', `rdp://${tunnel.config.username}@localhost:${port}`);
        } else {
          writeLog(tunnel.config.id, tunnel.config.name, 'info',
            `Tunnel ready. Connect RDP client to localhost:${port} as ${tunnel.config.username}`
          );
          continue;
        }

        const proc = spawn(client, args, { stdio: 'ignore' });
        attempted = true;

        proc.on('error', () => {
        });

        proc.on('close', (code) => {
          if (code !== 0) {
            writeLog(tunnel.config.id, tunnel.config.name, 'info',
              `Manual connection: localhost:${port} (user: ${tunnel.config.username})`
            );
          }
        });

        return;
      } catch {}
    }

    if (!attempted) {
      writeLog(tunnel.config.id, tunnel.config.name, 'info',
        `No RDP client found. Connect manually to localhost:${port} as ${tunnel.config.username}`
      );
    }
  }

  private async handleUnexpectedDisconnect(tunnel: ManagedTunnel): Promise<void> {
    const settings = getSettings();
    if (tunnel.reconnectAttempts < settings.autoReconnectAttempts) {
      tunnel.reconnectAttempts++;
      tunnel.state.status = 'reconnecting';
      this.emitStatus(tunnel);
      writeLog(
        tunnel.config.id,
        tunnel.config.name,
        'warn',
        `Reconnecting (attempt ${tunnel.reconnectAttempts}/${settings.autoReconnectAttempts})...`
      );

      const delay = Math.min(1000 * Math.pow(2, tunnel.reconnectAttempts - 1), 15000);
      await new Promise((r) => setTimeout(r, delay));

      try {
        await this.startProcess(tunnel);
      } catch (err: any) {
        writeLog(tunnel.config.id, tunnel.config.name, 'error', `Reconnect failed: ${err.message}`);
        this.setStatus(tunnel, 'error', err.message);
      }
    } else {
      writeLog(tunnel.config.id, tunnel.config.name, 'error', 'Max reconnection attempts reached');
      this.setStatus(tunnel, 'error', 'Max reconnection attempts reached');
    }
  }

  async disconnect(tunnelId: string): Promise<void> {
    const tunnel = this.registry.get(tunnelId);
    if (!tunnel) return;

    tunnel.disconnectRequested = true;
    writeLog(tunnel.config.id, tunnel.config.name, 'info', 'Disconnecting tunnel...');
    this.setStatus(tunnel, 'disconnected');

    if (tunnel.proc?.pid) {
      await new Promise<void>((resolve) => {
        treeKill(tunnel.proc!.pid!, 'SIGTERM', (err) => {
          if (err) {
            writeLog(tunnel.config.id, tunnel.config.name, 'error', `Failed to kill process: ${err.message}`);
          }
          resolve();
        });
      });
    }

    if (tunnel.state.localPort && getSettings().forgetPasswordAfterSession) {
      await credentialStore.clearCredential(tunnel.config.id, tunnel.config.name, tunnel.state.localPort);
    }

    this.registry.delete(tunnelId);
  }

  disconnectAll(): void {
    for (const [id] of this.registry) {
      this.disconnect(id).catch(() => {});
    }
  }

  getRuntimeState(tunnelId: string): TunnelRuntimeState | undefined {
    return this.registry.get(tunnelId)?.state;
  }

  getAllRuntimeStates(): TunnelRuntimeState[] {
    return Array.from(this.registry.values()).map((t) => t.state);
  }

  getActiveTunnelCount(): number {
    let count = 0;
    for (const [, t] of this.registry) {
      if (t.state.status === 'connected') count++;
    }
    return count;
  }
}
