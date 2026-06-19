import { TunnelConfig, TunnelRuntimeState, AppSettings, LogEntry, TunnelFormData } from '../shared/types';

declare global {
  interface Window {
    cloudflareRdp: {
      tunnels: {
        list: () => Promise<TunnelConfig[]>;
        add: (data: TunnelFormData) => Promise<TunnelConfig>;
        update: (tunnel: TunnelConfig) => Promise<TunnelConfig>;
        delete: (tunnelId: string) => Promise<void>;
        connect: (tunnelId: string) => Promise<void>;
        disconnect: (tunnelId: string) => Promise<void>;
        exportLogs: (tunnelId?: string) => Promise<void>;
        onStatusChange: (callback: (state: TunnelRuntimeState) => void) => () => void;
        onLog: (callback: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void) => () => void;
        onTrayConnect: (callback: (tunnelId: string) => void) => () => void;
      };
      settings: {
        get: () => Promise<AppSettings>;
        set: (settings: AppSettings) => Promise<AppSettings>;
      };
      app: {
        getVersion: () => Promise<string>;
        selectFile: () => Promise<string | null>;
        checkCloudflared: () => Promise<{ found: boolean; path: string | null }>;
      };
      rdp: {
        isAvailable: () => Promise<{ available: boolean; error?: string }>;
        launchNativeClient: (tunnelId: string) => void;
        connect: (tunnelId: string, width?: number, height?: number) => Promise<boolean>;
        disconnect: (tunnelId: string) => Promise<void>;
        sendMouse: (tunnelId: string, flags: number, x: number, y: number) => void;
        sendKeyboard: (tunnelId: string, flags: number, code: number) => void;
        onFrame: (callback: (tunnelId: string, rect: { x: number; y: number; w: number; h: number }, buf: ArrayBuffer) => void) => () => void;
        onEvent: (callback: (tunnelId: string, type: string, ...args: any[]) => void) => () => void;
        updatePassword: (tunnelId: string, newPassword: string) => Promise<boolean>;
      };
    };
  }
}

export {};
