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
  RDP_VIEW_CONNECT: 'rdp:view-connect',
  RDP_VIEW_DISCONNECT: 'rdp:view-disconnect',
  RDP_VIEW_FRAME: 'rdp:frame',
  RDP_VIEW_EVENT: 'rdp:event',
  RDP_VIEW_MOUSE: 'rdp:view-mouse',
  RDP_VIEW_KEYBOARD: 'rdp:view-keyboard',
  RDP_VIEW_STATE: 'rdp:view-state',
  RDP_AVAILABLE: 'rdp:available',
  RDP_VIEW_UPDATE_PASSWORD: 'rdp:view-update-password',
  LAUNCH_NATIVE_CLIENT: 'rdp:launch-native-client',
} as const;

export type RdpViewStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface RdpViewState {
  tunnelId: string;
  status: RdpViewStatus;
  error?: string;
  width?: number;
  height?: number;
}
