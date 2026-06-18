export const DEFAULT_RDP_PORT = 3389;

export interface TunnelConfig {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  encryptedPassword: string;
  rememberAfterSession: boolean;
  createdAt: string;
  lastConnectedAt?: string;
}

export interface TunnelFormData {
  name: string;
  hostname: string;
  port: number;
  username: string;
  password: string;
  rememberAfterSession: boolean;
}

export type TunnelStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';

export interface TunnelRuntimeState {
  tunnelId: string;
  pid?: number;
  localPort?: number;
  status: TunnelStatus;
  lastError?: string;
  capturedOutput?: string;
}

export interface LogEntry {
  id: string;
  tunnelId: string;
  tunnelName: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export interface AppSettings {
  cloudflaredPath: string;
  launchOnStartup: boolean;
  startMinimizedToTray: boolean;
  theme: 'light' | 'dark' | 'system';
  autoReconnectAttempts: number;
  forgetPasswordAfterSession: boolean;
}

export const IPC_CHANNELS = {
  TUNNELS_LIST: 'tunnels:list',
  TUNNELS_ADD: 'tunnels:add',
  TUNNELS_UPDATE: 'tunnels:update',
  TUNNELS_DELETE: 'tunnels:delete',
  TUNNEL_CONNECT: 'tunnel:connect',
  TUNNEL_DISCONNECT: 'tunnel:disconnect',
  TUNNEL_STATUS_CHANGE: 'tunnel:status-change',
  TUNNEL_LOG: 'tunnel:log',
  TUNNELS_EXPORT_LOGS: 'tunnels:export-logs',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  APP_GET_VERSION: 'app:get-version',
  DIALOG_SELECT_FILE: 'dialog:select-file',
  CHECK_CLOUDFLARED: 'check:cloudflared',
} as const;
