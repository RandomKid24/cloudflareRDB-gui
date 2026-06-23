import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, TunnelFormData, TunnelConfig, AppSettings, TunnelRuntimeState, LogEntry } from '../shared/types';

const api = {
  tunnels: {
    list: (): Promise<TunnelConfig[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.TUNNELS_LIST),

    add: (data: TunnelFormData): Promise<TunnelConfig> =>
      ipcRenderer.invoke(IPC_CHANNELS.TUNNELS_ADD, data),

    update: (tunnel: TunnelConfig): Promise<TunnelConfig> =>
      ipcRenderer.invoke(IPC_CHANNELS.TUNNELS_UPDATE, tunnel),

    delete: (tunnelId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.TUNNELS_DELETE, tunnelId),

    connect: (tunnelId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.TUNNEL_CONNECT, tunnelId),

    disconnect: (tunnelId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.TUNNEL_DISCONNECT, tunnelId),

    exportLogs: (tunnelId?: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.TUNNELS_EXPORT_LOGS, tunnelId),

    getLogs: (tunnelId?: string): Promise<LogEntry[]> =>
      ipcRenderer.invoke('tunnels:get-logs', tunnelId),

    onStatusChange: (callback: (state: TunnelRuntimeState) => void) => {
      const handler = (_event: any, state: TunnelRuntimeState) => callback(state);
      ipcRenderer.on(IPC_CHANNELS.TUNNEL_STATUS_CHANGE, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.TUNNEL_STATUS_CHANGE, handler);
      };
    },

    onLog: (callback: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void) => {
      const handler = (_event: any, entry: Omit<LogEntry, 'id' | 'timestamp'>) => callback(entry);
      ipcRenderer.on(IPC_CHANNELS.TUNNEL_LOG, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.TUNNEL_LOG, handler);
      };
    },

    onTrayConnect: (callback: (tunnelId: string) => void) => {
      const handler = (_event: any, tunnelId: string) => callback(tunnelId);
      ipcRenderer.on('tray-connect', handler);
      return () => {
        ipcRenderer.removeListener('tray-connect', handler);
      };
    },

    decryptPassword: (encryptedBase64: string): Promise<string> =>
      ipcRenderer.invoke('tunnels:decrypt-password', encryptedBase64),
  },

  settings: {
    get: (): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),

    set: (settings: AppSettings): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, settings),
  },

  app: {
    getVersion: (): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),

    selectFile: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_FILE),

    checkCloudflared: (): Promise<{ found: boolean; path: string | null }> =>
      ipcRenderer.invoke(IPC_CHANNELS.CHECK_CLOUDFLARED),
  },

    rdp: {
      isAvailable: (): Promise<{ available: boolean; error?: string }> =>
        ipcRenderer.invoke(IPC_CHANNELS.RDP_AVAILABLE),

      launchNativeClient: (tunnelId: string): void => {
        ipcRenderer.invoke(IPC_CHANNELS.LAUNCH_NATIVE_CLIENT, tunnelId);
      },

    connect: (tunnelId: string, width?: number, height?: number): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.RDP_VIEW_CONNECT, tunnelId, width, height),

    disconnect: (tunnelId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.RDP_VIEW_DISCONNECT, tunnelId),

    sendMouse: (tunnelId: string, flags: number, x: number, y: number): void => {
      ipcRenderer.invoke(IPC_CHANNELS.RDP_VIEW_MOUSE, tunnelId, flags, x, y);
    },

    sendKeyboard: (tunnelId: string, flags: number, code: number): void => {
      ipcRenderer.invoke(IPC_CHANNELS.RDP_VIEW_KEYBOARD, tunnelId, flags, code);
    },

    onFrame: (callback: (tunnelId: string, rect: { x: number; y: number; w: number; h: number }, buf: ArrayBuffer) => void) => {
      const handler = (_event: any, tunnelId: string, rect: any, buf: ArrayBuffer) => callback(tunnelId, rect, buf);
      ipcRenderer.on(IPC_CHANNELS.RDP_VIEW_FRAME, handler);
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.RDP_VIEW_FRAME, handler); };
    },

    onEvent: (callback: (tunnelId: string, type: string, ...args: any[]) => void) => {
      const handler = (_event: any, tunnelId: string, type: string, ...args: any[]) => callback(tunnelId, type, ...args);
      ipcRenderer.on(IPC_CHANNELS.RDP_VIEW_EVENT, handler);
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.RDP_VIEW_EVENT, handler); };
    },

    updatePassword: (tunnelId: string, newPassword: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.RDP_VIEW_UPDATE_PASSWORD, tunnelId, newPassword),
  },
};

contextBridge.exposeInMainWorld('cloudflareRdp', api);
