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
    };
  }
}

export {};
